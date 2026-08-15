import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pushGitCheckpoint } from "../lib/git_checkpoint_push_mutation";

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

describe("Git checkpoint Push mutation", () => {
  let temporaryRoot: string;
  let repositoryRoot: string;
  let remoteRoot: string;
  let localCommit: string;

  const branch = "feature/push-mutation-test";
  const destinationRef = `refs/heads/${branch}`;

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(
      join(tmpdir(), "opencode-mentor-push-mutation-"),
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
    await requireGit(repositoryRoot, ["switch", "-c", branch]);
    await writeFile(join(repositoryRoot, "feature.txt"), "feature\n");
    await requireGit(repositoryRoot, ["add", "--", "feature.txt"]);
    await requireGit(repositoryRoot, [
      "commit",
      "-m",
      "Create Push checkpoint",
    ]);

    localCommit = (
      await requireGit(repositoryRoot, ["rev-parse", "HEAD"])
    ).stdout.trim();
  });

  afterEach(async () => {
    await rm(temporaryRoot, {
      recursive: true,
      force: true,
    });
  });

  test("pushes only the exact commit to the exact destination", async () => {
    const receipt = await pushGitCheckpoint(
      repositoryRoot,
      remoteRoot,
      localCommit,
      destinationRef,
    );

    expect(receipt).toMatchObject({
      repository_root: repositoryRoot,
      local_commit_sha: localCommit,
      destination_ref: destinationRef,
    });

    const remoteCommit = (
      await requireGit(remoteRoot, ["rev-parse", destinationRef])
    ).stdout.trim();

    expect(remoteCommit).toBe(localCommit);
  });

  test("does not establish upstream configuration", async () => {
    await pushGitCheckpoint(
      repositoryRoot,
      remoteRoot,
      localCommit,
      destinationRef,
    );

    const remoteSetting = await git(repositoryRoot, [
      "config",
      "--get",
      `branch.${branch}.remote`,
    ]);

    const mergeSetting = await git(repositoryRoot, [
      "config",
      "--get",
      `branch.${branch}.merge`,
    ]);

    expect(remoteSetting.exitCode).toBe(1);
    expect(mergeSetting.exitCode).toBe(1);
    expect(remoteSetting.stdout).toBe("");
    expect(mergeSetting.stdout).toBe("");
  });

  test("rejects a normal non-fast-forward push", async () => {
    await pushGitCheckpoint(
      repositoryRoot,
      remoteRoot,
      localCommit,
      destinationRef,
    );

    await requireGit(repositoryRoot, ["switch", "main"]);
    await requireGit(repositoryRoot, ["switch", "-c", "test/diverged-push"]);
    await writeFile(join(repositoryRoot, "diverged.txt"), "diverged\n");
    await requireGit(repositoryRoot, ["add", "--", "diverged.txt"]);
    await requireGit(repositoryRoot, [
      "commit",
      "-m",
      "Create diverged commit",
    ]);

    const divergedCommit = (
      await requireGit(repositoryRoot, ["rev-parse", "HEAD"])
    ).stdout.trim();

    await expect(
      pushGitCheckpoint(
        repositoryRoot,
        remoteRoot,
        divergedCommit,
        destinationRef,
      ),
    ).rejects.toMatchObject({
      code: "PUSH_FAILED",
    });

    const remoteCommit = (
      await requireGit(remoteRoot, ["rev-parse", destinationRef])
    ).stdout.trim();

    expect(remoteCommit).toBe(localCommit);
  });

  test("rejects invalid mutation input", async () => {
    await expect(
      pushGitCheckpoint(
        repositoryRoot,
        "--upload-pack=command",
        localCommit,
        destinationRef,
      ),
    ).rejects.toMatchObject({
      code: "INVALID_PUSH_INPUT",
    });

    await expect(
      pushGitCheckpoint(repositoryRoot, remoteRoot, localCommit, "main"),
    ).rejects.toMatchObject({
      code: "INVALID_PUSH_INPUT",
    });

    await expect(
      pushGitCheckpoint(
        repositoryRoot,
        remoteRoot,
        localCommit,
        "refs/heads/../main",
      ),
    ).rejects.toMatchObject({
      code: "INVALID_PUSH_INPUT",
    });
  });
});
