import type { GitFinishUpdatePreflight } from "./git_finish_update";
import { runGitFinishUpdatePreflight } from "./git_finish_update";
import { loadGitFinishUpdateProposal } from "./git_finish_update_proposal_storage";
import { policyResolutionChecksum, sha256 } from "./git_lifecycle_proposal";
import { inspectGitState } from "./git_state";
import { randomUUID } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import {
  inspectGitCheckpointOperationState,
  type GitCheckpointOperationState,
} from "./git_checkpoint_operation_state";
import {
  GitFinishUpdateMutationError,
  rollbackGitFinishUpdate,
  updateGitFinishBranch,
  type GitFinishUpdateReceipt,
} from "./git_finish_update_mutation";
import type { GitState } from "./git_state";
import {
  GitFinishUpdateProposalError,
  type GitFinishUpdateAppliedResult,
  type GitFinishUpdateProposalRecord,
} from "./git_finish_update_proposal";

export type GitFinishUpdateFreshnessValidation = {
  record: GitFinishUpdateProposalRecord;
  preflight: Extract<GitFinishUpdatePreflight, { ok: true }>;
};

export type PrepareGitFinishUpdateApplyInput = {
  directory: string;
  configuration_root: string;
  proposal_id: string;
  storage_root?: string;
};

export type GitFinishUpdateApplyPreparation = {
  record: GitFinishUpdateProposalRecord;
  record_path: string;
  preflight: Extract<GitFinishUpdatePreflight, { ok: true }>;
};

function stale(message: string): never {
  throw new GitFinishUpdateProposalError(
    "STALE_PROPOSAL",
    `Git Finish Update proposal is stale: ${message}`,
  );
}

export function validateGitFinishUpdateApplyFreshness(
  record: GitFinishUpdateProposalRecord,
  preflight: GitFinishUpdatePreflight,
): GitFinishUpdateFreshnessValidation {
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

  if (preflight.remote_inspection === null || preflight.update_plan === null) {
    stale("remote inspection or Update plan is unavailable");
  }

  const proposal = record.proposal;
  const operation = proposal.operation;
  const updatePlan = preflight.update_plan;
  const remoteInspection = preflight.remote_inspection;

  if (preflight.state.root !== proposal.project.root) {
    stale("repository root changed");
  }

  if (preflight.state.branch !== operation.current_branch) {
    stale("current branch changed");
  }

  if (
    preflight.state.latest_commit?.sha !== operation.local_head_sha ||
    updatePlan.local_head_sha !== operation.local_head_sha
  ) {
    stale("local HEAD changed");
  }

  if (
    preflight.state.clean !== true ||
    preflight.state.conflicts.length !== 0
  ) {
    stale("working tree or conflict state changed");
  }

  if (preflight.operation_state.active_operations.length !== 0) {
    stale("an active Git operation is present");
  }

  if (
    updatePlan.base_branch !== operation.base_branch ||
    remoteInspection.base_branch !== operation.base_branch
  ) {
    stale("effective base branch changed");
  }

  if (
    policyResolutionChecksum(preflight.policy_resolution) !==
    proposal.policy.resolution_sha256
  ) {
    stale("effective policy changed");
  }

  if (
    updatePlan.remote !== operation.remote ||
    remoteInspection.remote !== operation.remote
  ) {
    stale("explicit remote changed");
  }

  if (
    updatePlan.selected_fetch_url !== proposal.remote.fetch_url ||
    remoteInspection.selected_fetch_url !== proposal.remote.fetch_url ||
    sha256(remoteInspection.selected_fetch_url) !==
      proposal.remote.fetch_url_sha256
  ) {
    stale("effective remote fetch URL changed");
  }

  if (
    updatePlan.remote_base_ref !== proposal.remote.base_ref ||
    remoteInspection.base_ref !== proposal.remote.base_ref
  ) {
    stale("remote base ref changed");
  }

  if (
    updatePlan.remote_base_commit_sha !== proposal.remote.base_commit_sha ||
    remoteInspection.base_commit_sha !== proposal.remote.base_commit_sha
  ) {
    stale("remote base commit changed");
  }

  if (updatePlan.action !== operation.action) {
    stale("Update action changed");
  }

  return {
    record,
    preflight,
  };
}

export async function prepareGitFinishUpdateApply(
  input: PrepareGitFinishUpdateApplyInput,
): Promise<GitFinishUpdateApplyPreparation> {
  const initialState = await inspectGitState(input.directory);

  if (!initialState.available) {
    stale(`Git inspection failed: ${initialState.error}`);
  }

  if (!initialState.repository) {
    stale("the current workspace is not inside a Git repository");
  }

  const loaded = await loadGitFinishUpdateProposal(
    initialState.root,
    input.proposal_id,
    input.storage_root,
  );

  const proposal = loaded.record.proposal;

  const preflight = await runGitFinishUpdatePreflight({
    directory: initialState.root,
    configuration_root: input.configuration_root,
    remote: proposal.operation.remote,
  });

  const validated = validateGitFinishUpdateApplyFreshness(
    loaded.record,
    preflight,
  );

  return {
    record: validated.record,
    record_path: loaded.record_path,
    preflight: validated.preflight,
  };
}

export type GitFinishUpdateVerification = {
  repository_root: string;
  branch: string;
  previous_head_sha: string;
  resulting_head_sha: string;
  base_commit_sha: string;
  rebased: boolean;
};

export type GitFinishUpdateApplySuccess = {
  version: 1;
  ok: true;
  proposal_id: string;
  applied_at: string;
  repository_root: string;
  branch: string;
  previous_head_sha: string;
  resulting_head_sha: string;
  remote: string;
  base_branch: string;
  base_ref: string;
  base_commit_sha: string;
  action: "fetch-and-rebase" | "not-required";
  rebased: boolean;
  warnings: string[];
};

export type GitFinishUpdateApplyFailure = {
  version: 1;
  ok: false;
  proposal_id: string;
  error: {
    code: string;
    message: string;
  };
  rollback: {
    attempted: boolean;
    succeeded: boolean;
    errors: string[];
  };
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function verificationFailure(message: string): never {
  throw new GitFinishUpdateProposalError(
    "APPLY_FAILED",
    `Git Finish Update verification failed: ${message}`,
  );
}

export function verifyGitFinishUpdateResult(
  record: GitFinishUpdateProposalRecord,
  receipt: GitFinishUpdateReceipt,
  state: GitState,
  operationState: GitCheckpointOperationState,
): GitFinishUpdateVerification {
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
    state.root !== proposal.project.root
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
    receipt.previous_head_sha !== operation.local_head_sha ||
    state.latest_commit?.sha !== receipt.resulting_head_sha
  ) {
    verificationFailure("branch HEAD does not match the Update result");
  }

  if (
    receipt.base_branch !== operation.base_branch ||
    receipt.base_ref !== proposal.remote.base_ref ||
    receipt.base_commit_sha !== proposal.remote.base_commit_sha
  ) {
    verificationFailure("reviewed remote base state changed");
  }

  if (
    state.clean !== true ||
    state.conflicts.length !== 0 ||
    operationState.active_operations.length !== 0
  ) {
    verificationFailure(
      "Update left a dirty, conflicted, or active-operation state",
    );
  }

  if (
    operation.action === "not-required" &&
    (receipt.resulting_head_sha !== receipt.previous_head_sha ||
      receipt.rebased)
  ) {
    verificationFailure(
      "a policy-exempt Update unexpectedly changed the branch",
    );
  }

  return {
    repository_root: state.root,
    branch: state.branch,
    previous_head_sha: receipt.previous_head_sha,
    resulting_head_sha: receipt.resulting_head_sha,
    base_commit_sha: receipt.base_commit_sha,
    rebased: receipt.rebased,
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
    throw new GitFinishUpdateProposalError(
      "APPLY_IN_PROGRESS",
      `Git Finish Update proposal is already being applied: ${errorMessage(error)}`,
    );
  }

  return lockPath;
}

async function releaseApplyLock(lockPath: string): Promise<void> {
  try {
    await unlink(lockPath);
  } catch {
    // Completed Apply must not fail only because lock cleanup failed.
  }
}

export async function persistGitFinishUpdateAppliedState(
  recordPath: string,
  expectedRecord: GitFinishUpdateProposalRecord,
  appliedAt: string,
  result: GitFinishUpdateAppliedResult,
): Promise<void> {
  const expected = `${JSON.stringify(expectedRecord, null, 2)}\n`;

  let current: string;

  try {
    current = await readFile(recordPath, "utf8");
  } catch (error) {
    throw new GitFinishUpdateProposalError(
      "PROPOSAL_STATE_FAILED",
      `Could not reread Finish Update proposal state: ${errorMessage(error)}`,
    );
  }

  if (current !== expected) {
    throw new GitFinishUpdateProposalError(
      "PROPOSAL_STATE_FAILED",
      "Finish Update proposal state changed during Apply",
    );
  }

  const appliedRecord: GitFinishUpdateProposalRecord = {
    ...expectedRecord,
    state: {
      status: "applied",
      applied_at: appliedAt,
      result,
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

    throw new GitFinishUpdateProposalError(
      "PROPOSAL_STATE_FAILED",
      `Could not persist applied Finish Update proposal state: ${errorMessage(error)}`,
    );
  }
}

export async function applyGitFinishUpdateProposal(
  input: PrepareGitFinishUpdateApplyInput,
  dependencies: {
    persist?: (
      recordPath: string,
      record: GitFinishUpdateProposalRecord,
      appliedAt: string,
      result: GitFinishUpdateAppliedResult,
    ) => Promise<void>;
  } = {},
): Promise<GitFinishUpdateApplySuccess | GitFinishUpdateApplyFailure> {
  const persist = dependencies.persist ?? persistGitFinishUpdateAppliedState;

  let lockPath: string | null = null;
  let receipt: GitFinishUpdateReceipt | null = null;
  let mutationCompleted = false;

  try {
    const preliminary = await prepareGitFinishUpdateApply(input);

    lockPath = await acquireApplyLock(preliminary.record_path);

    const prepared = await prepareGitFinishUpdateApply(input);
    const proposal = prepared.record.proposal;

    if (proposal.operation.action === "fetch-and-rebase") {
      receipt = await updateGitFinishBranch({
        repository_root: proposal.project.root,
        branch: proposal.operation.current_branch,
        expected_head_sha: proposal.operation.local_head_sha,
        fetch_url: proposal.remote.fetch_url,
        base_branch: proposal.operation.base_branch,
        base_ref: proposal.remote.base_ref,
        base_commit_sha: proposal.remote.base_commit_sha,
      });

      mutationCompleted = true;
    } else {
      receipt = {
        repository_root: proposal.project.root,
        branch: proposal.operation.current_branch,
        previous_head_sha: proposal.operation.local_head_sha,
        resulting_head_sha: proposal.operation.local_head_sha,
        base_branch: proposal.operation.base_branch,
        base_ref: proposal.remote.base_ref,
        base_commit_sha: proposal.remote.base_commit_sha,
        rebased: false,
      };
    }

    const [resultingState, operationState] = await Promise.all([
      inspectGitState(proposal.project.root),
      inspectGitCheckpointOperationState(proposal.project.root),
    ]);

    const verification = verifyGitFinishUpdateResult(
      prepared.record,
      receipt,
      resultingState,
      operationState,
    );

    const appliedAt = new Date().toISOString();

    await persist(prepared.record_path, prepared.record, appliedAt, {
      previous_head_sha: verification.previous_head_sha,
      resulting_head_sha: verification.resulting_head_sha,
      base_commit_sha: verification.base_commit_sha,
      rebased: verification.rebased,
    });

    return {
      version: 1,
      ok: true,
      proposal_id: proposal.id,
      applied_at: appliedAt,
      repository_root: verification.repository_root,
      branch: verification.branch,
      previous_head_sha: verification.previous_head_sha,
      resulting_head_sha: verification.resulting_head_sha,
      remote: proposal.operation.remote,
      base_branch: proposal.operation.base_branch,
      base_ref: proposal.remote.base_ref,
      base_commit_sha: verification.base_commit_sha,
      action: proposal.operation.action,
      rebased: verification.rebased,
      warnings: [
        "Finish Update does not push the resulting branch",
        "Finish Update does not create or change upstream tracking",
      ],
    };
  } catch (error) {
    const rollback = {
      attempted: false,
      succeeded: false,
      errors: [] as string[],
    };

    let resultingError = error;

    if (mutationCompleted && receipt !== null) {
      rollback.attempted = true;

      try {
        await rollbackGitFinishUpdate(receipt);
        rollback.succeeded = true;
      } catch (rollbackError) {
        rollback.errors.push(errorMessage(rollbackError));
        resultingError = new GitFinishUpdateProposalError(
          "ROLLBACK_FAILED",
          `${errorMessage(error)}; rollback failed: ${errorMessage(rollbackError)}`,
        );
      }
    }

    return {
      version: 1,
      ok: false,
      proposal_id: input.proposal_id,
      error: {
        code:
          resultingError instanceof GitFinishUpdateProposalError ||
          resultingError instanceof GitFinishUpdateMutationError
            ? resultingError.code
            : "APPLY_FAILED",
        message: errorMessage(resultingError),
      },
      rollback,
    };
  } finally {
    if (lockPath !== null) {
      await releaseApplyLock(lockPath);
    }
  }
}
