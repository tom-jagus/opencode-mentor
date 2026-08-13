import { randomUUID } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import type { GitStartPreflight } from "./git_start";
import { runGitStartPreflight } from "./git_start";
import {
  createAndSwitchGitStartBranch,
  GitStartMutationError,
  rollbackGitStartBranch,
} from "./git_start_mutation";
import type { GitStartMutationResult } from "./git_start_mutation";
import {
  GitStartProposalError,
  loadGitStartProposal,
  policyResolutionChecksum,
} from "./git_start_proposal";
import type { GitStartProposalRecord } from "./git_start_proposal";
import { inspectGitState } from "./git_state";

export type GitStartApplyPreparation = {
  record: GitStartProposalRecord;
  record_path: string;
  preflight: Extract<GitStartPreflight, { ok: true }>;
};

export type PrepareGitStartApplyInput = {
  directory: string;
  configuration_root: string;
  proposal_id: string;
  storage_root?: string;
};

export type GitStartApplySuccess = {
  version: 1;
  ok: true;
  proposal_id: string;
  applied_at: string;
  repository_root: string;
  base_branch: string;
  branch: string;
  head_sha: string;
};

export type GitStartApplyFailure = {
  version: 1;
  ok: false;
  proposal_id: string;
  error: {
    code: string;
    message: string;
  };
  rollback?: {
    succeeded: boolean;
    errors: string[];
  };
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stale(message: string): never {
  throw new GitStartProposalError(
    "STALE_PROPOSAL",
    `Git start proposal is stale: ${message}`,
  );
}

export async function prepareGitStartApply(
  input: PrepareGitStartApplyInput,
): Promise<GitStartApplyPreparation> {
  const initialState = await inspectGitState(input.directory);

  if (!initialState.available) {
    stale(`Git inspection failed: ${initialState.error}`);
  }

  if (!initialState.repository) {
    stale("the current workspace is not inside a Git repository");
  }

  const loaded = await loadGitStartProposal(
    initialState.root,
    input.proposal_id,
    input.storage_root,
  );

  const proposal = loaded.record.proposal;

  const preflight = await runGitStartPreflight({
    directory: initialState.root,
    configuration_root: input.configuration_root,
    target_branch: proposal.operation.target_branch,
  });

  if (!preflight.ok) {
    stale(preflight.error.message);
  }

  if (!preflight.eligibility.eligible) {
    stale(
      preflight.eligibility.issues
        .map((issue) => `${issue.code}: ${issue.message}`)
        .join("; "),
    );
  }

  const currentPolicyChecksum = policyResolutionChecksum(
    preflight.policy_resolution,
  );

  if (preflight.state.root !== proposal.project.root) {
    stale("repository root changed");
  }

  if (preflight.state.branch !== proposal.operation.base_branch) {
    stale("current branch changed");
  }

  if (preflight.state.latest_commit?.sha !== proposal.operation.head_sha) {
    stale("HEAD changed");
  }

  if (
    preflight.policy_resolution.effective_policy.base_branch !==
    proposal.operation.base_branch
  ) {
    stale("effective base branch changed");
  }

  if (currentPolicyChecksum !== proposal.policy.resolution_sha256) {
    stale("effective policy changed");
  }

  if (preflight.target_branch_exists) {
    stale("target branch now exists");
  }

  return {
    record: loaded.record,
    record_path: loaded.record_path,
    preflight,
  };
}

async function acquireApplyLock(recordPath: string): Promise<string> {
  const lockPath = `${recordPath}.apply.lock`;

  try {
    await writeFile(lockPath, `${process.pid}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
  } catch (error) {
    throw new GitStartProposalError(
      "APPLY_IN_PROGRESS",
      `Git start proposal is already being applied: ${errorMessage(error)}`,
    );
  }

  return lockPath;
}

async function releaseApplyLock(lockPath: string): Promise<void> {
  try {
    await unlink(lockPath);
  } catch {
    // A completed operation must not be
    // reported as failed only because lock
    // cleanup failed.
  }
}

export async function persistGitStartAppliedState(
  recordPath: string,
  expectedRecord: GitStartProposalRecord,
  appliedAt: string,
): Promise<void> {
  const expected = `${JSON.stringify(expectedRecord, null, 2)}\n`;

  let current: string;

  try {
    current = await readFile(recordPath, "utf8");
  } catch (error) {
    throw new GitStartProposalError(
      "PROPOSAL_STATE_FAILED",
      `Could not reread proposal state: ${errorMessage(error)}`,
    );
  }

  if (current !== expected) {
    throw new GitStartProposalError(
      "PROPOSAL_STATE_FAILED",
      "Proposal state changed during Apply",
    );
  }

  const appliedRecord: GitStartProposalRecord = {
    ...expectedRecord,
    state: {
      status: "applied",
      applied_at: appliedAt,
    },
  };

  const temporaryPath = `${recordPath}.${randomUUID()}.tmp`;

  try {
    await writeFile(
      temporaryPath,
      `${JSON.stringify(appliedRecord, null, 2)}\n`,
      {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      },
    );

    await rename(temporaryPath, recordPath);
  } catch (error) {
    try {
      await unlink(temporaryPath);
    } catch {
      // Best-effort cleanup.
    }

    throw new GitStartProposalError(
      "PROPOSAL_STATE_FAILED",
      `Could not persist applied proposal state: ${errorMessage(error)}`,
    );
  }
}

export async function applyGitStartProposal(
  input: PrepareGitStartApplyInput,
  dependencies: {
    mutate?: (value: {
      repository_root: string;
      base_branch: string;
      target_branch: string;
      head_sha: string;
    }) => Promise<GitStartMutationResult>;
    persist?: (
      recordPath: string,
      record: GitStartProposalRecord,
      appliedAt: string,
    ) => Promise<void>;
  } = {},
): Promise<GitStartApplySuccess | GitStartApplyFailure> {
  const mutate = dependencies.mutate ?? createAndSwitchGitStartBranch;
  const persist = dependencies.persist ?? persistGitStartAppliedState;

  let lockPath: string | null = null;
  let mutation: GitStartMutationResult | null = null;

  try {
    // Preliminary validation discovers and
    // validates the reviewed record path.
    const preliminary = await prepareGitStartApply(input);

    lockPath = await acquireApplyLock(preliminary.record_path);

    // Revalidate after acquiring the lock.
    const prepared = await prepareGitStartApply(input);

    const proposal = prepared.record.proposal;

    mutation = await mutate({
      repository_root: proposal.project.root,
      base_branch: proposal.operation.base_branch,
      target_branch: proposal.operation.target_branch,
      head_sha: proposal.operation.head_sha,
    });

    const appliedAt = new Date().toISOString();

    await persist(prepared.record_path, prepared.record, appliedAt);

    return {
      version: 1,
      ok: true,
      proposal_id: proposal.id,
      applied_at: appliedAt,
      repository_root: mutation.repository_root,
      base_branch: mutation.base_branch,
      branch: mutation.target_branch,
      head_sha: mutation.head_sha,
    };
  } catch (error) {
    if (error instanceof GitStartMutationError) {
      return {
        version: 1,
        ok: false,
        proposal_id: input.proposal_id,
        error: {
          code: error.rollback.succeeded ? "APPLY_FAILED" : "ROLLBACK_FAILED",
          message: error.message,
        },
        rollback: error.rollback,
      };
    }
    if (mutation) {
      const rollback = await rollbackGitStartBranch(mutation);

      if (!rollback.succeeded) {
        return {
          version: 1,
          ok: false,
          proposal_id: input.proposal_id,
          error: {
            code: "ROLLBACK_FAILED",
            message:
              "Git start Apply failed and rollback could not restore the repository",
          },
          rollback,
        };
      }

      return {
        version: 1,
        ok: false,
        proposal_id: input.proposal_id,
        error: {
          code:
            error instanceof GitStartProposalError
              ? error.code
              : "APPLY_FAILED",
          message: errorMessage(error),
        },
        rollback,
      };
    }

    return {
      version: 1,
      ok: false,
      proposal_id: input.proposal_id,
      error: {
        code:
          error instanceof GitStartProposalError ? error.code : "APPLY_FAILED",
        message: errorMessage(error),
      },
    };
  } finally {
    if (lockPath) {
      await releaseApplyLock(lockPath);
    }
  }
}
