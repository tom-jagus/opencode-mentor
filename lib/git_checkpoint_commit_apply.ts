import type { GitCheckpointCommitPreflight } from "./git_checkpoint_commit";
import { runGitCheckpointCommitPreflight } from "./git_checkpoint_commit";
import type { GitCheckpointCommitProposalRecord } from "./git_checkpoint_commit_proposal";
import {
  GitCheckpointCommitProposalError,
  loadGitCheckpointCommitProposal,
} from "./git_checkpoint_commit_proposal";
import { inspectGitState } from "./git_state";
import { policyResolutionChecksum, sha256 } from "./git_lifecycle_proposal";
import { randomUUID } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { inspectGitCheckpointCommittedDiff } from "./git_checkpoint_commit_diff";
import {
  commitGitCheckpoint,
  GitCheckpointCommitMutationError,
  rollbackGitCheckpointCommit,
} from "./git_checkpoint_commit_mutation";
import type { GitCheckpointCommitReceipt } from "./git_checkpoint_commit_mutation";
import type { GitState } from "./git_state";

export type GitCheckpointCommitFreshnessValidation = {
  record: GitCheckpointCommitProposalRecord;
  preflight: Extract<GitCheckpointCommitPreflight, { ok: true }>;
};

export type PrepareGitCheckpointCommitApplyInput = {
  directory: string;
  configuration_root: string;
  proposal_id: string;
  storage_root?: string;
};

export type GitCheckpointCommitApplyPreparation = {
  record: GitCheckpointCommitProposalRecord;
  record_path: string;
  preflight: Extract<GitCheckpointCommitPreflight, { ok: true }>;
};

function stale(message: string): never {
  throw new GitCheckpointCommitProposalError(
    "STALE_PROPOSAL",
    `Git checkpoint Commit proposal is stale: ${message}`,
  );
}

export function validateGitCheckpointCommitApplyFreshness(
  record: GitCheckpointCommitProposalRecord,
  preflight: GitCheckpointCommitPreflight,
): GitCheckpointCommitFreshnessValidation {
  if (!preflight.ok) {
    stale(preflight.error.message);
  }

  if (!preflight.commit_plan.eligible) {
    stale(
      preflight.commit_plan.issues
        .map((issue) => `${issue.code}: ${issue.message}`)
        .join("; "),
    );
  }

  if (preflight.diff === null) {
    stale("staged diff is unavailable");
  }

  const proposal = record.proposal;
  const operation = proposal.operation;
  const commitPlan = preflight.commit_plan;
  const diff = preflight.diff;

  if (preflight.state.root !== proposal.project.root) {
    stale("repository root changed");
  }

  if (preflight.state.branch !== operation.current_branch) {
    stale("current branch changed");
  }

  if (preflight.state.latest_commit?.sha !== operation.head_sha) {
    stale("HEAD changed");
  }

  if (commitPlan.base_branch !== operation.base_branch) {
    stale("effective base branch changed");
  }

  if (
    policyResolutionChecksum(preflight.policy_resolution) !==
    proposal.policy.resolution_sha256
  ) {
    stale("effective policy changed");
  }

  if (
    commitPlan.commit_message !== operation.commit_message ||
    sha256(commitPlan.commit_message) !== operation.commit_message_sha256
  ) {
    stale("commit message changed");
  }

  if (
    diff.repository_root !== proposal.project.root ||
    diff.patch_bytes !== proposal.repository.staged_diff.patch_bytes ||
    diff.patch_sha256 !== proposal.repository.staged_diff.patch_sha256
  ) {
    stale("staged diff changed");
  }

  return {
    record,
    preflight,
  };
}

export async function prepareGitCheckpointCommitApply(
  input: PrepareGitCheckpointCommitApplyInput,
): Promise<GitCheckpointCommitApplyPreparation> {
  const initialState = await inspectGitState(input.directory);

  if (!initialState.available) {
    stale(`Git inspection failed: ${initialState.error}`);
  }

  if (!initialState.repository) {
    stale("the current workspace is not inside a Git repository");
  }

  const loaded = await loadGitCheckpointCommitProposal(
    initialState.root,
    input.proposal_id,
    input.storage_root,
  );

  const preflight = await runGitCheckpointCommitPreflight({
    directory: initialState.root,
    configuration_root: input.configuration_root,
    commit_message: loaded.record.proposal.operation.commit_message,
  });

  const validated = validateGitCheckpointCommitApplyFreshness(
    loaded.record,
    preflight,
  );

  return {
    record: validated.record,
    record_path: loaded.record_path,
    preflight: validated.preflight,
  };
}

export type GitCheckpointCommitVerification = {
  repository_root: string;
  branch: string;
  previous_head_sha: string;
  commit_sha: string;
  committed_diff_sha256: string;
};

export type GitCheckpointCommitApplySuccess = {
  version: 1;
  ok: true;
  proposal_id: string;
  applied_at: string;
  repository_root: string;
  branch: string;
  previous_head_sha: string;
  commit_sha: string;
  committed_diff_sha256: string;
  warnings: string[];
};

export type GitCheckpointCommitApplyFailure = {
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

function isStaged(indexStatus: string): boolean {
  return indexStatus !== " " && indexStatus !== "?" && indexStatus !== "!";
}

function verificationFailure(message: string): never {
  throw new GitCheckpointCommitProposalError(
    "APPLY_FAILED",
    `Git checkpoint Commit verification failed: ${message}`,
  );
}

export function verifyGitCheckpointCommitResult(
  record: GitCheckpointCommitProposalRecord,
  receipt: GitCheckpointCommitReceipt,
  state: GitState,
  committedDiff: {
    repository_root: string;
    patch_bytes: number;
    patch_sha256: string;
  },
): GitCheckpointCommitVerification {
  if (!state.available) {
    verificationFailure(`Git inspection failed: ${state.error}`);
  }

  if (!state.repository) {
    verificationFailure("the workspace is no longer inside a Git repository");
  }

  const proposal = record.proposal;
  const operation = proposal.operation;

  if (
    receipt.repository_root !== proposal.project.root ||
    state.root !== proposal.project.root ||
    committedDiff.repository_root !== proposal.project.root
  ) {
    verificationFailure("repository root changed");
  }

  if (
    receipt.branch !== operation.current_branch ||
    state.branch !== operation.current_branch
  ) {
    verificationFailure("current branch changed");
  }

  if (
    receipt.previous_head_sha !== operation.head_sha ||
    state.latest_commit?.sha !== receipt.commit_sha
  ) {
    verificationFailure("resulting HEAD does not match the created commit");
  }

  if (state.conflicts.length > 0) {
    verificationFailure("unresolved conflicts appeared");
  }

  const stagedChanges = state.changes.filter((change) =>
    isStaged(change.index_status),
  );

  if (stagedChanges.length > 0) {
    verificationFailure(
      `staged changes remain after commit: ${stagedChanges
        .map((change) => change.path)
        .join(", ")}`,
    );
  }

  if (
    committedDiff.patch_bytes !== proposal.repository.staged_diff.patch_bytes ||
    committedDiff.patch_sha256 !== proposal.repository.staged_diff.patch_sha256
  ) {
    verificationFailure("created commit differs from the reviewed staged diff");
  }

  return {
    repository_root: state.root,
    branch: state.branch,
    previous_head_sha: receipt.previous_head_sha,
    commit_sha: receipt.commit_sha,
    committed_diff_sha256: committedDiff.patch_sha256,
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
    throw new GitCheckpointCommitProposalError(
      "APPLY_IN_PROGRESS",
      `Git checkpoint Commit proposal is already being applied: ${errorMessage(error)}`,
    );
  }

  return lockPath;
}

async function releaseApplyLock(lockPath: string): Promise<void> {
  try {
    await unlink(lockPath);
  } catch {
    // Completed Apply must not fail only
    // because lock cleanup failed.
  }
}

export async function persistGitCheckpointCommitAppliedState(
  recordPath: string,
  expectedRecord: GitCheckpointCommitProposalRecord,
  appliedAt: string,
): Promise<void> {
  const expected = `${JSON.stringify(expectedRecord, null, 2)}\n`;

  let current: string;

  try {
    current = await readFile(recordPath, "utf8");
  } catch (error) {
    throw new GitCheckpointCommitProposalError(
      "PROPOSAL_STATE_FAILED",
      `Could not reread Commit proposal state: ${errorMessage(error)}`,
    );
  }

  if (current !== expected) {
    throw new GitCheckpointCommitProposalError(
      "PROPOSAL_STATE_FAILED",
      "Commit proposal state changed during Apply",
    );
  }

  const appliedRecord: GitCheckpointCommitProposalRecord = {
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

    throw new GitCheckpointCommitProposalError(
      "PROPOSAL_STATE_FAILED",
      `Could not persist applied Commit proposal state: ${errorMessage(error)}`,
    );
  }
}

export async function applyGitCheckpointCommitProposal(
  input: PrepareGitCheckpointCommitApplyInput,
  dependencies: {
    persist?: (
      recordPath: string,
      record: GitCheckpointCommitProposalRecord,
      appliedAt: string,
    ) => Promise<void>;
  } = {},
): Promise<GitCheckpointCommitApplySuccess | GitCheckpointCommitApplyFailure> {
  const persist =
    dependencies.persist ?? persistGitCheckpointCommitAppliedState;

  let lockPath: string | null = null;
  let receipt: GitCheckpointCommitReceipt | null = null;

  try {
    const preliminary = await prepareGitCheckpointCommitApply(input);

    lockPath = await acquireApplyLock(preliminary.record_path);

    const prepared = await prepareGitCheckpointCommitApply(input);

    const proposal = prepared.record.proposal;

    receipt = await commitGitCheckpoint(
      proposal.project.root,
      proposal.operation.current_branch,
      proposal.operation.head_sha,
      proposal.operation.commit_message,
    );

    const [resultingState, committedDiff] = await Promise.all([
      inspectGitState(proposal.project.root),
      inspectGitCheckpointCommittedDiff(
        proposal.project.root,
        receipt.previous_head_sha,
        receipt.commit_sha,
      ),
    ]);

    const verified = verifyGitCheckpointCommitResult(
      prepared.record,
      receipt,
      resultingState,
      committedDiff,
    );

    const appliedAt = new Date().toISOString();

    await persist(prepared.record_path, prepared.record, appliedAt);

    receipt = null;

    return {
      version: 1,
      ok: true,
      proposal_id: proposal.id,
      applied_at: appliedAt,
      repository_root: verified.repository_root,
      branch: verified.branch,
      previous_head_sha: verified.previous_head_sha,
      commit_sha: verified.commit_sha,
      committed_diff_sha256: verified.committed_diff_sha256,
      warnings: [],
    };
  } catch (error) {
    if (receipt !== null) {
      try {
        await rollbackGitCheckpointCommit(receipt);

        return {
          version: 1,
          ok: false,
          proposal_id: input.proposal_id,
          error: {
            code:
              error instanceof GitCheckpointCommitProposalError
                ? error.code
                : error instanceof GitCheckpointCommitMutationError
                  ? error.code
                  : "APPLY_FAILED",
            message: errorMessage(error),
          },
          rollback: {
            succeeded: true,
            errors: [],
          },
        };
      } catch (rollbackError) {
        return {
          version: 1,
          ok: false,
          proposal_id: input.proposal_id,
          error: {
            code: "ROLLBACK_FAILED",
            message:
              "Git checkpoint Commit Apply failed and conditional rollback could not restore the repository",
          },
          rollback: {
            succeeded: false,
            errors: [errorMessage(rollbackError)],
          },
        };
      }
    }

    if (
      error instanceof GitCheckpointCommitMutationError &&
      error.code === "ROLLBACK_FAILED"
    ) {
      return {
        version: 1,
        ok: false,
        proposal_id: input.proposal_id,
        error: {
          code: "ROLLBACK_FAILED",
          message: error.message,
        },
        rollback: {
          succeeded: false,
          errors: [error.message],
        },
      };
    }

    return {
      version: 1,
      ok: false,
      proposal_id: input.proposal_id,
      error: {
        code:
          error instanceof GitCheckpointCommitProposalError
            ? error.code
            : error instanceof GitCheckpointCommitMutationError
              ? error.code
              : "APPLY_FAILED",
        message: errorMessage(error),
      },
    };
  } finally {
    if (lockPath !== null) {
      await releaseApplyLock(lockPath);
    }
  }
}
