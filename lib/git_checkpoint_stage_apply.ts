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

export type GitCheckpointStageFreshnessValidation = {
  record: GitCheckpointStageProposalRecord;
  preflight: Extract<GitCheckpointStagePreflight, { ok: true }>;
};

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
