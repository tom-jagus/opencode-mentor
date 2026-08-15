import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runGitCheckpointPushPreflight } from "../lib/git_checkpoint_push";
import {
  applyGitCheckpointPushProposal,
  prepareGitCheckpointPushApply,
} from "../lib/git_checkpoint_push_apply";
import {
  buildGitCheckpointPushProposal,
  persistGitCheckpointPushProposal,
} from "../lib/git_checkpoint_push_proposal";

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

describe("Git checkpoint Push Apply preparation", () => {
  let temporaryRoot: string;
  let repositoryRoot: string;
  let remoteRoot: string;
  let storageRoot: string;

  const branch = "feature/push-apply-test";

  const configurationRoot = fileURLToPath(
    new URL("..", import.meta.url),
  ).replace(/\/$/, "");

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(
      join(tmpdir(), "opencode-mentor-push-apply-"),
    );
    repositoryRoot = join(temporaryRoot, "project");
    remoteRoot = join(temporaryRoot, "remote.git");
    storageRoot = join(temporaryRoot, "proposals");

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
    await requireGit(repositoryRoot, ["remote", "add", "review", remoteRoot]);
  });

  afterEach(async () => {
    await rm(temporaryRoot, {
      recursive: true,
      force: true,
    });
  });

  async function persistEligibleProposal() {
    const preflight = await runGitCheckpointPushPreflight({
      directory: repositoryRoot,
      configuration_root: configurationRoot,
      local_commit_sha: await head(repositoryRoot),
      remote: "review",
      destination_branch: branch,
    });

    expect(preflight.ok).toBe(true);

    if (!preflight.ok) {
      throw new Error(`Preflight failed at ${preflight.stage}`);
    }

    expect(preflight.push_plan.eligible).toBe(true);

    const record = buildGitCheckpointPushProposal(preflight);

    await persistGitCheckpointPushProposal(record, storageRoot);

    return record;
  }

  test("prepares an unchanged proposal", async () => {
    const record = await persistEligibleProposal();

    const prepared = await prepareGitCheckpointPushApply({
      directory: repositoryRoot,
      configuration_root: configurationRoot,
      proposal_id: record.proposal.id,
      storage_root: storageRoot,
    });

    expect(prepared.record).toEqual(record);
    expect(prepared.preflight.push_plan.local_commit_sha).toBe(
      record.proposal.operation.local_commit_sha,
    );
  });

  test("rejects a changed remote destination commit", async () => {
    const record = await persistEligibleProposal();

    await requireGit(repositoryRoot, [
      "push",
      "review",
      `HEAD:refs/heads/${branch}`,
    ]);

    await expect(
      prepareGitCheckpointPushApply({
        directory: repositoryRoot,
        configuration_root: configurationRoot,
        proposal_id: record.proposal.id,
        storage_root: storageRoot,
      }),
    ).rejects.toMatchObject({
      code: "STALE_PROPOSAL",
    });
  });

  test("rejects a changed local commit", async () => {
    const record = await persistEligibleProposal();

    await writeFile(join(repositoryRoot, "later.txt"), "later\n");
    await requireGit(repositoryRoot, ["add", "--", "later.txt"]);
    await requireGit(repositoryRoot, [
      "commit",
      "-m",
      "Advance local checkpoint",
    ]);

    await expect(
      prepareGitCheckpointPushApply({
        directory: repositoryRoot,
        configuration_root: configurationRoot,
        proposal_id: record.proposal.id,
        storage_root: storageRoot,
      }),
    ).rejects.toMatchObject({
      code: "STALE_PROPOSAL",
    });
  });

  test("allows unrelated dirty worktree content", async () => {
    const record = await persistEligibleProposal();

    await writeFile(join(repositoryRoot, "dirty.txt"), "dirty\n");

    const prepared = await prepareGitCheckpointPushApply({
      directory: repositoryRoot,
      configuration_root: configurationRoot,
      proposal_id: record.proposal.id,
      storage_root: storageRoot,
    });

    expect(prepared.preflight.state.clean).toBe(false);
  });

  test("does not mutate local or remote state", async () => {
    const record = await persistEligibleProposal();

    const beforeHead = await head(repositoryRoot);

    await prepareGitCheckpointPushApply({
      directory: repositoryRoot,
      configuration_root: configurationRoot,
      proposal_id: record.proposal.id,
      storage_root: storageRoot,
    });

    expect(await head(repositoryRoot)).toBe(beforeHead);

    const remoteResult = await requireGit(remoteRoot, [
      "for-each-ref",
      "--format=%(refname)",
    ]);

    expect(remoteResult.stdout).toBe("");
  });

  test("applies and verifies the exact Push proposal", async () => {
    const record = await persistEligibleProposal();

    const result = await applyGitCheckpointPushProposal({
      directory: repositoryRoot,
      configuration_root: configurationRoot,
      proposal_id: record.proposal.id,
      storage_root: storageRoot,
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result).toMatchObject({
      local_commit_sha: record.proposal.operation.local_commit_sha,
      remote: "review",
      destination_branch: branch,
      destination_ref: `refs/heads/${branch}`,
      remote_commit_sha: record.proposal.operation.local_commit_sha,
      disposition: "create",
      remote_updated: true,
    });

    const remoteCommit = (
      await requireGit(remoteRoot, ["rev-parse", `refs/heads/${branch}`])
    ).stdout.trim();

    expect(remoteCommit).toBe(record.proposal.operation.local_commit_sha);

    await expect(
      prepareGitCheckpointPushApply({
        directory: repositoryRoot,
        configuration_root: configurationRoot,
        proposal_id: record.proposal.id,
        storage_root: storageRoot,
      }),
    ).rejects.toMatchObject({
      code: "PROPOSAL_ALREADY_APPLIED",
    });
  });

  test("reports successful remote mutation when state persistence fails", async () => {
    const record = await persistEligibleProposal();

    const result = await applyGitCheckpointPushProposal(
      {
        directory: repositoryRoot,
        configuration_root: configurationRoot,
        proposal_id: record.proposal.id,
        storage_root: storageRoot,
      },
      {
        persist: async () => {
          throw new Error("Injected persistence failure");
        },
      },
    );

    expect(result).toMatchObject({
      ok: false,
      remote_result: {
        mutation_completed: true,
        state_verified: true,
        rollback_available: false,
      },
    });

    const remoteCommit = (
      await requireGit(remoteRoot, ["rev-parse", `refs/heads/${branch}`])
    ).stdout.trim();

    expect(remoteCommit).toBe(record.proposal.operation.local_commit_sha);
  });
});
