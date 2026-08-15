import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GitCheckpointCommitDiffError,
  inspectGitCheckpointCommitDiff,
  inspectGitCheckpointCommittedDiff,
} from "../lib/git_checkpoint_commit_diff";

async function git(repositoryRoot: string, args: string[]): Promise<void> {
  const subprocess = Bun.spawn(["git", ...args], {
    cwd: repositoryRoot,
    env: {
      ...Bun.env,
      GIT_TERMINAL_PROMPT: "0",
      LANG: "C",
      LC_ALL: "C",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([
    new Response(subprocess.stderr).text(),
    subprocess.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(
      stderr.trim() || `git ${args.join(" ")} exited with code ${exitCode}`,
    );
  }
}

async function createRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "opencode-mentor-commit-diff-"));

  await git(root, ["init", "--initial-branch=main"]);
  await git(root, ["config", "user.name", "OpenCode Mentor Test"]);
  await git(root, ["config", "user.email", "mentor@example.invalid"]);

  await writeFile(join(root, "tracked.txt"), "initial\n");
  await git(root, ["add", "--", "tracked.txt"]);
  await git(root, ["commit", "-m", "Create initial checkpoint"]);

  await git(root, ["switch", "-c", "feature/add-commit-transaction"]);

  return root;
}

describe("Git checkpoint Commit diff", () => {
  test("returns the exact deterministic staged patch and checksum", async () => {
    const root = await createRepository();

    try {
      await writeFile(join(root, "tracked.txt"), "staged\n");
      await git(root, ["add", "--", "tracked.txt"]);

      const first = await inspectGitCheckpointCommitDiff(root);
      const second = await inspectGitCheckpointCommitDiff(root);

      expect(first).toEqual(second);
      expect(first.repository_root).toBe(root);
      expect(first.patch).toContain("diff --git a/tracked.txt b/tracked.txt");
      expect(first.patch).toContain("-initial");
      expect(first.patch).toContain("+staged");
      expect(first.patch_bytes).toBeGreaterThan(0);
      expect(first.patch_sha256).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      await rm(root, {
        recursive: true,
        force: true,
      });
    }
  });

  test("ignores later unstaged content in a partially staged path", async () => {
    const root = await createRepository();

    try {
      await writeFile(join(root, "tracked.txt"), "staged\n");
      await git(root, ["add", "--", "tracked.txt"]);

      const staged = await inspectGitCheckpointCommitDiff(root);

      await writeFile(join(root, "tracked.txt"), "unstaged later\n");

      const afterWorktreeChange = await inspectGitCheckpointCommitDiff(root);

      expect(afterWorktreeChange).toEqual(staged);

      await git(root, ["add", "--", "tracked.txt"]);

      const afterIndexChange = await inspectGitCheckpointCommitDiff(root);

      expect(afterIndexChange.patch_sha256).not.toBe(staged.patch_sha256);
    } finally {
      await rm(root, {
        recursive: true,
        force: true,
      });
    }
  });

  test("rejects an empty staged diff", async () => {
    const root = await createRepository();

    try {
      await expect(inspectGitCheckpointCommitDiff(root)).rejects.toBeInstanceOf(
        GitCheckpointCommitDiffError,
      );

      await expect(inspectGitCheckpointCommitDiff(root)).rejects.toMatchObject({
        code: "EMPTY_STAGED_DIFF",
      });
    } finally {
      await rm(root, {
        recursive: true,
        force: true,
      });
    }
  });

  test("matches the reviewed staged diff to the resulting commit diff", async () => {
    const root = await createRepository();

    try {
      const previousHeadProcess = Bun.spawn(["git", "rev-parse", "HEAD"], {
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
      });

      const previousHead = (
        await new Response(previousHeadProcess.stdout).text()
      ).trim();

      expect(await previousHeadProcess.exited).toBe(0);

      await writeFile(join(root, "tracked.txt"), "staged\n");
      await git(root, ["add", "--", "tracked.txt"]);

      const reviewed = await inspectGitCheckpointCommitDiff(root);

      await git(root, ["commit", "-m", "Commit reviewed staged diff"]);

      const commitProcess = Bun.spawn(["git", "rev-parse", "HEAD"], {
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
      });

      const commitSha = (
        await new Response(commitProcess.stdout).text()
      ).trim();

      expect(await commitProcess.exited).toBe(0);

      const committed = await inspectGitCheckpointCommittedDiff(
        root,
        previousHead,
        commitSha,
      );

      expect(committed.patch).toBe(reviewed.patch);
      expect(committed.patch_bytes).toBe(reviewed.patch_bytes);
      expect(committed.patch_sha256).toBe(reviewed.patch_sha256);
    } finally {
      await rm(root, {
        recursive: true,
        force: true,
      });
    }
  });
});
