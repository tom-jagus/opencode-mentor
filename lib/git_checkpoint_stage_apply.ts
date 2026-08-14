import type { GitCheckpointStagePreflight } from "./git_checkpoint";
import type { GitCheckpointStageProposalRecord } from "./git_checkpoint_stage_proposal";
import { GitCheckpointStageProposalError } from "./git_checkpoint_stage_proposal";
import {
  canonicalJson,
  policyResolutionChecksum,
} from "./git_lifecycle_proposal";
import { runGitCheckpointStagePreflight } from "./git_checkpoint";
import { loadGitCheckpointStageProposal } from "./git_checkpoint_stage_proposal";
import { inspectGitState } from "./git_state";
import type { GitState } from "./git_state";
import type { GitCheckpointStageSnapshot } from "./git_checkpoint_stage_snapshot";

export type GitCheckpointStageFreshnessValidation = {
  record: GitCheckpointStageProposalRecord;
  preflight: Extract<GitCheckpointStagePreflight, { ok: true }>;
};
import { randomUUID } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { inspectGitCheckpointStageSnapshot } from "./git_checkpoint_stage_snapshot";
import {
  discardGitCheckpointStageBackup,
  GitCheckpointStageMutationError,
  rollbackGitCheckpointStage,
  stageGitCheckpointPaths,
} from "./git_checkpoint_stage_mutation";
import type { GitCheckpointIndexBackup } from "./git_checkpoint_stage_mutation";

function stale(message: string): never {
  throw new GitCheckpointStageProposalError(
    "STALE_PROPOSAL",
    `Git checkpoint Stage proposal is stale: ${message}`,
  );
}

function sameValue(first: unknown, second: unknown): boolean {
  return canonicalJson(first) === canonicalJson(second);
}

export function validateGitCheckpointStageApplyFreshness(
  record: GitCheckpointStageProposalRecord,
  preflight: GitCheckpointStagePreflight,
): GitCheckpointStageFreshnessValidation {
  if (!preflight.ok) {
    stale(preflight.error.message);
  }

  if (!preflight.stage_plan.eligible) {
    stale(
      preflight.stage_plan.issues
        .map((issue) => `${issue.code}: ${issue.message}`)
        .join("; "),
    );
  }

  if (preflight.snapshot === null) {
    stale("selected-content snapshot is unavailable");
  }

  const proposal = record.proposal;
  const operation = proposal.operation;
  const stagePlan = preflight.stage_plan;
  const snapshot = preflight.snapshot;

  if (preflight.state.root !== proposal.project.root) {
    stale("repository root changed");
  }

  if (preflight.state.branch !== operation.current_branch) {
    stale("current branch changed");
  }

  if (preflight.state.latest_commit?.sha !== operation.head_sha) {
    stale("HEAD changed");
  }

  if (stagePlan.base_branch !== operation.base_branch) {
    stale("effective base branch changed");
  }

  if (
    policyResolutionChecksum(preflight.policy_resolution) !==
    proposal.policy.resolution_sha256
  ) {
    stale("effective policy changed");
  }

  if (!sameValue(preflight.state.changes, proposal.repository.changes)) {
    stale("inspected repository changes changed");
  }

  if (
    !sameValue(
      stagePlan.selected_changes.map((change) => change.path),
      operation.selected_paths,
    )
  ) {
    stale("selected paths changed");
  }

  if (!sameValue(stagePlan.staging_pathspecs, operation.staging_pathspecs)) {
    stale("staging pathspecs changed");
  }

  if (
    snapshot.repository_root !== proposal.repository.snapshot.repository_root ||
    snapshot.snapshot_sha256 !== proposal.repository.snapshot.snapshot_sha256 ||
    !sameValue(snapshot.paths, proposal.repository.snapshot.paths)
  ) {
    stale("selected path content changed");
  }

  return {
    record,
    preflight,
  };
}

export type PrepareGitCheckpointStageApplyInput = {
  directory: string;
  configuration_root: string;
  proposal_id: string;
  storage_root?: string;
};

export type GitCheckpointStageApplyPreparation = {
  record: GitCheckpointStageProposalRecord;
  record_path: string;
  preflight: Extract<GitCheckpointStagePreflight, { ok: true }>;
};

export async function prepareGitCheckpointStageApply(
  input: PrepareGitCheckpointStageApplyInput,
): Promise<GitCheckpointStageApplyPreparation> {
  const initialState = await inspectGitState(input.directory);

  if (!initialState.available) {
    stale(`Git inspection failed: ${initialState.error}`);
  }

  if (!initialState.repository) {
    stale("the current workspace is not inside a Git repository");
  }

  const loaded = await loadGitCheckpointStageProposal(
    initialState.root,
    input.proposal_id,
    input.storage_root,
  );

  const preflight = await runGitCheckpointStagePreflight({
    directory: initialState.root,
    configuration_root: input.configuration_root,
    selected_paths: loaded.record.proposal.operation.selected_paths,
  });

  const validated = validateGitCheckpointStageApplyFreshness(
    loaded.record,
    preflight,
  );

  return {
    record: validated.record,
    record_path: loaded.record_path,
    preflight: validated.preflight,
  };
}

export type GitCheckpointStageVerification = {
  repository_root: string;
  branch: string;
  head_sha: string;
  staged_paths: string[];
  snapshot_sha256: string;
};

function isStagedChange(indexStatus: string): boolean {
  return indexStatus !== " " && indexStatus !== "?" && indexStatus !== "!";
}

function verificationFailure(message: string): never {
  throw new GitCheckpointStageProposalError(
    "APPLY_FAILED",
    `Git checkpoint Stage verification failed: ${message}`,
  );
}

export function verifyGitCheckpointStageResult(
  record: GitCheckpointStageProposalRecord,
  state: GitState,
  snapshot: GitCheckpointStageSnapshot,
): GitCheckpointStageVerification {
  if (!state.available) {
    verificationFailure(`Git inspection failed: ${state.error}`);
  }

  if (!state.repository) {
    verificationFailure("the workspace is no longer inside a Git repository");
  }

  const proposal = record.proposal;
  const operation = proposal.operation;

  if (state.root !== proposal.project.root) {
    verificationFailure("repository root changed");
  }

  if (state.branch !== operation.current_branch) {
    verificationFailure("current branch changed");
  }

  if (state.latest_commit?.sha !== operation.head_sha) {
    verificationFailure("HEAD changed");
  }

  if (state.conflicts.length > 0) {
    verificationFailure("unresolved conflicts appeared");
  }

  const selectedPathSet = new Set(operation.selected_paths);

  const selectedChanges = state.changes.filter((change) =>
    selectedPathSet.has(change.path),
  );

  if (selectedChanges.length !== selectedPathSet.size) {
    verificationFailure(
      "one or more selected paths are missing from repository status",
    );
  }

  const unstagedSelections = selectedChanges.filter(
    (change) => !isStagedChange(change.index_status),
  );

  if (unstagedSelections.length > 0) {
    verificationFailure(
      `selected paths were not staged: ${unstagedSelections
        .map((change) => change.path)
        .join(", ")}`,
    );
  }

  const unexpectedStaged = state.changes.filter(
    (change) =>
      isStagedChange(change.index_status) && !selectedPathSet.has(change.path),
  );

  if (unexpectedStaged.length > 0) {
    verificationFailure(
      `unselected paths became staged: ${unexpectedStaged
        .map((change) => change.path)
        .join(", ")}`,
    );
  }

  if (
    snapshot.repository_root !== proposal.repository.snapshot.repository_root ||
    snapshot.snapshot_sha256 !== proposal.repository.snapshot.snapshot_sha256 ||
    !sameValue(snapshot.paths, proposal.repository.snapshot.paths)
  ) {
    verificationFailure("selected path content changed during staging");
  }

  return {
    repository_root: state.root,
    branch: state.branch,
    head_sha: state.latest_commit!.sha,
    staged_paths: selectedChanges.map((change) => change.path),
    snapshot_sha256: snapshot.snapshot_sha256,
  };
}
export type GitCheckpointStageApplySuccess = {
  version: 1;
  ok: true;
  proposal_id: string;
  applied_at: string;
  repository_root: string;
  branch: string;
  head_sha: string;
  staged_paths: string[];
  snapshot_sha256: string;
  warnings: string[];
};

export type GitCheckpointStageApplyFailure = {
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

async function acquireApplyLock(recordPath: string): Promise<string> {
  const lockPath = `${recordPath}.apply.lock`;

  try {
    await writeFile(lockPath, `${process.pid}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
  } catch (error) {
    throw new GitCheckpointStageProposalError(
      "APPLY_IN_PROGRESS",
      `Git checkpoint Stage proposal is already being applied: ${errorMessage(error)}`,
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

export async function persistGitCheckpointStageAppliedState(
  recordPath: string,
  expectedRecord: GitCheckpointStageProposalRecord,
  appliedAt: string,
): Promise<void> {
  const expected = `${JSON.stringify(expectedRecord, null, 2)}\n`;

  let current: string;

  try {
    current = await readFile(recordPath, "utf8");
  } catch (error) {
    throw new GitCheckpointStageProposalError(
      "PROPOSAL_STATE_FAILED",
      `Could not reread Stage proposal state: ${errorMessage(error)}`,
    );
  }

  if (current !== expected) {
    throw new GitCheckpointStageProposalError(
      "PROPOSAL_STATE_FAILED",
      "Stage proposal state changed during Apply",
    );
  }

  const appliedRecord: GitCheckpointStageProposalRecord = {
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

    throw new GitCheckpointStageProposalError(
      "PROPOSAL_STATE_FAILED",
      `Could not persist applied Stage proposal state: ${errorMessage(error)}`,
    );
  }
}

export async function applyGitCheckpointStageProposal(
  input: PrepareGitCheckpointStageApplyInput,
  dependencies: {
    persist?: (
      recordPath: string,
      record: GitCheckpointStageProposalRecord,
      appliedAt: string,
    ) => Promise<void>;
  } = {},
): Promise<GitCheckpointStageApplySuccess | GitCheckpointStageApplyFailure> {
  const persist = dependencies.persist ?? persistGitCheckpointStageAppliedState;

  let lockPath: string | null = null;
  let backup: GitCheckpointIndexBackup | null = null;

  try {
    const preliminary = await prepareGitCheckpointStageApply(input);

    lockPath = await acquireApplyLock(preliminary.record_path);

    const prepared = await prepareGitCheckpointStageApply(input);

    const proposal = prepared.record.proposal;

    backup = await stageGitCheckpointPaths(
      proposal.project.root,
      proposal.operation.staging_pathspecs,
    );

    const resultingState = await inspectGitState(proposal.project.root);

    const resultingSnapshot = await inspectGitCheckpointStageSnapshot(
      proposal.project.root,
      proposal.operation.staging_pathspecs,
    );

    const verified = verifyGitCheckpointStageResult(
      prepared.record,
      resultingState,
      resultingSnapshot,
    );

    const appliedAt = new Date().toISOString();

    await persist(prepared.record_path, prepared.record, appliedAt);

    const warnings: string[] = [];

    try {
      await discardGitCheckpointStageBackup(backup);
    } catch (error) {
      warnings.push(errorMessage(error));
    }

    backup = null;

    return {
      version: 1,
      ok: true,
      proposal_id: proposal.id,
      applied_at: appliedAt,
      repository_root: verified.repository_root,
      branch: verified.branch,
      head_sha: verified.head_sha,
      staged_paths: verified.staged_paths,
      snapshot_sha256: verified.snapshot_sha256,
      warnings,
    };
  } catch (error) {
    if (backup !== null) {
      try {
        await rollbackGitCheckpointStage(backup);

        return {
          version: 1,
          ok: false,
          proposal_id: input.proposal_id,
          error: {
            code:
              error instanceof GitCheckpointStageProposalError
                ? error.code
                : error instanceof GitCheckpointStageMutationError
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
              "Git checkpoint Stage Apply failed and index rollback could not restore the repository",
          },
          rollback: {
            succeeded: false,
            errors: [errorMessage(rollbackError)],
          },
        };
      }
    }

    if (
      error instanceof GitCheckpointStageMutationError &&
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

    if (
      error instanceof GitCheckpointStageMutationError &&
      error.code === "STAGING_FAILED"
    ) {
      return {
        version: 1,
        ok: false,
        proposal_id: input.proposal_id,
        error: {
          code: "STAGING_FAILED",
          message: error.message,
        },
        rollback: {
          succeeded: true,
          errors: [],
        },
      };
    }

    return {
      version: 1,
      ok: false,
      proposal_id: input.proposal_id,
      error: {
        code:
          error instanceof GitCheckpointStageProposalError
            ? error.code
            : error instanceof GitCheckpointStageMutationError
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
