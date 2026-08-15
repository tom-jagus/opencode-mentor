import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  commitGitCheckpoint,
  rollbackGitCheckpointCommit,
} from "../lib/git_checkpoint_commit_mutation";

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

async function head(root: string): Promise<string> {
  return (
    await requireGit(root, ["rev-parse", "--verify", "HEAD"])
  ).stdout.trim();
}

describe("Git checkpoint Commit mutation", () => {
  let temporaryRoot: string;
  let repositoryRoot: string;
  let previousHead: string;

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(
      join(tmpdir(), "opencode-mentor-commit-mutation-"),
    );
    repositoryRoot = join(temporaryRoot, "project");

    await mkdir(repositoryRoot);
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

    await writeFile(join(repositoryRoot, "selected.txt"), "baseline\n");
    await writeFile(join(repositoryRoot, "remaining.txt"), "baseline\n");
    await requireGit(repositoryRoot, ["add", "-A", "--", "."]);
    await requireGit(repositoryRoot, [
      "commit",
      "-m",
      "Establish test repository",
    ]);
    await requireGit(repositoryRoot, [
      "switch",
      "-c",
      "feature/commit-mutation-test",
    ]);

    previousHead = await head(repositoryRoot);

    await writeFile(join(repositoryRoot, "selected.txt"), "staged\n");
    await writeFile(join(repositoryRoot, "remaining.txt"), "unstaged\n");
    await requireGit(repositoryRoot, ["add", "--", "selected.txt"]);
  });

  afterEach(async () => {
    await rm(temporaryRoot, {
      recursive: true,
      force: true,
    });
  });

  test("commits the staged index with the exact message", async () => {
    const message = [
      "Implement checkpoint Commit mutation",
      "",
      "Preserve unstaged work outside the reviewed index.",
    ].join("\n");

    const receipt = await commitGitCheckpoint(
      repositoryRoot,
      "feature/commit-mutation-test",
      previousHead,
      message,
    );

    expect(receipt.previous_head_sha).toBe(previousHead);
    expect(receipt.commit_sha).toBe(await head(repositoryRoot));

    const committed = await requireGit(repositoryRoot, [
      "diff",
      "--name-only",
      `${previousHead}..${receipt.commit_sha}`,
    ]);

    expect(committed.stdout.trim()).toBe("selected.txt");

    const status = await requireGit(repositoryRoot, [
      "status",
      "--porcelain=v1",
    ]);

    expect(status.stdout).toContain(" M remaining.txt");
    expect(status.stdout).not.toContain("selected.txt");

    const object = await requireGit(repositoryRoot, [
      "cat-file",
      "commit",
      receipt.commit_sha,
    ]);
    const separator = object.stdout.indexOf("\n\n");

    expect(object.stdout.slice(separator + 2)).toBe(`${message}\n`);
  });

  test("rollback restores HEAD and the staged diff", async () => {
    const before = await requireGit(repositoryRoot, [
      "diff",
      "--cached",
      "--binary",
    ]);

    const receipt = await commitGitCheckpoint(
      repositoryRoot,
      "feature/commit-mutation-test",
      previousHead,
      "Implement reversible checkpoint commit",
    );

    await rollbackGitCheckpointCommit(receipt);

    expect(await head(repositoryRoot)).toBe(previousHead);

    const after = await requireGit(repositoryRoot, [
      "diff",
      "--cached",
      "--binary",
    ]);

    expect(after.stdout).toBe(before.stdout);

    const status = await requireGit(repositoryRoot, [
      "status",
      "--porcelain=v1",
    ]);

    expect(status.stdout).toContain("M  selected.txt");
    expect(status.stdout).toContain(" M remaining.txt");
  });

  test("rejects stale HEAD without committing", async () => {
    await expect(
      commitGitCheckpoint(
        repositoryRoot,
        "feature/commit-mutation-test",
        "ffffffffffffffffffffffffffffffffffffffff",
        "Reject stale checkpoint commit",
      ),
    ).rejects.toMatchObject({
      code: "COMMIT_STATE_FAILED",
    });

    expect(await head(repositoryRoot)).toBe(previousHead);
  });
});
