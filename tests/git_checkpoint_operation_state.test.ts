import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runGitCheckpointCommitPreflight } from "../lib/git_checkpoint_commit";
import { inspectGitCheckpointOperationState } from "../lib/git_checkpoint_operation_state";

async function git(root: string, args: string[]): Promise<void> {
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

describe("Git checkpoint operation state", () => {
  test("rejects a resolved merge awaiting its commit", async () => {
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "opencode-mentor-commit-operation-"),
    );
    const repositoryRoot = join(temporaryRoot, "project");
    const configurationRoot = fileURLToPath(
      new URL("..", import.meta.url),
    ).replace(/\/$/, "");

    try {
      await mkdir(repositoryRoot);
      await git(repositoryRoot, ["init", "-b", "main"]);
      await git(repositoryRoot, [
        "config",
        "user.name",
        "OpenCode Mentor Test",
      ]);
      await git(repositoryRoot, [
        "config",
        "user.email",
        "test@example.invalid",
      ]);

      await writeFile(join(repositoryRoot, "baseline.txt"), "baseline\n");
      await git(repositoryRoot, ["add", "--", "baseline.txt"]);
      await git(repositoryRoot, ["commit", "-m", "Establish test repository"]);

      await git(repositoryRoot, [
        "switch",
        "-c",
        "feature/commit-operation-test",
      ]);
      await writeFile(join(repositoryRoot, "feature.txt"), "feature\n");
      await git(repositoryRoot, ["add", "--", "feature.txt"]);
      await git(repositoryRoot, ["commit", "-m", "Add feature-side change"]);

      await git(repositoryRoot, ["switch", "main"]);
      await git(repositoryRoot, ["switch", "-c", "test/merge-source"]);
      await writeFile(join(repositoryRoot, "source.txt"), "source\n");
      await git(repositoryRoot, ["add", "--", "source.txt"]);
      await git(repositoryRoot, ["commit", "-m", "Add merge-source change"]);

      await git(repositoryRoot, ["switch", "feature/commit-operation-test"]);
      await git(repositoryRoot, ["merge", "--no-commit", "test/merge-source"]);

      const operationState =
        await inspectGitCheckpointOperationState(repositoryRoot);

      expect(operationState.active_operations).toContain("merge");

      const preflight = await runGitCheckpointCommitPreflight({
        directory: repositoryRoot,
        configuration_root: configurationRoot,
        commit_message: "Commit an ordinary checkpoint",
      });

      expect(preflight.ok).toBe(true);

      if (!preflight.ok) {
        throw new Error(`Preflight failed at ${preflight.stage}`);
      }

      expect(preflight.commit_plan.eligible).toBe(false);
      expect(
        preflight.commit_plan.issues.some(
          (issue) => issue.code === "ACTIVE_GIT_OPERATION",
        ),
      ).toBe(true);
      expect(preflight.diff).toBeNull();
    } finally {
      await rm(temporaryRoot, {
        recursive: true,
        force: true,
      });
    }
  });
});
