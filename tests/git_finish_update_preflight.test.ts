import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runGitFinishUpdatePreflight } from "../lib/git_finish_update";

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

describe("Git Finish Update preflight", () => {
  const configurationRoot = fileURLToPath(
    new URL("..", import.meta.url),
  ).replace(/\/$/, "");

  let temporaryRoot: string;
  let repositoryRoot: string;
  let remoteRoot: string;

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(
      join(tmpdir(), "opencode-mentor-finish-update-preflight-"),
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
    await requireGit(repositoryRoot, [
      "switch",
      "-c",
      "feature/finish-update-preflight",
    ]);

    await writeFile(join(repositoryRoot, "feature.txt"), "feature\n");
    await requireGit(repositoryRoot, ["add", "--", "feature.txt"]);
    await requireGit(repositoryRoot, ["commit", "-m", "Add feature work"]);
  });

  afterEach(async () => {
    await rm(temporaryRoot, {
      recursive: true,
      force: true,
    });
  });

  test("builds a fetch-and-rebase plan from exact local and remote state", async () => {
    const localHead = (
      await requireGit(repositoryRoot, ["rev-parse", "HEAD"])
    ).stdout.trim();
    const remoteBase = (
      await requireGit(repositoryRoot, ["rev-parse", "main"])
    ).stdout.trim();

    const result = await runGitFinishUpdatePreflight({
      directory: repositoryRoot,
      configuration_root: configurationRoot,
      remote: "review",
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(`Preflight failed at ${result.stage}`);
    }

    expect(result.eligibility.eligible).toBe(true);
    expect(result.operation_state.active_operations).toEqual([]);
    expect(result.update_plan).toEqual({
      repository_root: repositoryRoot,
      base_branch: "main",
      current_branch: "feature/finish-update-preflight",
      local_head_sha: localHead,
      remote: "review",
      selected_fetch_url: remoteRoot,
      remote_base_ref: "refs/heads/main",
      remote_base_commit_sha: remoteBase,
      action: "fetch-and-rebase",
    });
  });

  test("does not contact the remote when local eligibility fails", async () => {
    await writeFile(join(repositoryRoot, "dirty.txt"), "dirty\n");
    await requireGit(repositoryRoot, ["remote", "remove", "review"]);

    const result = await runGitFinishUpdatePreflight({
      directory: repositoryRoot,
      configuration_root: configurationRoot,
      remote: "review",
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(`Preflight failed at ${result.stage}`);
    }

    expect(result.eligibility.eligible).toBe(false);
    expect(result.eligibility.issues).toContainEqual({
      code: "WORKTREE_NOT_CLEAN",
      message:
        "The working tree must be clean before finalising the working branch",
    });
    expect(result.remote_inspection).toBeNull();
    expect(result.update_plan).toBeNull();
  });

  test("reports explicit remote inspection failure", async () => {
    const result = await runGitFinishUpdatePreflight({
      directory: repositoryRoot,
      configuration_root: configurationRoot,
      remote: "missing",
    });

    expect(result).toMatchObject({
      ok: false,
      stage: "remote",
      error: {
        code: "REMOTE_NOT_FOUND",
      },
    });
  });

  test("rejects finalisation from the effective base branch", async () => {
    await requireGit(repositoryRoot, ["switch", "main"]);

    const result = await runGitFinishUpdatePreflight({
      directory: repositoryRoot,
      configuration_root: configurationRoot,
      remote: "review",
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(`Preflight failed at ${result.stage}`);
    }

    expect(result.eligibility.eligible).toBe(false);
    expect(
      result.eligibility.issues.some(
        (issue) => issue.code === "ON_PROTECTED_BASE_BRANCH",
      ),
    ).toBe(true);
    expect(result.remote_inspection).toBeNull();
  });
});
