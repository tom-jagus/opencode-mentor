import { randomUUID } from "node:crypto";
import type {
  GitFinishUpdateAction,
  GitFinishUpdatePreflight,
} from "./git_finish_update";
import type { EffectiveGitPolicyResolution, GitPolicy } from "./git_policy";
import {
  canonicalJson,
  gitProjectKey,
  policyResolutionChecksum,
  sha256,
} from "./git_lifecycle_proposal";

export type GitFinishUpdateProposalState =
  | {
      status: "pending";
      applied_at: null;
    }
  | {
      status: "applied";
      applied_at: string;
    };

export type GitFinishUpdateProposalPayload = {
  id: string;
  created_at: string;
  project: {
    key: string;
    root: string;
  };
  operation: {
    kind: "finish-update";
    base_branch: string;
    current_branch: string;
    local_head_sha: string;
    remote: string;
    action: GitFinishUpdateAction;
  };
  policy: {
    resolution_sha256: string;
    sources: EffectiveGitPolicyResolution["sources"];
    effective_policy: GitPolicy;
  };
  remote: {
    fetch_url: string;
    fetch_url_sha256: string;
    base_ref: string;
    base_commit_sha: string;
  };
};

export type GitFinishUpdateProposalRecord = {
  schema_version: 1;
  proposal: GitFinishUpdateProposalPayload;
  integrity: {
    proposal_sha256: string;
  };
  state: GitFinishUpdateProposalState;
};

export type GitFinishUpdateReview = {
  operation: "finish-update";
  repository_root: string;
  base_branch: string;
  current_branch: string;
  local_head_sha: string;
  remote: string;
  fetch_url_display: string;
  fetch_url_sha256: string;
  remote_base_ref: string;
  remote_base_commit_sha: string;
  action: GitFinishUpdateAction;
  policy_resolution_sha256: string;
  project_policy_present: boolean;
  warnings: string[];
};

export class GitFinishUpdateProposalError extends Error {
  readonly code:
    | "UPDATE_PREFLIGHT_FAILED"
    | "UPDATE_NOT_ELIGIBLE"
    | "INVALID_UPDATE_PREFLIGHT"
    | "INVALID_PROPOSAL"
    | "INVALID_PROPOSAL_ID"
    | "PROPOSAL_STORAGE_FAILED"
    | "PROPOSAL_NOT_FOUND"
    | "UNSUPPORTED_PROPOSAL_VERSION"
    | "PROPOSAL_INTEGRITY_FAILED"
    | "PROJECT_MISMATCH"
    | "PROPOSAL_ALREADY_APPLIED"
    | "STALE_PROPOSAL"
    | "APPLY_IN_PROGRESS"
    | "APPLY_FAILED"
    | "PROPOSAL_STATE_FAILED"
    | "ROLLBACK_FAILED";

  constructor(code: GitFinishUpdateProposalError["code"], message: string) {
    super(message);
    this.name = "GitFinishUpdateProposalError";
    this.code = code;
  }
}

function fetchUrlDisplay(fetchUrl: string): string {
  try {
    const parsed = new URL(fetchUrl);

    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      if (parsed.username.length > 0 || parsed.password.length > 0) {
        parsed.username = "***";
        parsed.password = "";
      }

      parsed.search = "";
      parsed.hash = "";

      return parsed.toString();
    }

    return fetchUrl;
  } catch {
    // Local paths and SCP-like SSH URLs are displayed exactly.
    return fetchUrl;
  }
}

export function gitFinishUpdateProposalIntegrity(
  proposal: GitFinishUpdateProposalPayload,
): string {
  return sha256(
    canonicalJson({
      schema_version: 1,
      proposal,
    }),
  );
}

export function buildGitFinishUpdateProposal(
  preflight: GitFinishUpdatePreflight,
  options: {
    id?: string;
    created_at?: string;
  } = {},
): GitFinishUpdateProposalRecord {
  if (!preflight.ok) {
    throw new GitFinishUpdateProposalError(
      "UPDATE_PREFLIGHT_FAILED",
      preflight.error.message,
    );
  }

  if (!preflight.eligibility.eligible) {
    throw new GitFinishUpdateProposalError(
      "UPDATE_NOT_ELIGIBLE",
      "Git Finish Update preflight is not eligible for Preview",
    );
  }

  if (preflight.remote_inspection === null || preflight.update_plan === null) {
    throw new GitFinishUpdateProposalError(
      "INVALID_UPDATE_PREFLIGHT",
      "Eligible Finish Update preflight is missing remote or plan state",
    );
  }

  const {
    state,
    policy_resolution: policyResolution,
    operation_state: operationState,
    eligibility,
    remote_inspection: remoteInspection,
    update_plan: updatePlan,
  } = preflight;

  const expectedAction: GitFinishUpdateAction = policyResolution
    .effective_policy.branch_update.require_before_finalization
    ? "fetch-and-rebase"
    : "not-required";

  if (
    state.branch === null ||
    state.latest_commit === null ||
    state.clean !== true ||
    state.conflicts.length !== 0 ||
    operationState.active_operations.length !== 0 ||
    eligibility.issues.length !== 0 ||
    eligibility.repository_root !== state.root ||
    eligibility.base_branch !== policyResolution.effective_policy.base_branch ||
    eligibility.current_branch !== state.branch ||
    eligibility.head_sha !== state.latest_commit.sha ||
    eligibility.remote !== updatePlan.remote ||
    policyResolution.project_root !== state.root ||
    updatePlan.repository_root !== state.root ||
    updatePlan.base_branch !== policyResolution.effective_policy.base_branch ||
    updatePlan.current_branch !== state.branch ||
    updatePlan.local_head_sha !== state.latest_commit.sha ||
    updatePlan.remote !== remoteInspection.remote ||
    updatePlan.selected_fetch_url !== remoteInspection.selected_fetch_url ||
    updatePlan.remote_base_ref !== remoteInspection.base_ref ||
    updatePlan.remote_base_commit_sha !== remoteInspection.base_commit_sha ||
    updatePlan.action !== expectedAction ||
    remoteInspection.repository_root !== state.root ||
    remoteInspection.base_branch !== updatePlan.base_branch ||
    remoteInspection.fetch_urls.length !== 1 ||
    remoteInspection.fetch_urls[0] !== remoteInspection.selected_fetch_url
  ) {
    throw new GitFinishUpdateProposalError(
      "INVALID_UPDATE_PREFLIGHT",
      "Eligible Finish Update preflight contains inconsistent immutable state",
    );
  }

  const proposal: GitFinishUpdateProposalPayload = structuredClone({
    id: options.id ?? `git-finish-update-${randomUUID()}`,
    created_at: options.created_at ?? new Date().toISOString(),
    project: {
      key: gitProjectKey(state.root),
      root: state.root,
    },
    operation: {
      kind: "finish-update",
      base_branch: updatePlan.base_branch,
      current_branch: updatePlan.current_branch,
      local_head_sha: updatePlan.local_head_sha,
      remote: updatePlan.remote,
      action: updatePlan.action,
    },
    policy: {
      resolution_sha256: policyResolutionChecksum(policyResolution),
      sources: policyResolution.sources,
      effective_policy: policyResolution.effective_policy,
    },
    remote: {
      fetch_url: remoteInspection.selected_fetch_url,
      fetch_url_sha256: sha256(remoteInspection.selected_fetch_url),
      base_ref: remoteInspection.base_ref,
      base_commit_sha: remoteInspection.base_commit_sha,
    },
  });

  return {
    schema_version: 1,
    proposal,
    integrity: {
      proposal_sha256: gitFinishUpdateProposalIntegrity(proposal),
    },
    state: {
      status: "pending",
      applied_at: null,
    },
  };
}

export function buildGitFinishUpdateReview(
  record: GitFinishUpdateProposalRecord,
): GitFinishUpdateReview {
  if (
    record.integrity.proposal_sha256 !==
      gitFinishUpdateProposalIntegrity(record.proposal) ||
    record.proposal.remote.fetch_url_sha256 !==
      sha256(record.proposal.remote.fetch_url)
  ) {
    throw new GitFinishUpdateProposalError(
      "INVALID_PROPOSAL",
      "Finish Update proposal integrity validation failed",
    );
  }

  const proposal = record.proposal;
  const warnings = [
    "Update Preview contacts the explicit remote but performs no fetch or rebase",
  ];

  if (proposal.operation.action === "fetch-and-rebase") {
    warnings.push(
      "Update Apply may replace the current branch tip after rebasing onto the reviewed remote base commit",
    );
  } else {
    warnings.push(
      "Effective policy does not require a rebase before finalisation",
    );
  }

  return {
    operation: proposal.operation.kind,
    repository_root: proposal.project.root,
    base_branch: proposal.operation.base_branch,
    current_branch: proposal.operation.current_branch,
    local_head_sha: proposal.operation.local_head_sha,
    remote: proposal.operation.remote,
    fetch_url_display: fetchUrlDisplay(proposal.remote.fetch_url),
    fetch_url_sha256: proposal.remote.fetch_url_sha256,
    remote_base_ref: proposal.remote.base_ref,
    remote_base_commit_sha: proposal.remote.base_commit_sha,
    action: proposal.operation.action,
    policy_resolution_sha256: proposal.policy.resolution_sha256,
    project_policy_present: proposal.policy.sources.project.present,
    warnings,
  };
}
