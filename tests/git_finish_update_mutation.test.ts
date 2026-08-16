import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  rollbackGitFinishUpdate,
  updateGitFinishBranch,
} from "../lib/git_finish_update_mutation";

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
      GIT_AUTHOR_NAME: "OpenCode Mentor Test",
      GIT_AUTHOR_EMAIL: "test@example.invalid",
      GIT_COMMITTER_NAME: "OpenCode Mentor Test",
      GIT_COMMITTER_EMAIL: "test@example.invalid",
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

describe("Git Finish Update mutation", () => {
  let temporaryRoot: string;
  let repositoryRoot: string;
  let updaterRoot: string;
  let remoteRoot: string;
  let originalHead: string;
  let remoteBaseCommit: string;

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(
      join(tmpdir(), "opencode-mentor-finish-update-mutation-"),
    );
    repositoryRoot = join(temporaryRoot, "project");
    updaterRoot = join(temporaryRoot, "updater");
    remoteRoot = join(temporaryRoot, "remote.git");

    await mkdir(repositoryRoot);
    await mkdir(remoteRoot);

    await requireGit(remoteRoot, ["init", "--bare"]);
    await requireGit(repositoryRoot, ["init", "-b", "main"]);

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
    await requireGit(repositoryRoot, ["switch", "-c", "feature/finish-update"]);

    await writeFile(join(repositoryRoot, "feature.txt"), "feature\n");
    await requireGit(repositoryRoot, ["add", "--", "feature.txt"]);
    await requireGit(repositoryRoot, ["commit", "-m", "Add feature work"]);

    originalHead = (
      await requireGit(repositoryRoot, ["rev-parse", "HEAD"])
    ).stdout.trim();

    await requireGit(temporaryRoot, ["clone", remoteRoot, updaterRoot]);
    await requireGit(updaterRoot, ["switch", "main"]);
    await writeFile(join(updaterRoot, "base.txt"), "base update\n");
    await requireGit(updaterRoot, ["add", "--", "base.txt"]);
    await requireGit(updaterRoot, ["commit", "-m", "Advance base branch"]);
    await requireGit(updaterRoot, ["push", "origin", "main:refs/heads/main"]);

    remoteBaseCommit = (
      await requireGit(updaterRoot, ["rev-parse", "HEAD"])
    ).stdout.trim();
  });

  afterEach(async () => {
    await rm(temporaryRoot, {
      recursive: true,
      force: true,
    });
  });

  test("fetches and rebases onto the exact reviewed base commit", async () => {
    const receipt = await updateGitFinishBranch({
      repository_root: repositoryRoot,
      branch: "feature/finish-update",
      expected_head_sha: originalHead,
      fetch_url: remoteRoot,
      base_branch: "main",
      base_ref: "refs/heads/main",
      base_commit_sha: remoteBaseCommit,
    });

    expect(receipt.previous_head_sha).toBe(originalHead);
    expect(receipt.resulting_head_sha).not.toBe(originalHead);
    expect(receipt.base_commit_sha).toBe(remoteBaseCommit);
    expect(receipt.rebased).toBe(true);

    const ancestry = await git(repositoryRoot, [
      "merge-base",
      "--is-ancestor",
      remoteBaseCommit,
      receipt.resulting_head_sha,
    ]);

    expect(ancestry.exitCode).toBe(0);

    const status = await requireGit(repositoryRoot, ["status", "--porcelain"]);

    expect(status.stdout).toBe("");
  });

  test("rolls back a completed update", async () => {
    const receipt = await updateGitFinishBranch({
      repository_root: repositoryRoot,
      branch: "feature/finish-update",
      expected_head_sha: originalHead,
      fetch_url: remoteRoot,
      base_branch: "main",
      base_ref: "refs/heads/main",
      base_commit_sha: remoteBaseCommit,
    });

    await rollbackGitFinishUpdate(receipt);

    expect(
      (await requireGit(repositoryRoot, ["rev-parse", "HEAD"])).stdout.trim(),
    ).toBe(originalHead);

    expect(
      (await requireGit(repositoryRoot, ["status", "--porcelain"])).stdout,
    ).toBe("");
  });

  test("rejects changed branch state before mutation", async () => {
    await expect(
      updateGitFinishBranch({
        repository_root: repositoryRoot,
        branch: "feature/finish-update",
        expected_head_sha: "cccccccccccccccccccccccccccccccccccccccc",
        fetch_url: remoteRoot,
        base_branch: "main",
        base_ref: "refs/heads/main",
        base_commit_sha: remoteBaseCommit,
      }),
    ).rejects.toMatchObject({
      code: "UPDATE_STATE_FAILED",
    });
  });

  test("aborts and restores a conflicting rebase", async () => {
    await writeFile(join(repositoryRoot, "README.md"), "# Feature\n");
    await requireGit(repositoryRoot, ["add", "--", "README.md"]);
    await requireGit(repositoryRoot, [
      "commit",
      "-m",
      "Change feature heading",
    ]);

    const conflictingHead = (
      await requireGit(repositoryRoot, ["rev-parse", "HEAD"])
    ).stdout.trim();

    await writeFile(join(updaterRoot, "README.md"), "# Base\n");
    await requireGit(updaterRoot, ["add", "--", "README.md"]);
    await requireGit(updaterRoot, ["commit", "-m", "Change base heading"]);
    await requireGit(updaterRoot, ["push", "origin", "main:refs/heads/main"]);

    const conflictingBase = (
      await requireGit(updaterRoot, ["rev-parse", "HEAD"])
    ).stdout.trim();

    await expect(
      updateGitFinishBranch({
        repository_root: repositoryRoot,
        branch: "feature/finish-update",
        expected_head_sha: conflictingHead,
        fetch_url: remoteRoot,
        base_branch: "main",
        base_ref: "refs/heads/main",
        base_commit_sha: conflictingBase,
      }),
    ).rejects.toMatchObject({
      code: "UPDATE_FAILED",
    });

    expect(
      (await requireGit(repositoryRoot, ["rev-parse", "HEAD"])).stdout.trim(),
    ).toBe(conflictingHead);

    expect(
      (await requireGit(repositoryRoot, ["status", "--porcelain"])).stdout,
    ).toBe("");
  });
});
