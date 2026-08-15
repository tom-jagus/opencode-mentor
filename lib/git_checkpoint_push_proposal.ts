import { randomUUID } from "node:crypto";
import type {
  GitCheckpointPushDisposition,
  GitCheckpointPushPreflight,
} from "./git_checkpoint_push";
import type { EffectiveGitPolicyResolution, GitPolicy } from "./git_policy";
import {
  canonicalJson,
  gitProjectKey,
  policyResolutionChecksum,
  sha256,
} from "./git_lifecycle_proposal";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { validateEffectiveGitPolicy } from "./git_policy";
import { mentorStateRoot } from "./git_lifecycle_proposal";
import {
  GitLifecycleStorageError,
  persistPrivateJsonRecord,
  readPrivateJsonRecord,
} from "./git_lifecycle_storage";
import { validateWorkingBranchName } from "./git_validation";

export type GitCheckpointPushProposalState =
  | {
      status: "pending";
      applied_at: null;
    }
  | {
      status: "applied";
      applied_at: string;
    };

export type GitCheckpointPushProposalPayload = {
  id: string;
  created_at: string;
  project: {
    key: string;
    root: string;
  };
  operation: {
    kind: "push-commit";
    base_branch: string;
    current_branch: string;
    local_commit_sha: string;
    remote: string;
    destination_branch: string;
    destination_ref: string;
    disposition: "create" | "up-to-date" | "fast-forward";
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
};

export type GitCheckpointPushProposalRecord = {
  schema_version: 1;
  proposal: GitCheckpointPushProposalPayload;
  integrity: {
    proposal_sha256: string;
  };
  state: GitCheckpointPushProposalState;
};

export type LoadedGitCheckpointPushProposal = {
  record: GitCheckpointPushProposalRecord;
  record_path: string;
};

export type GitCheckpointPushReview = {
  operation: "push-commit";
  repository_root: string;
  base_branch: string;
  current_branch: string;
  local_commit_sha: string;
  remote: string;
  push_url_display: string;
  push_url_sha256: string;
  destination_branch: string;
  destination_ref: string;
  expected_remote_commit_sha: string | null;
  disposition: "create" | "up-to-date" | "fast-forward";
  policy_resolution_sha256: string;
  project_policy_present: boolean;
  warnings: string[];
};

export class GitCheckpointPushProposalError extends Error {
  readonly code:
    | "PUSH_PREFLIGHT_FAILED"
    | "PUSH_NOT_ELIGIBLE"
    | "INVALID_PUSH_PREFLIGHT"
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
    | "PROPOSAL_STATE_FAILED";

  constructor(code: GitCheckpointPushProposalError["code"], message: string) {
    super(message);
    this.name = "GitCheckpointPushProposalError";
    this.code = code;
  }
}

function sameValue(first: unknown, second: unknown): boolean {
  return canonicalJson(first) === canonicalJson(second);
}

function isEligibleDisposition(
  disposition: GitCheckpointPushDisposition,
): disposition is "create" | "up-to-date" | "fast-forward" {
  return (
    disposition === "create" ||
    disposition === "up-to-date" ||
    disposition === "fast-forward"
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
    // Local paths and SCP-like SSH URLs are not
    // parsed as standard URLs and are displayed exactly.
    return pushUrl;
  }
}

export function gitCheckpointPushProposalIntegrity(
  proposal: GitCheckpointPushProposalPayload,
): string {
  return sha256(
    canonicalJson({
      schema_version: 1,
      proposal,
    }),
  );
}

export function buildGitCheckpointPushProposal(
  preflight: GitCheckpointPushPreflight,
  options: {
    id?: string;
    created_at?: string;
  } = {},
): GitCheckpointPushProposalRecord {
  if (!preflight.ok) {
    throw new GitCheckpointPushProposalError(
      "PUSH_PREFLIGHT_FAILED",
      preflight.error.message,
    );
  }

  if (!preflight.push_plan.eligible) {
    throw new GitCheckpointPushProposalError(
      "PUSH_NOT_ELIGIBLE",
      "Git checkpoint Push preflight is not eligible for Preview",
    );
  }

  if (preflight.remote_inspection === null) {
    throw new GitCheckpointPushProposalError(
      "INVALID_PUSH_PREFLIGHT",
      "Eligible Push preflight does not contain remote inspection",
    );
  }

  const {
    state,
    policy_resolution: policyResolution,
    push_plan: pushPlan,
    remote_inspection: remoteInspection,
  } = preflight;

  if (
    state.branch === null ||
    state.latest_commit === null ||
    pushPlan.repository_root !== state.root ||
    pushPlan.current_branch !== state.branch ||
    pushPlan.local_commit_sha !== state.latest_commit.sha ||
    pushPlan.base_branch !== policyResolution.effective_policy.base_branch ||
    policyResolution.project_root !== state.root ||
    remoteInspection.repository_root !== state.root ||
    pushPlan.remote !== remoteInspection.remote ||
    pushPlan.remote_push_url !== remoteInspection.selected_push_url ||
    pushPlan.destination_branch !== remoteInspection.destination_branch ||
    pushPlan.destination_ref !== remoteInspection.destination_ref ||
    pushPlan.remote_commit_sha !== remoteInspection.destination.commit_sha ||
    !isEligibleDisposition(pushPlan.disposition) ||
    pushPlan.issues.length !== 0
  ) {
    throw new GitCheckpointPushProposalError(
      "INVALID_PUSH_PREFLIGHT",
      "Eligible Push preflight contains inconsistent immutable state",
    );
  }

  if (
    pushPlan.disposition === "create" &&
    remoteInspection.destination.exists
  ) {
    throw new GitCheckpointPushProposalError(
      "INVALID_PUSH_PREFLIGHT",
      "Push creation disposition conflicts with existing remote destination",
    );
  }

  if (
    pushPlan.disposition === "up-to-date" &&
    (!remoteInspection.destination.exists ||
      remoteInspection.destination.commit_sha !== pushPlan.local_commit_sha)
  ) {
    throw new GitCheckpointPushProposalError(
      "INVALID_PUSH_PREFLIGHT",
      "Up-to-date Push disposition conflicts with remote destination",
    );
  }

  if (
    pushPlan.disposition === "fast-forward" &&
    (!remoteInspection.destination.exists ||
      remoteInspection.destination.commit_sha === pushPlan.local_commit_sha)
  ) {
    throw new GitCheckpointPushProposalError(
      "INVALID_PUSH_PREFLIGHT",
      "Fast-forward Push disposition conflicts with remote destination",
    );
  }

  const proposal: GitCheckpointPushProposalPayload = structuredClone({
    id: options.id ?? `git-checkpoint-push-${randomUUID()}`,
    created_at: options.created_at ?? new Date().toISOString(),
    project: {
      key: gitProjectKey(state.root),
      root: state.root,
    },
    operation: {
      kind: "push-commit",
      base_branch: pushPlan.base_branch,
      current_branch: state.branch,
      local_commit_sha: pushPlan.local_commit_sha,
      remote: pushPlan.remote,
      destination_branch: pushPlan.destination_branch,
      destination_ref: pushPlan.destination_ref,
      disposition: pushPlan.disposition,
    },
    policy: {
      resolution_sha256: policyResolutionChecksum(policyResolution),
      sources: policyResolution.sources,
      effective_policy: policyResolution.effective_policy,
    },
    remote: {
      push_url: remoteInspection.selected_push_url,
      push_url_sha256: sha256(remoteInspection.selected_push_url),
      expected_commit_sha: remoteInspection.destination.commit_sha,
    },
  });

  return {
    schema_version: 1,
    proposal,
    integrity: {
      proposal_sha256: gitCheckpointPushProposalIntegrity(proposal),
    },
    state: {
      status: "pending",
      applied_at: null,
    },
  };
}

export function buildGitCheckpointPushReview(
  record: GitCheckpointPushProposalRecord,
): GitCheckpointPushReview {
  const proposal = record.proposal;

  if (proposal.remote.push_url_sha256 !== sha256(proposal.remote.push_url)) {
    throw new GitCheckpointPushProposalError(
      "INVALID_PROPOSAL",
      "Push proposal contains an inconsistent remote URL checksum",
    );
  }

  const warnings = [
    "Push Preview contacts the explicit remote but performs no push",
    "Normal Push cannot atomically guarantee that the remote remains unchanged after final inspection",
  ];

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
    local_commit_sha: proposal.operation.local_commit_sha,
    remote: proposal.operation.remote,
    push_url_display: pushUrlDisplay(proposal.remote.push_url),
    push_url_sha256: proposal.remote.push_url_sha256,
    destination_branch: proposal.operation.destination_branch,
    destination_ref: proposal.operation.destination_ref,
    expected_remote_commit_sha: proposal.remote.expected_commit_sha,
    disposition: proposal.operation.disposition,
    policy_resolution_sha256: proposal.policy.resolution_sha256,
    project_policy_present: proposal.policy.sources.project.present,
    warnings,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function invalidProposal(message: string): never {
  throw new GitCheckpointPushProposalError("INVALID_PROPOSAL", message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();

  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function isGitObjectId(value: unknown): value is string {
  return (
    typeof value === "string" && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value)
  );
}

function isIsoDate(value: unknown): value is string {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

function validateProposalId(proposalId: string): void {
  if (!/^git-checkpoint-push-[A-Za-z0-9-]+$/.test(proposalId)) {
    throw new GitCheckpointPushProposalError(
      "INVALID_PROPOSAL_ID",
      "Git checkpoint Push proposal identifier is invalid",
    );
  }
}

function parseGitCheckpointPushProposalRecord(
  value: unknown,
): GitCheckpointPushProposalRecord {
  if (!isRecord(value)) {
    invalidProposal("Git checkpoint Push proposal record must be an object");
  }

  if (value.schema_version !== 1) {
    throw new GitCheckpointPushProposalError(
      "UNSUPPORTED_PROPOSAL_VERSION",
      "Git checkpoint Push proposal schema version is unsupported",
    );
  }

  if (
    !hasExactKeys(value, [
      "schema_version",
      "proposal",
      "integrity",
      "state",
    ]) ||
    !isRecord(value.proposal) ||
    !isRecord(value.integrity) ||
    !isRecord(value.state)
  ) {
    invalidProposal(
      "Git checkpoint Push proposal contains unknown or missing fields",
    );
  }

  const proposal = value.proposal;
  const integrity = value.integrity;
  const state = value.state;

  if (
    !hasExactKeys(proposal, [
      "id",
      "created_at",
      "project",
      "operation",
      "policy",
      "remote",
    ]) ||
    !hasExactKeys(integrity, ["proposal_sha256"]) ||
    !hasExactKeys(state, ["status", "applied_at"]) ||
    !isRecord(proposal.project) ||
    !isRecord(proposal.operation) ||
    !isRecord(proposal.policy) ||
    !isRecord(proposal.remote)
  ) {
    invalidProposal("Git checkpoint Push proposal payload is incomplete");
  }

  const project = proposal.project;
  const operation = proposal.operation;
  const policy = proposal.policy;
  const remote = proposal.remote;

  if (
    !hasExactKeys(project, ["key", "root"]) ||
    !hasExactKeys(operation, [
      "kind",
      "base_branch",
      "current_branch",
      "local_commit_sha",
      "remote",
      "destination_branch",
      "destination_ref",
      "disposition",
    ]) ||
    !hasExactKeys(policy, [
      "resolution_sha256",
      "sources",
      "effective_policy",
    ]) ||
    !hasExactKeys(remote, [
      "push_url",
      "push_url_sha256",
      "expected_commit_sha",
    ]) ||
    !isRecord(policy.sources) ||
    !isRecord(policy.effective_policy)
  ) {
    invalidProposal("Git checkpoint Push proposal payload is incomplete");
  }

  const sources = policy.sources;

  if (
    !hasExactKeys(sources, ["global", "project"]) ||
    !isRecord(sources.global) ||
    !isRecord(sources.project) ||
    !hasExactKeys(sources.global, ["path"]) ||
    !hasExactKeys(sources.project, ["present", "path"])
  ) {
    invalidProposal("Git checkpoint Push proposal policy sources are invalid");
  }

  if (
    !isNonEmptyString(proposal.id) ||
    !/^git-checkpoint-push-[A-Za-z0-9-]+$/.test(proposal.id) ||
    !isIsoDate(proposal.created_at) ||
    !isNonEmptyString(project.key) ||
    !isNonEmptyString(project.root) ||
    operation.kind !== "push-commit" ||
    !isNonEmptyString(operation.base_branch) ||
    !isNonEmptyString(operation.current_branch) ||
    !isGitObjectId(operation.local_commit_sha) ||
    !isNonEmptyString(operation.remote) ||
    !isNonEmptyString(operation.destination_branch) ||
    !isNonEmptyString(operation.destination_ref) ||
    (operation.disposition !== "create" &&
      operation.disposition !== "up-to-date" &&
      operation.disposition !== "fast-forward") ||
    !isSha256(policy.resolution_sha256) ||
    !isNonEmptyString(sources.global.path) ||
    typeof sources.project.present !== "boolean" ||
    !isNonEmptyString(sources.project.path) ||
    !isNonEmptyString(remote.push_url) ||
    !isSha256(remote.push_url_sha256) ||
    (remote.expected_commit_sha !== null &&
      !isGitObjectId(remote.expected_commit_sha)) ||
    !isSha256(integrity.proposal_sha256)
  ) {
    invalidProposal("Git checkpoint Push proposal contains invalid values");
  }

  if (state.status !== "pending" && state.status !== "applied") {
    invalidProposal("Git checkpoint Push proposal state is invalid");
  }

  if (
    (state.status === "pending" && state.applied_at !== null) ||
    (state.status === "applied" && !isIsoDate(state.applied_at))
  ) {
    invalidProposal(
      "Git checkpoint Push proposal application state is inconsistent",
    );
  }

  let effectivePolicy: GitPolicy;

  try {
    effectivePolicy = validateEffectiveGitPolicy(policy.effective_policy);
  } catch (error) {
    invalidProposal(
      `Git checkpoint Push proposal contains invalid effective policy: ${errorMessage(error)}`,
    );
  }

  if (
    project.key !== gitProjectKey(project.root) ||
    operation.base_branch !== effectivePolicy.base_branch ||
    operation.current_branch === operation.base_branch ||
    operation.destination_branch === operation.base_branch ||
    !validateWorkingBranchName(operation.current_branch, effectivePolicy)
      .valid ||
    !validateWorkingBranchName(operation.destination_branch, effectivePolicy)
      .valid ||
    operation.destination_ref !==
      `refs/heads/${operation.destination_branch}` ||
    remote.push_url_sha256 !== sha256(remote.push_url)
  ) {
    invalidProposal(
      "Git checkpoint Push proposal contains inconsistent operation state",
    );
  }

  if (
    operation.disposition === "create" &&
    remote.expected_commit_sha !== null
  ) {
    invalidProposal("Push creation proposal must bind an absent destination");
  }

  if (
    operation.disposition === "up-to-date" &&
    remote.expected_commit_sha !== operation.local_commit_sha
  ) {
    invalidProposal(
      "Up-to-date Push proposal must bind the local commit at the destination",
    );
  }

  if (
    operation.disposition === "fast-forward" &&
    (remote.expected_commit_sha === null ||
      remote.expected_commit_sha === operation.local_commit_sha)
  ) {
    invalidProposal(
      "Fast-forward Push proposal must bind a distinct existing destination commit",
    );
  }

  const record = value as unknown as GitCheckpointPushProposalRecord;

  record.proposal.policy.effective_policy = effectivePolicy;

  if (
    record.proposal.policy.resolution_sha256 !==
    policyResolutionChecksum({
      project_root: record.proposal.project.root,
      sources: record.proposal.policy.sources,
      effective_policy: effectivePolicy,
    })
  ) {
    invalidProposal(
      "Git checkpoint Push proposal policy checksum is inconsistent",
    );
  }

  return record;
}

export function gitCheckpointPushProposalRoot(): string {
  return join(mentorStateRoot(), "git-checkpoint-push-proposals");
}

export async function persistGitCheckpointPushProposal(
  record: GitCheckpointPushProposalRecord,
  storageRoot = gitCheckpointPushProposalRoot(),
): Promise<string> {
  const validated = parseGitCheckpointPushProposalRecord(
    structuredClone(record),
  );

  if (
    validated.state.status !== "pending" ||
    validated.integrity.proposal_sha256 !==
      gitCheckpointPushProposalIntegrity(validated.proposal)
  ) {
    throw new GitCheckpointPushProposalError(
      "INVALID_PROPOSAL",
      "Git checkpoint Push proposal is not safe to persist",
    );
  }

  try {
    return await persistPrivateJsonRecord({
      storage_root: storageRoot,
      project_key: validated.proposal.project.key,
      proposal_id: validated.proposal.id,
      record: validated,
    });
  } catch (error) {
    if (error instanceof GitLifecycleStorageError) {
      throw new GitCheckpointPushProposalError(
        "PROPOSAL_STORAGE_FAILED",
        `Unable to persist Git checkpoint Push proposal: ${error.message}`,
      );
    }

    throw error;
  }
}

export async function loadGitCheckpointPushProposal(
  projectRoot: string,
  proposalId: string,
  storageRoot = gitCheckpointPushProposalRoot(),
): Promise<LoadedGitCheckpointPushProposal> {
  validateProposalId(proposalId);

  let canonicalProjectRoot: string;

  try {
    canonicalProjectRoot = await realpath(projectRoot);
  } catch (error) {
    throw new GitCheckpointPushProposalError(
      "PROJECT_MISMATCH",
      `Could not resolve current project: ${errorMessage(error)}`,
    );
  }

  const projectKey = gitProjectKey(canonicalProjectRoot);

  let loaded;

  try {
    loaded = await readPrivateJsonRecord({
      storage_root: storageRoot,
      project_key: projectKey,
      proposal_id: proposalId,
    });
  } catch (error) {
    if (
      error instanceof GitLifecycleStorageError &&
      error.code === "RECORD_NOT_FOUND"
    ) {
      throw new GitCheckpointPushProposalError(
        "PROPOSAL_NOT_FOUND",
        "Git checkpoint Push proposal was not found for the current project",
      );
    }

    if (error instanceof GitLifecycleStorageError) {
      throw new GitCheckpointPushProposalError(
        "INVALID_PROPOSAL",
        error.message,
      );
    }

    throw error;
  }

  const record = parseGitCheckpointPushProposalRecord(loaded.value);

  if (record.proposal.id !== proposalId) {
    throw new GitCheckpointPushProposalError(
      "INVALID_PROPOSAL",
      "Git checkpoint Push proposal identifier does not match its storage path",
    );
  }

  if (
    record.proposal.project.root !== canonicalProjectRoot ||
    record.proposal.project.key !== projectKey
  ) {
    throw new GitCheckpointPushProposalError(
      "PROJECT_MISMATCH",
      "Git checkpoint Push proposal belongs to a different project",
    );
  }

  if (
    record.integrity.proposal_sha256 !==
    gitCheckpointPushProposalIntegrity(record.proposal)
  ) {
    throw new GitCheckpointPushProposalError(
      "PROPOSAL_INTEGRITY_FAILED",
      "Git checkpoint Push proposal integrity validation failed",
    );
  }

  if (record.state.status === "applied") {
    throw new GitCheckpointPushProposalError(
      "PROPOSAL_ALREADY_APPLIED",
      "Git checkpoint Push proposal has already been applied",
    );
  }

  return {
    record,
    record_path: loaded.record_path,
  };
}
