import type { GitStartPreflight } from "./git_start";
import { runGitStartPreflight } from "./git_start";
import {
  GitStartProposalError,
  loadGitStartProposal,
  policyResolutionChecksum,
} from "./git_start_proposal";
import { inspectGitState } from "./git_state";

export type GitStartApplyPreparation = {
  record: Awaited<ReturnType<typeof loadGitStartProposal>>["record"];
  record_path: string;
  preflight: Extract<GitStartPreflight, { ok: true }>;
};

export type PrepareGitStartApplyInput = {
  directory: string;
  configuration_root: string;
  proposal_id: string;
  storage_root?: string;
};

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
    directory: input.directory,
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
