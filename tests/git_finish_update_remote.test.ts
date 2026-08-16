import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectGitFinishUpdateRemote } from "../lib/git_finish_update_remote";

type GitResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

async function git(root: string, args: string[]): Promise<GitResult> {
  const subprocess = Bun.spawn(["git", ...args], {
    cwd: root,
    env: {
      ...Bun.env,
      GIT_TERMINAL_PROMPT: "0",
      LANG: "C",
      LC_ALL: "C",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
    subprocess.exited,
  ]);

  return {
    stdout,
    stderr,
    exitCode,
  };
}

async function requireGit(root: string, args: string[]): Promise<GitResult> {
  const result = await git(root, args);

  if (result.exitCode !== 0) {
    throw new Error(
      result.stderr.trim() ||
        `git ${args.join(" ")} exited with code ${result.exitCode}`,
    );
  }

  return result;
}

describe("Git Finish Update remote inspection", () => {
  let temporaryRoot: string;
  let repositoryRoot: string;
  let remoteRoot: string;

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(
      join(tmpdir(), "opencode-mentor-finish-update-remote-"),
    );
    repositoryRoot = join(temporaryRoot, "project");
    remoteRoot = join(temporaryRoot, "remote.git");

    await mkdir(repositoryRoot);
    await mkdir(remoteRoot);

    await requireGit(remoteRoot, ["init", "--bare"]);
    await requireGit(repositoryRoot, ["init", "-b", "main"]);
    await requireGit(repositoryRoot, [
      "config",
      "user.name",
      "OpenCode Mentor Test",
    ]);
    await requireGit(repositoryRoot, [
      "config",
      "user.email",
      "test@example.invalid",
    ]);

    await writeFile(join(repositoryRoot, "README.md"), "# Test\n");
    await requireGit(repositoryRoot, ["add", "--", "README.md"]);
    await requireGit(repositoryRoot, [
      "commit",
      "-m",
      "Establish test repository",
    ]);
    await requireGit(repositoryRoot, ["remote", "add", "review", remoteRoot]);
    await requireGit(repositoryRoot, [
      "push",
      "review",
      "main:refs/heads/main",
    ]);
  });

  afterEach(async () => {
    await rm(temporaryRoot, {
      recursive: true,
      force: true,
    });
  });

  test("returns the exact advertised remote base commit", async () => {
    const expectedCommit = (
      await requireGit(repositoryRoot, ["rev-parse", "main"])
    ).stdout.trim();

    const inspection = await inspectGitFinishUpdateRemote({
      repository_root: repositoryRoot,
      remote: "review",
      base_branch: "main",
    });

    expect(inspection).toEqual({
      repository_root: repositoryRoot,
      remote: "review",
      fetch_urls: [remoteRoot],
      selected_fetch_url: remoteRoot,
      base_branch: "main",
      base_ref: "refs/heads/main",
      base_commit_sha: expectedCommit,
    });
  });

  test("uses the fetch URL rather than a separate push URL", async () => {
    const pushRoot = join(temporaryRoot, "push.git");

    await mkdir(pushRoot);
    await requireGit(pushRoot, ["init", "--bare"]);
    await requireGit(repositoryRoot, [
      "remote",
      "set-url",
      "--push",
      "review",
      pushRoot,
    ]);

    const inspection = await inspectGitFinishUpdateRemote({
      repository_root: repositoryRoot,
      remote: "review",
      base_branch: "main",
    });

    expect(inspection.selected_fetch_url).toBe(remoteRoot);
  });

  test("rejects an unconfigured remote", async () => {
    await expect(
      inspectGitFinishUpdateRemote({
        repository_root: repositoryRoot,
        remote: "missing",
        base_branch: "main",
      }),
    ).rejects.toMatchObject({
      code: "REMOTE_NOT_FOUND",
    });
  });

  test("rejects multiple effective fetch URLs", async () => {
    const secondRemote = join(temporaryRoot, "second.git");

    await mkdir(secondRemote);
    await requireGit(secondRemote, ["init", "--bare"]);
    await requireGit(repositoryRoot, [
      "remote",
      "set-url",
      "--add",
      "review",
      secondRemote,
    ]);

    await expect(
      inspectGitFinishUpdateRemote({
        repository_root: repositoryRoot,
        remote: "review",
        base_branch: "main",
      }),
    ).rejects.toMatchObject({
      code: "AMBIGUOUS_FETCH_URL",
    });
  });

  test("rejects a remote without the effective base branch", async () => {
    const emptyRemote = join(temporaryRoot, "empty.git");

    await mkdir(emptyRemote);
    await requireGit(emptyRemote, ["init", "--bare"]);
    await requireGit(repositoryRoot, ["remote", "add", "empty", emptyRemote]);

    await expect(
      inspectGitFinishUpdateRemote({
        repository_root: repositoryRoot,
        remote: "empty",
        base_branch: "main",
      }),
    ).rejects.toMatchObject({
      code: "REMOTE_BASE_NOT_FOUND",
    });
  });

  test("rejects unsafe remote and base-branch names", async () => {
    await expect(
      inspectGitFinishUpdateRemote({
        repository_root: repositoryRoot,
        remote: "--upload-pack=command",
        base_branch: "main",
      }),
    ).rejects.toMatchObject({
      code: "INVALID_REMOTE_NAME",
    });

    await expect(
      inspectGitFinishUpdateRemote({
        repository_root: repositoryRoot,
        remote: "review",
        base_branch: "../main",
      }),
    ).rejects.toMatchObject({
      code: "INVALID_BASE_BRANCH",
    });
  });
});
