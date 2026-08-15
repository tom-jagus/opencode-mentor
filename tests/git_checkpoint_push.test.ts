import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runGitCheckpointPushPreflight } from "../lib/git_checkpoint_push";

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

async function head(repositoryRoot: string): Promise<string> {
  return (
    await requireGit(repositoryRoot, ["rev-parse", "--verify", "HEAD"])
  ).stdout.trim();
}

describe("Git checkpoint Push preflight", () => {
  let temporaryRoot: string;
  let repositoryRoot: string;
  let remoteRoot: string;

  const workingBranch = "feature/push-preflight-test";
  const destinationBranch = "feature/push-preflight-test";

  const configurationRoot = fileURLToPath(
    new URL("..", import.meta.url),
  ).replace(/\/$/, "");

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(
      join(tmpdir(), "opencode-mentor-push-preflight-"),
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

    await writeFile(join(repositoryRoot, "baseline.txt"), "baseline\n");
    await requireGit(repositoryRoot, ["add", "--", "baseline.txt"]);
    await requireGit(repositoryRoot, [
      "commit",
      "-m",
      "Establish test repository",
    ]);

    await requireGit(repositoryRoot, ["switch", "-c", workingBranch]);
    await writeFile(join(repositoryRoot, "feature.txt"), "feature\n");
    await requireGit(repositoryRoot, ["add", "--", "feature.txt"]);
    await requireGit(repositoryRoot, [
      "commit",
      "-m",
      "Create feature checkpoint",
    ]);

    await requireGit(repositoryRoot, ["remote", "add", "review", remoteRoot]);
  });

  afterEach(async () => {
    await rm(temporaryRoot, {
      recursive: true,
      force: true,
    });
  });

  async function preflight(
    options: {
      local_commit_sha?: string;
      remote?: string;
      destination_branch?: string;
    } = {},
  ) {
    return runGitCheckpointPushPreflight({
      directory: repositoryRoot,
      configuration_root: configurationRoot,
      local_commit_sha:
        options.local_commit_sha ?? (await head(repositoryRoot)),
      remote: options.remote ?? "review",
      destination_branch: options.destination_branch ?? destinationBranch,
    });
  }

  function requireSuccessfulPreflight(
    result: Awaited<ReturnType<typeof runGitCheckpointPushPreflight>>,
  ) {
    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(
        `Push preflight failed at ${result.stage}: ${result.error.message}`,
      );
    }

    return result;
  }

  test("classifies an absent destination as eligible creation", async () => {
    const result = requireSuccessfulPreflight(await preflight());

    expect(result.push_plan).toMatchObject({
      eligible: true,
      current_branch: workingBranch,
      local_commit_sha: await head(repositoryRoot),
      remote: "review",
      remote_push_url: remoteRoot,
      destination_branch: destinationBranch,
      destination_ref: `refs/heads/${destinationBranch}`,
      remote_commit_sha: null,
      disposition: "create",
      issues: [],
    });

    expect(result.remote_inspection?.destination).toEqual({
      exists: false,
      commit_sha: null,
    });
  });

  test("classifies an equal destination as eligible and up to date", async () => {
    await requireGit(repositoryRoot, [
      "push",
      "review",
      `HEAD:refs/heads/${destinationBranch}`,
    ]);

    const localCommit = await head(repositoryRoot);

    const result = requireSuccessfulPreflight(
      await preflight({
        local_commit_sha: localCommit,
      }),
    );

    expect(result.push_plan).toMatchObject({
      eligible: true,
      local_commit_sha: localCommit,
      remote_commit_sha: localCommit,
      disposition: "up-to-date",
      issues: [],
    });
  });

  test("classifies an ancestor destination as an eligible fast-forward", async () => {
    await requireGit(repositoryRoot, [
      "push",
      "review",
      `HEAD:refs/heads/${destinationBranch}`,
    ]);

    const remoteCommit = await head(repositoryRoot);

    await writeFile(join(repositoryRoot, "next.txt"), "next\n");
    await requireGit(repositoryRoot, ["add", "--", "next.txt"]);
    await requireGit(repositoryRoot, [
      "commit",
      "-m",
      "Advance feature checkpoint",
    ]);

    const localCommit = await head(repositoryRoot);

    const result = requireSuccessfulPreflight(
      await preflight({
        local_commit_sha: localCommit,
      }),
    );

    expect(result.push_plan).toMatchObject({
      eligible: true,
      local_commit_sha: localCommit,
      remote_commit_sha: remoteCommit,
      disposition: "fast-forward",
      issues: [],
    });
  });

  test("rejects a diverged destination as non-fast-forward", async () => {
    await requireGit(repositoryRoot, ["switch", "main"]);
    await requireGit(repositoryRoot, ["switch", "-c", "test/remote-side"]);
    await writeFile(join(repositoryRoot, "remote-side.txt"), "remote side\n");
    await requireGit(repositoryRoot, ["add", "--", "remote-side.txt"]);
    await requireGit(repositoryRoot, [
      "commit",
      "-m",
      "Create divergent remote checkpoint",
    ]);

    const remoteCommit = await head(repositoryRoot);

    await requireGit(repositoryRoot, [
      "push",
      "review",
      `HEAD:refs/heads/${destinationBranch}`,
    ]);

    await requireGit(repositoryRoot, ["switch", workingBranch]);

    const localCommit = await head(repositoryRoot);

    const result = requireSuccessfulPreflight(
      await preflight({
        local_commit_sha: localCommit,
      }),
    );

    expect(result.push_plan).toMatchObject({
      eligible: false,
      local_commit_sha: localCommit,
      remote_commit_sha: remoteCommit,
      disposition: "non-fast-forward",
    });

    expect(result.push_plan.issues).toContainEqual({
      code: "NON_FAST_FORWARD",
      message:
        "The explicit remote destination cannot be advanced by a normal fast-forward push",
    });
  });

  test("rejects a supplied commit that differs from HEAD before remote inspection", async () => {
    const mainCommit = (
      await requireGit(repositoryRoot, ["rev-parse", "main"])
    ).stdout.trim();

    const result = requireSuccessfulPreflight(
      await preflight({
        local_commit_sha: mainCommit,
        remote: "missing",
      }),
    );

    expect(result.remote_inspection).toBeNull();
    expect(result.push_plan.eligible).toBe(false);
    expect(
      result.push_plan.issues.some(
        (issue) => issue.code === "LOCAL_COMMIT_MISMATCH",
      ),
    ).toBe(true);
  });

  test("rejects the protected base destination before remote inspection", async () => {
    const result = requireSuccessfulPreflight(
      await preflight({
        remote: "missing",
        destination_branch: "main",
      }),
    );

    expect(result.remote_inspection).toBeNull();
    expect(result.push_plan.eligible).toBe(false);
    expect(
      result.push_plan.issues.some(
        (issue) => issue.code === "DESTINATION_PROTECTED",
      ),
    ).toBe(true);
  });

  test("allows unrelated dirty worktree content", async () => {
    await writeFile(join(repositoryRoot, "uncommitted.txt"), "uncommitted\n");

    const result = requireSuccessfulPreflight(await preflight());

    expect(result.state.clean).toBe(false);
    expect(result.push_plan).toMatchObject({
      eligible: true,
      disposition: "create",
      issues: [],
    });
  });

  test("rejects an active merge before remote inspection", async () => {
    await requireGit(repositoryRoot, ["switch", "main"]);
    await requireGit(repositoryRoot, ["switch", "-c", "test/merge-source"]);
    await writeFile(join(repositoryRoot, "merge-source.txt"), "merge source\n");
    await requireGit(repositoryRoot, ["add", "--", "merge-source.txt"]);
    await requireGit(repositoryRoot, ["commit", "-m", "Create merge source"]);

    await requireGit(repositoryRoot, ["switch", workingBranch]);
    await requireGit(repositoryRoot, [
      "merge",
      "--no-commit",
      "test/merge-source",
    ]);

    const result = requireSuccessfulPreflight(
      await preflight({
        remote: "missing",
      }),
    );

    expect(result.remote_inspection).toBeNull();
    expect(result.push_plan.eligible).toBe(false);
    expect(
      result.push_plan.issues.some(
        (issue) => issue.code === "ACTIVE_GIT_OPERATION",
      ),
    ).toBe(true);
  });
});
