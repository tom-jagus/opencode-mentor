import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runGitStartPreflight } from "../lib/git_start";
import {
  applyGitStartProposal,
  prepareGitStartApply,
} from "../lib/git_start_apply";
import {
  buildGitStartProposal,
  GitStartProposalError,
  persistGitStartProposal,
} from "../lib/git_start_proposal";

type GitResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

async function runGit(
  repositoryRoot: string,
  args: string[],
): Promise<GitResult> {
  const process = Bun.spawn(
    [
      "git",
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.hooksPath=/dev/null",
      ...args,
    ],
    {
      cwd: repositoryRoot,
      env: {
        ...Bun.env,
        GIT_OPTIONAL_LOCKS: "0",
        GIT_TERMINAL_PROMPT: "0",
        LANG: "C",
        LC_ALL: "C",
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);

  return {
    stdout,
    stderr,
    exitCode,
  };
}

async function requireGit(
  repositoryRoot: string,
  args: string[],
): Promise<GitResult> {
  const result = await runGit(repositoryRoot, args);

  if (result.exitCode !== 0) {
    throw new Error(
      result.stderr.trim() ||
        `git ${args.join(" ")} exited with code ${result.exitCode}`,
    );
  }

  return result;
}

async function createRepository(repositoryRoot: string): Promise<void> {
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

  await writeFile(
    join(repositoryRoot, "README.md"),
    "# Test repository\n",
    "utf8",
  );

  await requireGit(repositoryRoot, ["add", "--", "README.md"]);
  await requireGit(repositoryRoot, [
    "commit",
    "-m",
    "Establish test repository",
  ]);
}

describe("prepareGitStartApply", () => {
  let temporaryRoot: string;
  let repositoryRoot: string;
  let storageRoot: string;

  const configurationRoot = fileURLToPath(
    new URL("..", import.meta.url),
  ).replace(/\/$/, "");

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(
      join(tmpdir(), "opencode-mentor-git-start-apply-"),
    );
    repositoryRoot = join(temporaryRoot, "project");
    storageRoot = join(temporaryRoot, "proposals");

    await createRepository(repositoryRoot);
  });

  afterEach(async () => {
    await rm(temporaryRoot, {
      recursive: true,
      force: true,
    });
  });

  async function persistEligibleProposal(
    targetBranch = "feature/apply-preparation-test",
  ) {
    const preflight = await runGitStartPreflight({
      directory: repositoryRoot,
      configuration_root: configurationRoot,
      target_branch: targetBranch,
    });

    expect(preflight.ok).toBe(true);

    if (!preflight.ok) {
      throw new Error(`Preflight failed at ${preflight.stage}`);
    }

    expect(preflight.eligibility.eligible).toBe(true);

    const record = buildGitStartProposal(preflight);

    await persistGitStartProposal(record, storageRoot);

    return record;
  }

  test("prepares an unchanged eligible proposal", async () => {
    const record = await persistEligibleProposal();

    const prepared = await prepareGitStartApply({
      directory: repositoryRoot,
      configuration_root: configurationRoot,
      proposal_id: record.proposal.id,
      storage_root: storageRoot,
    });

    expect(prepared.record.proposal.id).toBe(record.proposal.id);
    expect(prepared.preflight.eligibility.eligible).toBe(true);
    expect(prepared.preflight.state.latest_commit?.sha).toBe(
      record.proposal.operation.head_sha,
    );
    expect(prepared.preflight.target_branch_exists).toBe(false);
  });

  test("rejects a proposal after HEAD changes", async () => {
    const record = await persistEligibleProposal();

    await requireGit(repositoryRoot, [
      "commit",
      "--allow-empty",
      "-m",
      "Advance test repository",
    ]);

    await expect(
      prepareGitStartApply({
        directory: repositoryRoot,
        configuration_root: configurationRoot,
        proposal_id: record.proposal.id,
        storage_root: storageRoot,
      }),
    ).rejects.toMatchObject({
      code: "STALE_PROPOSAL",
      message: "Git start proposal is stale: HEAD changed",
    });
  });

  test("rejects a proposal when the target branch appears", async () => {
    const targetBranch = "feature/appearing-branch";

    const record = await persistEligibleProposal(targetBranch);

    await requireGit(repositoryRoot, ["branch", targetBranch]);

    await expect(
      prepareGitStartApply({
        directory: repositoryRoot,
        configuration_root: configurationRoot,
        proposal_id: record.proposal.id,
        storage_root: storageRoot,
      }),
    ).rejects.toMatchObject({
      code: "STALE_PROPOSAL",
    });
  });

  test("rejects a proposal after the working tree becomes dirty", async () => {
    const record = await persistEligibleProposal();

    await writeFile(
      join(repositoryRoot, "uncommitted.txt"),
      "uncommitted\n",
      "utf8",
    );

    await expect(
      prepareGitStartApply({
        directory: repositoryRoot,
        configuration_root: configurationRoot,
        proposal_id: record.proposal.id,
        storage_root: storageRoot,
      }),
    ).rejects.toMatchObject({
      code: "STALE_PROPOSAL",
    });
  });

  test("does not mutate Git state while preparing Apply", async () => {
    const record = await persistEligibleProposal("feature/no-mutation-test");

    await prepareGitStartApply({
      directory: repositoryRoot,
      configuration_root: configurationRoot,
      proposal_id: record.proposal.id,
      storage_root: storageRoot,
    });

    const branch = await requireGit(repositoryRoot, [
      "symbolic-ref",
      "--short",
      "HEAD",
    ]);

    expect(branch.stdout.trim()).toBe("main");

    const target = await runGit(repositoryRoot, [
      "show-ref",
      "--verify",
      "--quiet",
      "refs/heads/feature/no-mutation-test",
    ]);

    expect(target.exitCode).toBe(1);
  });

  test("prepares Apply from a repository subdirectory", async () => {
    const record = await persistEligibleProposal();

    const subdirectory = join(repositoryRoot, "nested");

    await mkdir(subdirectory);

    const prepared = await prepareGitStartApply({
      directory: subdirectory,
      configuration_root: configurationRoot,
      proposal_id: record.proposal.id,
      storage_root: storageRoot,
    });

    expect(prepared.record.proposal.id).toBe(record.proposal.id);
    expect(prepared.preflight.state.root).toBe(repositoryRoot);
  });

  // Successful Apply
  test("creates and switches to the reviewed target branch", async () => {
    const targetBranch = "feature/successful-apply";

    const record = await persistEligibleProposal(targetBranch);

    const result = await applyGitStartProposal({
      directory: repositoryRoot,
      configuration_root: configurationRoot,
      proposal_id: record.proposal.id,
      storage_root: storageRoot,
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(`${result.error.code}: ${result.error.message}`);
    }

    expect(result.branch).toBe(targetBranch);
    expect(result.base_branch).toBe("main");
    expect(result.head_sha).toBe(record.proposal.operation.head_sha);

    const currentBranch = await requireGit(repositoryRoot, [
      "symbolic-ref",
      "--short",
      "HEAD",
    ]);

    expect(currentBranch.stdout.trim()).toBe(targetBranch);

    const head = await requireGit(repositoryRoot, ["rev-parse", "HEAD"]);

    expect(head.stdout.trim()).toBe(record.proposal.operation.head_sha);

    const target = await runGit(repositoryRoot, [
      "show-ref",
      "--verify",
      "--quiet",
      `refs/heads/${targetBranch}`,
    ]);

    expect(target.exitCode).toBe(0);
  });
  // Applied state persistence
  test("marks a successful proposal as applied", async () => {
    const record = await persistEligibleProposal("feature/applied-state-test");

    const result = await applyGitStartProposal({
      directory: repositoryRoot,
      configuration_root: configurationRoot,
      proposal_id: record.proposal.id,
      storage_root: storageRoot,
    });

    expect(result.ok).toBe(true);

    const proposalPath = join(
      storageRoot,
      record.proposal.project.key,
      `${record.proposal.id}.json`,
    );

    const stored = JSON.parse(await readFile(proposalPath, "utf8"));

    expect(stored.state.status).toBe("applied");
    expect(typeof stored.state.applied_at).toBe("string");
    expect(Number.isNaN(Date.parse(stored.state.applied_at))).toBe(false);
  });
  // Single-use enforcement
  test("rejects a second Apply of the same proposal", async () => {
    const record = await persistEligibleProposal("feature/single-use-test");

    const first = await applyGitStartProposal({
      directory: repositoryRoot,
      configuration_root: configurationRoot,
      proposal_id: record.proposal.id,
      storage_root: storageRoot,
    });

    expect(first.ok).toBe(true);

    const second = await applyGitStartProposal({
      directory: repositoryRoot,
      configuration_root: configurationRoot,
      proposal_id: record.proposal.id,
      storage_root: storageRoot,
    });

    expect(second).toMatchObject({
      version: 1,
      ok: false,
      proposal_id: record.proposal.id,
      error: {
        code: "PROPOSAL_ALREADY_APPLIED",
      },
    });
  });
  // Persistence failure rollback
  test("rolls back when applied-state persistence fails", async () => {
    const targetBranch = "feature/persistence-rollback";

    const record = await persistEligibleProposal(targetBranch);

    const result = await applyGitStartProposal(
      {
        directory: repositoryRoot,
        configuration_root: configurationRoot,
        proposal_id: record.proposal.id,
        storage_root: storageRoot,
      },
      {
        persist: async () => {
          throw new GitStartProposalError(
            "PROPOSAL_STATE_FAILED",
            "Injected proposal-state failure",
          );
        },
      },
    );

    expect(result).toMatchObject({
      version: 1,
      ok: false,
      error: {
        code: "PROPOSAL_STATE_FAILED",
        message: "Injected proposal-state failure",
      },
      rollback: {
        succeeded: true,
        errors: [],
      },
    });

    const branch = await requireGit(repositoryRoot, [
      "symbolic-ref",
      "--short",
      "HEAD",
    ]);

    expect(branch.stdout.trim()).toBe("main");

    const target = await runGit(repositoryRoot, [
      "show-ref",
      "--verify",
      "--quiet",
      `refs/heads/${targetBranch}`,
    ]);

    expect(target.exitCode).toBe(1);
  });
  // Stale proposal performs no mutation
  test("does not mutate a stale proposal", async () => {
    const targetBranch = "feature/stale-apply-test";

    const record = await persistEligibleProposal(targetBranch);

    await writeFile(join(repositoryRoot, "dirty.txt"), "dirty\n", "utf8");

    const result = await applyGitStartProposal({
      directory: repositoryRoot,
      configuration_root: configurationRoot,
      proposal_id: record.proposal.id,
      storage_root: storageRoot,
    });

    expect(result).toMatchObject({
      version: 1,
      ok: false,
      error: {
        code: "STALE_PROPOSAL",
      },
    });

    const branch = await requireGit(repositoryRoot, [
      "symbolic-ref",
      "--short",
      "HEAD",
    ]);

    expect(branch.stdout.trim()).toBe("main");

    const target = await runGit(repositoryRoot, [
      "show-ref",
      "--verify",
      "--quiet",
      `refs/heads/${targetBranch}`,
    ]);

    expect(target.exitCode).toBe(1);
  });

  test("rejects concurrent Apply while the proposal is locked", async () => {
    const targetBranch = "feature/concurrent-apply-test";

    const record = await persistEligibleProposal(targetBranch);

    const proposalPath = join(
      storageRoot,
      record.proposal.project.key,
      `${record.proposal.id}.json`,
    );

    const lockPath = `${proposalPath}.apply.lock`;

    await writeFile(lockPath, "existing-apply\n", {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });

    const result = await applyGitStartProposal({
      directory: repositoryRoot,
      configuration_root: configurationRoot,
      proposal_id: record.proposal.id,
      storage_root: storageRoot,
    });

    expect(result).toMatchObject({
      version: 1,
      ok: false,
      error: {
        code: "APPLY_IN_PROGRESS",
      },
    });

    const branch = await requireGit(repositoryRoot, [
      "symbolic-ref",
      "--short",
      "HEAD",
    ]);

    expect(branch.stdout.trim()).toBe("main");

    const target = await runGit(repositoryRoot, [
      "show-ref",
      "--verify",
      "--quiet",
      `refs/heads/${targetBranch}`,
    ]);

    expect(target.exitCode).toBe(1);
  });
});
