import { randomUUID } from "node:crypto";
import type {
  GitFinishPublishDisposition,
  GitFinishPublishPreflight,
} from "./git_finish_publish";
import type { EffectiveGitPolicyResolution, GitPolicy } from "./git_policy";
import {
  canonicalJson,
  gitProjectKey,
  policyResolutionChecksum,
  sha256,
} from "./git_lifecycle_proposal";
import { gitFinishUpdateProposalIntegrity } from "./git_finish_update_proposal";

export type GitFinishPublishAppliedResult = {
  published_commit_sha: string;
  remote_commit_sha: string;
  remote_updated: boolean;
};

export type GitFinishPublishProposalState =
  | {
      status: "pending";
      applied_at: null;
      result: null;
    }
  | {
      status: "applied";
      applied_at: string;
      result: GitFinishPublishAppliedResult;
    };

export type GitFinishPublishProposalPayload = {
  id: string;
  created_at: string;
  project: {
    key: string;
    root: string;
  };
  operation: {
    kind: "finish-publish";
    base_branch: string;
    current_branch: string;
    local_head_sha: string;
    remote: string;
    destination_branch: string;
    destination_ref: string;
    disposition: "create" | "up-to-date" | "fast-forward" | "force-with-lease";
    force_with_lease_expected_sha: string | null;
  };
  policy: {
    resolution_sha256: string;
    sources: EffectiveGitPolicyResolution["sources"];
    effective_policy: GitPolicy;
  };
  remote: {
    push_url: string;
    push_url_sha256: string;
    expected_commit_sha: string | null;
  };
  update: {
    proposal_id: string;
    proposal_sha256: string;
    applied_at: string;
    previous_head_sha: string;
    resulting_head_sha: string;
    base_commit_sha: string;
    rebased: boolean;
  };
};

export type GitFinishPublishProposalRecord = {
  schema_version: 1;
  proposal: GitFinishPublishProposalPayload;
  integrity: {
    proposal_sha256: string;
  };
  state: GitFinishPublishProposalState;
};

export type GitFinishPublishReview = {
  operation: "finish-publish";
  repository_root: string;
  base_branch: string;
  current_branch: string;
  local_head_sha: string;
  remote: string;
  push_url_display: string;
  push_url_sha256: string;
  destination_branch: string;
  destination_ref: string;
  expected_remote_commit_sha: string | null;
  disposition: "create" | "up-to-date" | "fast-forward" | "force-with-lease";
  force_with_lease_expected_sha: string | null;
  update_proposal_id: string;
  update_proposal_sha256: string;
  policy_resolution_sha256: string;
  project_policy_present: boolean;
  warnings: string[];
};

export class GitFinishPublishProposalError extends Error {
  readonly code:
    | "PUBLISH_PREFLIGHT_FAILED"
    | "PUBLISH_NOT_ELIGIBLE"
    | "INVALID_PUBLISH_PREFLIGHT"
    | "INVALID_PROPOSAL"
    | "INVALID_PROPOSAL_ID"
    | "UNSUPPORTED_PROPOSAL_VERSION"
    | "PROPOSAL_STORAGE_FAILED"
    | "PROJECT_MISMATCH"
    | "PROPOSAL_NOT_FOUND"
    | "PROPOSAL_INTEGRITY_FAILED"
    | "PROPOSAL_ALREADY_APPLIED"
    | "PROPOSAL_NOT_APPLIED";

  constructor(code: GitFinishPublishProposalError["code"], message: string) {
    super(message);
    this.name = "GitFinishPublishProposalError";
    this.code = code;
  }
}

function isEligibleDisposition(
  disposition: GitFinishPublishDisposition,
): disposition is
  "create" | "up-to-date" | "fast-forward" | "force-with-lease" {
  return (
    disposition === "create" ||
    disposition === "up-to-date" ||
    disposition === "fast-forward" ||
    disposition === "force-with-lease"
  );
}

function pushUrlDisplay(pushUrl: string): string {
  try {
    const parsed = new URL(pushUrl);

    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      if (parsed.username.length > 0 || parsed.password.length > 0) {
        parsed.username = "***";
        parsed.password = "";
      }

      parsed.search = "";
      parsed.hash = "";

      return parsed.toString();
    }

    return pushUrl;
  } catch {
    return pushUrl;
  }
}

export function gitFinishPublishProposalIntegrity(
  proposal: GitFinishPublishProposalPayload,
): string {
  return sha256(
    canonicalJson({
      schema_version: 1,
      proposal,
    }),
  );
}

export function buildGitFinishPublishProposal(
  preflight: GitFinishPublishPreflight,
  options: {
    id?: string;
    created_at?: string;
  } = {},
): GitFinishPublishProposalRecord {
  if (!preflight.ok) {
    throw new GitFinishPublishProposalError(
      "PUBLISH_PREFLIGHT_FAILED",
      preflight.error.message,
    );
  }

  if (
    !preflight.eligibility.eligible ||
    preflight.publish_plan === null ||
    !preflight.publish_plan.eligible
  ) {
    throw new GitFinishPublishProposalError(
      "PUBLISH_NOT_ELIGIBLE",
      "Git Finish Publish preflight is not eligible for Preview",
    );
  }

  if (
    preflight.remote_inspection === null ||
    preflight.update_record.state.status !== "applied"
  ) {
    throw new GitFinishPublishProposalError(
      "INVALID_PUBLISH_PREFLIGHT",
      "Eligible Finish Publish preflight is missing remote or Update provenance",
    );
  }

  const {
    state,
    policy_resolution: policyResolution,
    operation_state: operationState,
    update_record: updateRecord,
    eligibility,
    remote_inspection: remoteInspection,
    publish_plan: publishPlan,
  } = preflight;

  const updateResult = updateRecord.state.result;

  if (
    state.branch === null ||
    state.latest_commit === null ||
    state.clean !== true ||
    state.conflicts.length !== 0 ||
    operationState.active_operations.length !== 0 ||
    eligibility.issues.length !== 0 ||
    publishPlan.issues.length !== 0 ||
    policyResolution.project_root !== state.root ||
    updateRecord.proposal.project.root !== state.root ||
    updateRecord.integrity.proposal_sha256 !==
      gitFinishUpdateProposalIntegrity(updateRecord.proposal) ||
    updateRecord.proposal.policy.resolution_sha256 !==
      policyResolutionChecksum(policyResolution) ||
    updateRecord.proposal.operation.base_branch !==
      policyResolution.effective_policy.base_branch ||
    updateRecord.proposal.operation.remote !== publishPlan.remote ||
    updateRecord.proposal.id !== eligibility.update_proposal_id ||
    updateResult.previous_head_sha !==
      updateRecord.proposal.operation.local_head_sha ||
    updateResult.base_commit_sha !==
      updateRecord.proposal.remote.base_commit_sha ||
    updateRecord.proposal.operation.current_branch !== state.branch ||
    updateResult.resulting_head_sha !== state.latest_commit.sha ||
    eligibility.repository_root !== state.root ||
    eligibility.current_branch !== state.branch ||
    eligibility.local_head_sha !== state.latest_commit.sha ||
    eligibility.update_proposal_id !== updateRecord.proposal.id ||
    publishPlan.repository_root !== state.root ||
    publishPlan.base_branch !== policyResolution.effective_policy.base_branch ||
    publishPlan.current_branch !== state.branch ||
    publishPlan.local_head_sha !== state.latest_commit.sha ||
    publishPlan.remote !== eligibility.remote ||
    publishPlan.destination_branch !== state.branch ||
    publishPlan.destination_ref !== `refs/heads/${state.branch}` ||
    publishPlan.update_proposal_id !== updateRecord.proposal.id ||
    remoteInspection.repository_root !== state.root ||
    remoteInspection.remote !== publishPlan.remote ||
    remoteInspection.destination_branch !== state.branch ||
    remoteInspection.destination_ref !== publishPlan.destination_ref ||
    remoteInspection.selected_push_url !== publishPlan.push_url ||
    remoteInspection.destination.commit_sha !== publishPlan.remote_commit_sha ||
    !isEligibleDisposition(publishPlan.disposition)
  ) {
    throw new GitFinishPublishProposalError(
      "INVALID_PUBLISH_PREFLIGHT",
      "Eligible Finish Publish preflight contains inconsistent immutable state",
    );
  }

  if (
    publishPlan.disposition === "create" &&
    (publishPlan.remote_commit_sha !== null ||
      publishPlan.force_with_lease_expected_sha !== null)
  ) {
    throw new GitFinishPublishProposalError(
      "INVALID_PUBLISH_PREFLIGHT",
      "Publish creation must bind an absent destination without a lease",
    );
  }

  if (
    publishPlan.disposition === "up-to-date" &&
    (publishPlan.remote_commit_sha !== publishPlan.local_head_sha ||
      publishPlan.force_with_lease_expected_sha !== null)
  ) {
    throw new GitFinishPublishProposalError(
      "INVALID_PUBLISH_PREFLIGHT",
      "Up-to-date Publish must bind the local commit at the destination",
    );
  }

  if (
    publishPlan.disposition === "fast-forward" &&
    (publishPlan.remote_commit_sha === null ||
      publishPlan.remote_commit_sha === publishPlan.local_head_sha ||
      publishPlan.force_with_lease_expected_sha !== null)
  ) {
    throw new GitFinishPublishProposalError(
      "INVALID_PUBLISH_PREFLIGHT",
      "Fast-forward Publish must bind a distinct existing destination",
    );
  }

  if (
    publishPlan.disposition === "force-with-lease" &&
    (!updateResult.rebased ||
      publishPlan.remote_commit_sha !== updateResult.previous_head_sha ||
      publishPlan.force_with_lease_expected_sha !==
        updateResult.previous_head_sha)
  ) {
    throw new GitFinishPublishProposalError(
      "INVALID_PUBLISH_PREFLIGHT",
      "Force-with-lease Publish lacks exact approved Update provenance",
    );
  }

  const proposal: GitFinishPublishProposalPayload = structuredClone({
    id: options.id ?? `git-finish-publish-${randomUUID()}`,
    created_at: options.created_at ?? new Date().toISOString(),
    project: {
      key: gitProjectKey(state.root),
      root: state.root,
    },
    operation: {
      kind: "finish-publish",
      base_branch: publishPlan.base_branch,
      current_branch: publishPlan.current_branch,
      local_head_sha: publishPlan.local_head_sha,
      remote: publishPlan.remote,
      destination_branch: publishPlan.destination_branch,
      destination_ref: publishPlan.destination_ref,
      disposition: publishPlan.disposition,
      force_with_lease_expected_sha: publishPlan.force_with_lease_expected_sha,
    },
    policy: {
      resolution_sha256: policyResolutionChecksum(policyResolution),
      sources: policyResolution.sources,
      effective_policy: policyResolution.effective_policy,
    },
    remote: {
      push_url: publishPlan.push_url,
      push_url_sha256: sha256(publishPlan.push_url),
      expected_commit_sha: publishPlan.remote_commit_sha,
    },
    update: {
      proposal_id: updateRecord.proposal.id,
      proposal_sha256: updateRecord.integrity.proposal_sha256,
      applied_at: updateRecord.state.applied_at,
      previous_head_sha: updateResult.previous_head_sha,
      resulting_head_sha: updateResult.resulting_head_sha,
      base_commit_sha: updateResult.base_commit_sha,
      rebased: updateResult.rebased,
    },
  });

  return {
    schema_version: 1,
    proposal,
    integrity: {
      proposal_sha256: gitFinishPublishProposalIntegrity(proposal),
    },
    state: {
      status: "pending",
      applied_at: null,
      result: null,
    },
  };
}

export function buildGitFinishPublishReview(
  record: GitFinishPublishProposalRecord,
): GitFinishPublishReview {
  if (
    record.integrity.proposal_sha256 !==
      gitFinishPublishProposalIntegrity(record.proposal) ||
    record.proposal.remote.push_url_sha256 !==
      sha256(record.proposal.remote.push_url)
  ) {
    throw new GitFinishPublishProposalError(
      "INVALID_PROPOSAL",
      "Finish Publish proposal integrity validation failed",
    );
  }

  const proposal = record.proposal;
  const warnings = [
    "Publish Preview contacts the explicit remote but performs no push",
    "The remote may change after final inspection",
  ];

  if (proposal.operation.disposition === "force-with-lease") {
    warnings.push(
      "Publish Apply will replace remote branch history only while the destination still identifies the exact reviewed lease commit",
    );
  }

  if (proposal.operation.disposition === "up-to-date") {
    warnings.push(
      "The destination already identifies the reviewed local commit",
    );
  }

  return {
    operation: proposal.operation.kind,
    repository_root: proposal.project.root,
    base_branch: proposal.operation.base_branch,
    current_branch: proposal.operation.current_branch,
    local_head_sha: proposal.operation.local_head_sha,
    remote: proposal.operation.remote,
    push_url_display: pushUrlDisplay(proposal.remote.push_url),
    push_url_sha256: proposal.remote.push_url_sha256,
    destination_branch: proposal.operation.destination_branch,
    destination_ref: proposal.operation.destination_ref,
    expected_remote_commit_sha: proposal.remote.expected_commit_sha,
    disposition: proposal.operation.disposition,
    force_with_lease_expected_sha:
      proposal.operation.force_with_lease_expected_sha,
    update_proposal_id: proposal.update.proposal_id,
    update_proposal_sha256: proposal.update.proposal_sha256,
    policy_resolution_sha256: proposal.policy.resolution_sha256,
    project_policy_present: proposal.policy.sources.project.present,
    warnings,
  };
}
