import type { GitCheckpointPushPreflight } from "./git_checkpoint_push";
import { runGitCheckpointPushPreflight } from "./git_checkpoint_push";
import type { GitCheckpointPushProposalRecord } from "./git_checkpoint_push_proposal";
import {
  GitCheckpointPushProposalError,
  loadGitCheckpointPushProposal,
} from "./git_checkpoint_push_proposal";
import { inspectGitState } from "./git_state";
import { policyResolutionChecksum, sha256 } from "./git_lifecycle_proposal";
import { randomUUID } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { inspectGitCheckpointPushUrlDestination } from "./git_checkpoint_push_remote";
import type { GitCheckpointPushReceipt } from "./git_checkpoint_push_mutation";
import {
  GitCheckpointPushMutationError,
  pushGitCheckpoint,
} from "./git_checkpoint_push_mutation";
import type { GitState } from "./git_state";

export type GitCheckpointPushFreshnessValidation = {
  record: GitCheckpointPushProposalRecord;
  preflight: Extract<GitCheckpointPushPreflight, { ok: true }>;
};

export type PrepareGitCheckpointPushApplyInput = {
  directory: string;
  configuration_root: string;
  proposal_id: string;
  storage_root?: string;
};

export type GitCheckpointPushApplyPreparation = {
  record: GitCheckpointPushProposalRecord;
  record_path: string;
  preflight: Extract<GitCheckpointPushPreflight, { ok: true }>;
};

function stale(message: string): never {
  throw new GitCheckpointPushProposalError(
    "STALE_PROPOSAL",
    `Git checkpoint Push proposal is stale: ${message}`,
  );
}

export function validateGitCheckpointPushApplyFreshness(
  record: GitCheckpointPushProposalRecord,
  preflight: GitCheckpointPushPreflight,
): GitCheckpointPushFreshnessValidation {
  if (!preflight.ok) {
    stale(preflight.error.message);
  }

  if (!preflight.push_plan.eligible) {
    stale(
      preflight.push_plan.issues
        .map((issue) => `${issue.code}: ${issue.message}`)
        .join("; "),
    );
  }

  if (preflight.remote_inspection === null) {
    stale("remote inspection is unavailable");
  }

  const proposal = record.proposal;
  const operation = proposal.operation;
  const pushPlan = preflight.push_plan;
  const remoteInspection = preflight.remote_inspection;

  if (preflight.state.root !== proposal.project.root) {
    stale("repository root changed");
  }

  if (preflight.state.branch !== operation.current_branch) {
    stale("current branch changed");
  }

  if (
    preflight.state.latest_commit?.sha !== operation.local_commit_sha ||
    pushPlan.local_commit_sha !== operation.local_commit_sha
  ) {
    stale("local commit changed");
  }

  if (pushPlan.base_branch !== operation.base_branch) {
    stale("effective base branch changed");
  }

  if (
    policyResolutionChecksum(preflight.policy_resolution) !==
    proposal.policy.resolution_sha256
  ) {
    stale("effective policy changed");
  }

  if (
    pushPlan.remote !== operation.remote ||
    remoteInspection.remote !== operation.remote
  ) {
    stale("explicit remote changed");
  }

  if (
    pushPlan.destination_branch !== operation.destination_branch ||
    pushPlan.destination_ref !== operation.destination_ref ||
    remoteInspection.destination_branch !== operation.destination_branch ||
    remoteInspection.destination_ref !== operation.destination_ref
  ) {
    stale("remote destination changed");
  }

  if (
    remoteInspection.selected_push_url !== proposal.remote.push_url ||
    sha256(remoteInspection.selected_push_url) !==
      proposal.remote.push_url_sha256
  ) {
    stale("effective remote push URL changed");
  }

  if (
    pushPlan.remote_commit_sha !== proposal.remote.expected_commit_sha ||
    remoteInspection.destination.commit_sha !==
      proposal.remote.expected_commit_sha
  ) {
    stale("remote destination commit changed");
  }

  if (pushPlan.disposition !== operation.disposition) {
    stale("Push disposition changed");
  }

  return {
    record,
    preflight,
  };
}

export async function prepareGitCheckpointPushApply(
  input: PrepareGitCheckpointPushApplyInput,
): Promise<GitCheckpointPushApplyPreparation> {
  const initialState = await inspectGitState(input.directory);

  if (!initialState.available) {
    stale(`Git inspection failed: ${initialState.error}`);
  }

  if (!initialState.repository) {
    stale("the current workspace is not inside a Git repository");
  }

  const loaded = await loadGitCheckpointPushProposal(
    initialState.root,
    input.proposal_id,
    input.storage_root,
  );

  const proposal = loaded.record.proposal;

  const preflight = await runGitCheckpointPushPreflight({
    directory: initialState.root,
    configuration_root: input.configuration_root,
    local_commit_sha: proposal.operation.local_commit_sha,
    remote: proposal.operation.remote,
    destination_branch: proposal.operation.destination_branch,
  });

  const validated = validateGitCheckpointPushApplyFreshness(
    loaded.record,
    preflight,
  );

  return {
    record: validated.record,
    record_path: loaded.record_path,
    preflight: validated.preflight,
  };
}

export type GitCheckpointPushVerification = {
  repository_root: string;
  branch: string;
  local_commit_sha: string;
  destination_ref: string;
  remote_commit_sha: string;
  push_url_sha256: string;
};

export type GitCheckpointPushApplySuccess = {
  version: 1;
  ok: true;
  proposal_id: string;
  applied_at: string;
  repository_root: string;
  branch: string;
  local_commit_sha: string;
  remote: string;
  destination_branch: string;
  destination_ref: string;
  remote_commit_sha: string;
  disposition: "create" | "up-to-date" | "fast-forward";
  remote_updated: boolean;
  warnings: string[];
};

export type GitCheckpointPushApplyFailure = {
  version: 1;
  ok: false;
  proposal_id: string;
  error: {
    code: string;
    message: string;
  };
  remote_result: {
    mutation_completed: true | false | "uncertain";
    state_verified: boolean;
    rollback_available: false;
  };
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function verificationFailure(message: string): never {
  throw new GitCheckpointPushProposalError(
    "APPLY_FAILED",
    `Git checkpoint Push verification failed: ${message}`,
  );
}

export function verifyGitCheckpointPushResult(
  record: GitCheckpointPushProposalRecord,
  receipt: GitCheckpointPushReceipt,
  state: GitState,
  remoteInspection: Awaited<
    ReturnType<typeof inspectGitCheckpointPushUrlDestination>
  >,
): GitCheckpointPushVerification {
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
    remoteInspection.repository_root !== proposal.project.root
  ) {
    verificationFailure("repository root changed");
  }

  if (state.branch !== operation.current_branch) {
    verificationFailure("current branch changed");
  }

  if (
    state.latest_commit?.sha !== operation.local_commit_sha ||
    receipt.local_commit_sha !== operation.local_commit_sha
  ) {
    verificationFailure("local commit changed");
  }

  if (
    receipt.destination_ref !== operation.destination_ref ||
    remoteInspection.destination_ref !== operation.destination_ref
  ) {
    verificationFailure("remote destination changed");
  }

  if (
    receipt.push_url_sha256 !== proposal.remote.push_url_sha256 ||
    remoteInspection.push_url !== proposal.remote.push_url
  ) {
    verificationFailure("remote push URL changed");
  }

  if (
    !remoteInspection.destination.exists ||
    remoteInspection.destination.commit_sha !== operation.local_commit_sha
  ) {
    verificationFailure(
      "remote destination does not identify the reviewed local commit",
    );
  }

  return {
    repository_root: state.root,
    branch: state.branch,
    local_commit_sha: operation.local_commit_sha,
    destination_ref: operation.destination_ref,
    remote_commit_sha: remoteInspection.destination.commit_sha,
    push_url_sha256: receipt.push_url_sha256,
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
    throw new GitCheckpointPushProposalError(
      "APPLY_IN_PROGRESS",
      `Git checkpoint Push proposal is already being applied: ${errorMessage(error)}`,
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

export async function persistGitCheckpointPushAppliedState(
  recordPath: string,
  expectedRecord: GitCheckpointPushProposalRecord,
  appliedAt: string,
): Promise<void> {
  const expected = `${JSON.stringify(expectedRecord, null, 2)}\n`;

  let current: string;

  try {
    current = await readFile(recordPath, "utf8");
  } catch (error) {
    throw new GitCheckpointPushProposalError(
      "PROPOSAL_STATE_FAILED",
      `Could not reread Push proposal state: ${errorMessage(error)}`,
    );
  }

  if (current !== expected) {
    throw new GitCheckpointPushProposalError(
      "PROPOSAL_STATE_FAILED",
      "Push proposal state changed during Apply",
    );
  }

  const appliedRecord: GitCheckpointPushProposalRecord = {
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

    throw new GitCheckpointPushProposalError(
      "PROPOSAL_STATE_FAILED",
      `Could not persist applied Push proposal state: ${errorMessage(error)}`,
    );
  }
}

export async function applyGitCheckpointPushProposal(
  input: PrepareGitCheckpointPushApplyInput,
  dependencies: {
    persist?: (
      recordPath: string,
      record: GitCheckpointPushProposalRecord,
      appliedAt: string,
    ) => Promise<void>;
  } = {},
): Promise<GitCheckpointPushApplySuccess | GitCheckpointPushApplyFailure> {
  const persist = dependencies.persist ?? persistGitCheckpointPushAppliedState;

  let lockPath: string | null = null;
  let mutationCompleted = false;
  let stateVerified = false;

  try {
    const preliminary = await prepareGitCheckpointPushApply(input);

    lockPath = await acquireApplyLock(preliminary.record_path);

    const prepared = await prepareGitCheckpointPushApply(input);

    const proposal = prepared.record.proposal;

    const receipt = await pushGitCheckpoint(
      proposal.project.root,
      proposal.remote.push_url,
      proposal.operation.local_commit_sha,
      proposal.operation.destination_ref,
    );

    mutationCompleted = true;

    const [resultingState, remoteInspection] = await Promise.all([
      inspectGitState(proposal.project.root),
      inspectGitCheckpointPushUrlDestination({
        repository_root: proposal.project.root,
        push_url: proposal.remote.push_url,
        destination_ref: proposal.operation.destination_ref,
      }),
    ]);

    const verified = verifyGitCheckpointPushResult(
      prepared.record,
      receipt,
      resultingState,
      remoteInspection,
    );

    stateVerified = true;

    const appliedAt = new Date().toISOString();

    await persist(prepared.record_path, prepared.record, appliedAt);

    return {
      version: 1,
      ok: true,
      proposal_id: proposal.id,
      applied_at: appliedAt,
      repository_root: verified.repository_root,
      branch: verified.branch,
      local_commit_sha: verified.local_commit_sha,
      remote: proposal.operation.remote,
      destination_branch: proposal.operation.destination_branch,
      destination_ref: verified.destination_ref,
      remote_commit_sha: verified.remote_commit_sha,
      disposition: proposal.operation.disposition,
      remote_updated: proposal.operation.disposition !== "up-to-date",
      warnings: [],
    };
  } catch (error) {
    const mutationResult: true | false | "uncertain" = mutationCompleted
      ? true
      : error instanceof GitCheckpointPushMutationError &&
          error.code === "PUSH_STATE_FAILED"
        ? "uncertain"
        : false;

    return {
      version: 1,
      ok: false,
      proposal_id: input.proposal_id,
      error: {
        code:
          error instanceof GitCheckpointPushProposalError
            ? error.code
            : error instanceof GitCheckpointPushMutationError
              ? error.code
              : "APPLY_FAILED",
        message: errorMessage(error),
      },
      remote_result: {
        mutation_completed: mutationResult,
        state_verified: stateVerified,
        rollback_available: false,
      },
    };
  } finally {
    if (lockPath !== null) {
      await releaseApplyLock(lockPath);
    }
  }
}
