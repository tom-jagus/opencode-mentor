import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  inspectGitCheckpointPushRemote,
  inspectGitCheckpointPushUrlDestination,
} from "../lib/git_checkpoint_push_remote";

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

describe("Git checkpoint Push remote inspection", () => {
  let temporaryRoot: string;
  let repositoryRoot: string;
  let remoteRoot: string;

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(
      join(tmpdir(), "opencode-mentor-push-remote-"),
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
    await requireGit(repositoryRoot, [
      "switch",
      "-c",
      "feature/push-remote-test",
    ]);
    await requireGit(repositoryRoot, ["remote", "add", "review", remoteRoot]);
  });

  afterEach(async () => {
    await rm(temporaryRoot, {
      recursive: true,
      force: true,
    });
  });

  test("inspects an explicitly supplied remote with an absent destination", async () => {
    const inspection = await inspectGitCheckpointPushRemote({
      repository_root: repositoryRoot,
      remote: "review",
      destination_branch: "feature/push-remote-test",
    });

    expect(inspection).toMatchObject({
      repository_root: repositoryRoot,
      remote: "review",
      push_urls: [remoteRoot],
      selected_push_url: remoteRoot,
      destination_branch: "feature/push-remote-test",
      destination_ref: "refs/heads/feature/push-remote-test",
      destination: {
        exists: false,
        commit_sha: null,
      },
    });
  });

  test("returns the exact existing destination commit", async () => {
    await requireGit(repositoryRoot, [
      "push",
      "review",
      "HEAD:refs/heads/feature/push-remote-test",
    ]);

    const expectedCommit = (
      await requireGit(repositoryRoot, ["rev-parse", "HEAD"])
    ).stdout.trim();

    const inspection = await inspectGitCheckpointPushRemote({
      repository_root: repositoryRoot,
      remote: "review",
      destination_branch: "feature/push-remote-test",
    });

    expect(inspection.destination).toEqual({
      exists: true,
      commit_sha: expectedCommit,
    });
  });

  test("does not fall back to another configured remote", async () => {
    await requireGit(repositoryRoot, ["remote", "add", "origin", remoteRoot]);

    await expect(
      inspectGitCheckpointPushRemote({
        repository_root: repositoryRoot,
        remote: "missing",
        destination_branch: "feature/push-remote-test",
      }),
    ).rejects.toMatchObject({
      code: "REMOTE_NOT_FOUND",
    });
  });

  test("rejects multiple effective push URLs", async () => {
    const secondRemote = join(temporaryRoot, "second.git");

    await mkdir(secondRemote);
    await requireGit(secondRemote, ["init", "--bare"]);

    await requireGit(repositoryRoot, [
      "remote",
      "set-url",
      "--add",
      "--push",
      "review",
      remoteRoot,
    ]);
    await requireGit(repositoryRoot, [
      "remote",
      "set-url",
      "--add",
      "--push",
      "review",
      secondRemote,
    ]);

    await expect(
      inspectGitCheckpointPushRemote({
        repository_root: repositoryRoot,
        remote: "review",
        destination_branch: "feature/push-remote-test",
      }),
    ).rejects.toMatchObject({
      code: "AMBIGUOUS_PUSH_URL",
    });
  });

  test("rejects unsafe remote and destination names", async () => {
    await expect(
      inspectGitCheckpointPushRemote({
        repository_root: repositoryRoot,
        remote: "--upload-pack=command",
        destination_branch: "feature/push-remote-test",
      }),
    ).rejects.toMatchObject({
      code: "INVALID_REMOTE_NAME",
    });

    await expect(
      inspectGitCheckpointPushRemote({
        repository_root: repositoryRoot,
        remote: "review",
        destination_branch: "../main",
      }),
    ).rejects.toMatchObject({
      code: "INVALID_DESTINATION_BRANCH",
    });
  });

  test("inspects an exact bound URL and destination after Push", async () => {
    await requireGit(repositoryRoot, [
      "push",
      "review",
      "HEAD:refs/heads/feature/push-remote-test",
    ]);

    const expectedCommit = (
      await requireGit(repositoryRoot, ["rev-parse", "HEAD"])
    ).stdout.trim();

    const inspection = await inspectGitCheckpointPushUrlDestination({
      repository_root: repositoryRoot,
      push_url: remoteRoot,
      destination_ref: "refs/heads/feature/push-remote-test",
    });

    expect(inspection).toEqual({
      repository_root: repositoryRoot,
      push_url: remoteRoot,
      destination_ref: "refs/heads/feature/push-remote-test",
      destination: {
        exists: true,
        commit_sha: expectedCommit,
      },
    });
  });

  test("rejects an invalid exact destination ref", async () => {
    await expect(
      inspectGitCheckpointPushUrlDestination({
        repository_root: repositoryRoot,
        push_url: remoteRoot,
        destination_ref: "refs/heads/../main",
      }),
    ).rejects.toMatchObject({
      code: "REMOTE_DESTINATION_INSPECTION_FAILED",
    });
  });
});
