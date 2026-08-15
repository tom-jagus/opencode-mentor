import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import type { GitCheckpointCommitPreflight } from "./git_checkpoint_commit";
import type { GitCheckpointCommitDiff } from "./git_checkpoint_commit_diff";
import type { EffectiveGitPolicyResolution, GitPolicy } from "./git_policy";
import { validateEffectiveGitPolicy } from "./git_policy";
import type { FileChange } from "./git_state";
import {
  canonicalJson,
  gitProjectKey,
  mentorStateRoot,
  policyResolutionChecksum,
  sha256,
} from "./git_lifecycle_proposal";
import {
  GitLifecycleStorageError,
  persistPrivateJsonRecord,
  readPrivateJsonRecord,
} from "./git_lifecycle_storage";
import {
  validateCommitMessage,
  validateWorkingBranchName,
} from "./git_validation";

export type GitCheckpointCommitProposalState =
  | {
      status: "pending";
      applied_at: null;
    }
  | {
      status: "applied";
      applied_at: string;
    };

export type GitCheckpointCommitProposalPayload = {
  id: string;
  created_at: string;
  project: {
    key: string;
    root: string;
  };
  operation: {
    kind: "commit-staged-diff";
    base_branch: string;
    current_branch: string;
    head_sha: string;
    commit_message: string;
    commit_message_sha256: string;
  };
  policy: {
    resolution_sha256: string;
    sources: EffectiveGitPolicyResolution["sources"];
    effective_policy: GitPolicy;
  };
  repository: {
    conflicts: [];
    changes: FileChange[];
    staged_diff: {
      patch_bytes: number;
      patch_sha256: string;
    };
  };
};

export type GitCheckpointCommitProposalRecord = {
  schema_version: 1;
  proposal: GitCheckpointCommitProposalPayload;
  integrity: {
    proposal_sha256: string;
  };
  state: GitCheckpointCommitProposalState;
};

export type LoadedGitCheckpointCommitProposal = {
  record: GitCheckpointCommitProposalRecord;
  record_path: string;
};

export type GitCheckpointCommitReview = {
  operation: "commit-staged-diff";
  repository_root: string;
  base_branch: string;
  current_branch: string;
  head_sha: string;
  staged_changes: FileChange[];
  remaining_changes: FileChange[];
  commit_message: string;
  commit_message_sha256: string;
  semantic_review: string[];
  staged_diff: string;
  staged_diff_bytes: number;
  staged_diff_sha256: string;
  policy_resolution_sha256: string;
  project_policy_present: boolean;
};

export class GitCheckpointCommitProposalError extends Error {
  readonly code:
    | "COMMIT_PREFLIGHT_FAILED"
    | "COMMIT_NOT_ELIGIBLE"
    | "INVALID_COMMIT_PREFLIGHT"
    | "PROPOSAL_STORAGE_FAILED"
    | "INVALID_PROPOSAL"
    | "INVALID_PROPOSAL_ID"
    | "PROPOSAL_NOT_FOUND"
    | "UNSUPPORTED_PROPOSAL_VERSION"
    | "PROPOSAL_INTEGRITY_FAILED"
    | "PROJECT_MISMATCH"
    | "PROPOSAL_ALREADY_APPLIED"
    | "STALE_PROPOSAL"
    | "APPLY_FAILED"
    | "APPLY_IN_PROGRESS"
    | "PROPOSAL_STATE_FAILED"
    | "ROLLBACK_FAILED";

  constructor(code: GitCheckpointCommitProposalError["code"], message: string) {
    super(message);
    this.name = "GitCheckpointCommitProposalError";
    this.code = code;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function invalid(message: string): never {
  throw new GitCheckpointCommitProposalError("INVALID_PROPOSAL", message);
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

function isFileChange(value: unknown): value is FileChange {
  if (!isRecord(value)) {
    return false;
  }

  const keys =
    value.original_path === undefined
      ? ["path", "index_status", "worktree_status"]
      : ["path", "original_path", "index_status", "worktree_status"];

  return (
    hasExactKeys(value, keys) &&
    isNonEmptyString(value.path) &&
    (value.original_path === undefined ||
      isNonEmptyString(value.original_path)) &&
    typeof value.index_status === "string" &&
    value.index_status.length === 1 &&
    typeof value.worktree_status === "string" &&
    value.worktree_status.length === 1
  );
}

function isStaged(change: FileChange): boolean {
  return (
    change.index_status !== " " &&
    change.index_status !== "?" &&
    change.index_status !== "!"
  );
}

function hasRemainingWorktreeChange(change: FileChange): boolean {
  return (
    change.worktree_status !== " " ||
    change.index_status === "?" ||
    change.index_status === "!"
  );
}

function sameValue(first: unknown, second: unknown): boolean {
  return canonicalJson(first) === canonicalJson(second);
}

export function gitCheckpointCommitProposalIntegrity(
  proposal: GitCheckpointCommitProposalPayload,
): string {
  return sha256(
    canonicalJson({
      schema_version: 1,
      proposal,
    }),
  );
}

export function gitCheckpointCommitProposalRoot(): string {
  return join(mentorStateRoot(), "git-checkpoint-commit-proposals");
}

function validateProposalId(proposalId: string): void {
  if (!/^git-checkpoint-commit-[A-Za-z0-9-]+$/.test(proposalId)) {
    throw new GitCheckpointCommitProposalError(
      "INVALID_PROPOSAL_ID",
      "Git checkpoint Commit proposal identifier is invalid",
    );
  }
}

function parseGitCheckpointCommitProposalRecord(
  value: unknown,
): GitCheckpointCommitProposalRecord {
  if (!isRecord(value)) {
    invalid("Git checkpoint Commit proposal record must be an object");
  }

  if (value.schema_version !== 1) {
    throw new GitCheckpointCommitProposalError(
      "UNSUPPORTED_PROPOSAL_VERSION",
      "Git checkpoint Commit proposal schema version is unsupported",
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
    invalid(
      "Git checkpoint Commit proposal contains unknown or missing fields",
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
      "repository",
    ]) ||
    !hasExactKeys(integrity, ["proposal_sha256"]) ||
    !hasExactKeys(state, ["status", "applied_at"]) ||
    !isRecord(proposal.project) ||
    !isRecord(proposal.operation) ||
    !isRecord(proposal.policy) ||
    !isRecord(proposal.repository)
  ) {
    invalid("Git checkpoint Commit proposal payload is incomplete");
  }

  const project = proposal.project;
  const operation = proposal.operation;
  const policy = proposal.policy;
  const repository = proposal.repository;

  if (
    !hasExactKeys(project, ["key", "root"]) ||
    !hasExactKeys(operation, [
      "kind",
      "base_branch",
      "current_branch",
      "head_sha",
      "commit_message",
      "commit_message_sha256",
    ]) ||
    !hasExactKeys(policy, [
      "resolution_sha256",
      "sources",
      "effective_policy",
    ]) ||
    !hasExactKeys(repository, ["conflicts", "changes", "staged_diff"]) ||
    !isRecord(policy.sources) ||
    !isRecord(policy.effective_policy) ||
    !isRecord(repository.staged_diff)
  ) {
    invalid("Git checkpoint Commit proposal payload is incomplete");
  }

  const sources = policy.sources;
  const stagedDiff = repository.staged_diff;

  if (
    !hasExactKeys(sources, ["global", "project"]) ||
    !isRecord(sources.global) ||
    !isRecord(sources.project) ||
    !hasExactKeys(sources.global, ["path"]) ||
    !hasExactKeys(sources.project, ["present", "path"]) ||
    !hasExactKeys(stagedDiff, ["patch_bytes", "patch_sha256"])
  ) {
    invalid("Git checkpoint Commit proposal source state is invalid");
  }

  if (
    !isNonEmptyString(proposal.id) ||
    !/^git-checkpoint-commit-[A-Za-z0-9-]+$/.test(proposal.id) ||
    !isIsoDate(proposal.created_at) ||
    !isNonEmptyString(project.key) ||
    !isNonEmptyString(project.root) ||
    operation.kind !== "commit-staged-diff" ||
    !isNonEmptyString(operation.base_branch) ||
    !isNonEmptyString(operation.current_branch) ||
    !isGitObjectId(operation.head_sha) ||
    !isNonEmptyString(operation.commit_message) ||
    !isSha256(operation.commit_message_sha256) ||
    !isSha256(policy.resolution_sha256) ||
    !isNonEmptyString(sources.global.path) ||
    typeof sources.project.present !== "boolean" ||
    !isNonEmptyString(sources.project.path) ||
    !Array.isArray(repository.conflicts) ||
    repository.conflicts.length !== 0 ||
    !Array.isArray(repository.changes) ||
    repository.changes.length === 0 ||
    !repository.changes.every(isFileChange) ||
    typeof stagedDiff.patch_bytes !== "number" ||
    !Number.isSafeInteger(stagedDiff.patch_bytes) ||
    stagedDiff.patch_bytes <= 0 ||
    !isSha256(stagedDiff.patch_sha256) ||
    !isSha256(integrity.proposal_sha256)
  ) {
    invalid("Git checkpoint Commit proposal contains invalid values");
  }

  if (state.status !== "pending" && state.status !== "applied") {
    invalid("Git checkpoint Commit proposal state is invalid");
  }

  if (
    (state.status === "pending" && state.applied_at !== null) ||
    (state.status === "applied" && !isIsoDate(state.applied_at))
  ) {
    invalid("Git checkpoint Commit proposal application state is inconsistent");
  }

  let effectivePolicy: GitPolicy;

  try {
    effectivePolicy = validateEffectiveGitPolicy(policy.effective_policy);
  } catch (error) {
    invalid(
      `Git checkpoint Commit proposal contains invalid effective policy: ${errorMessage(error)}`,
    );
  }

  const changes = repository.changes as FileChange[];

  if (
    project.key !== gitProjectKey(project.root) ||
    operation.base_branch !== effectivePolicy.base_branch ||
    operation.current_branch === operation.base_branch ||
    !validateWorkingBranchName(operation.current_branch, effectivePolicy)
      .valid ||
    !validateCommitMessage(operation.commit_message, effectivePolicy).valid ||
    operation.commit_message_sha256 !== sha256(operation.commit_message) ||
    !changes.some(isStaged) ||
    new Set(changes.map((change) => change.path)).size !== changes.length
  ) {
    invalid(
      "Git checkpoint Commit proposal contains inconsistent operation state",
    );
  }

  const record = value as unknown as GitCheckpointCommitProposalRecord;

  record.proposal.policy.effective_policy = effectivePolicy;

  if (
    record.proposal.policy.resolution_sha256 !==
    policyResolutionChecksum({
      project_root: record.proposal.project.root,
      sources: record.proposal.policy.sources,
      effective_policy: effectivePolicy,
    })
  ) {
    invalid("Git checkpoint Commit proposal policy checksum is inconsistent");
  }

  return record;
}

export function buildGitCheckpointCommitProposal(
  preflight: GitCheckpointCommitPreflight,
  options: {
    id?: string;
    created_at?: string;
  } = {},
): GitCheckpointCommitProposalRecord {
  if (!preflight.ok) {
    throw new GitCheckpointCommitProposalError(
      "COMMIT_PREFLIGHT_FAILED",
      preflight.error.message,
    );
  }

  if (!preflight.commit_plan.eligible) {
    throw new GitCheckpointCommitProposalError(
      "COMMIT_NOT_ELIGIBLE",
      "Git checkpoint Commit preflight is not eligible for Preview",
    );
  }

  if (preflight.diff === null) {
    throw new GitCheckpointCommitProposalError(
      "INVALID_COMMIT_PREFLIGHT",
      "Eligible Commit preflight does not contain a staged diff",
    );
  }

  const {
    state,
    policy_resolution: policyResolution,
    commit_plan: commitPlan,
    diff,
  } = preflight;

  if (
    state.branch === null ||
    state.latest_commit === null ||
    state.conflicts.length !== 0 ||
    commitPlan.repository_root !== state.root ||
    commitPlan.current_branch !== state.branch ||
    commitPlan.head_sha !== state.latest_commit.sha ||
    commitPlan.base_branch !== policyResolution.effective_policy.base_branch ||
    policyResolution.project_root !== state.root ||
    diff.repository_root !== state.root ||
    diff.patch_bytes !== Buffer.byteLength(diff.patch, "utf8") ||
    diff.patch_sha256 !== sha256(diff.patch) ||
    !commitPlan.message_validation.valid
  ) {
    throw new GitCheckpointCommitProposalError(
      "INVALID_COMMIT_PREFLIGHT",
      "Eligible Commit preflight contains inconsistent immutable state",
    );
  }

  const expectedStaged = state.changes.filter(isStaged);
  const expectedRemaining = state.changes.filter(hasRemainingWorktreeChange);

  if (
    expectedStaged.length === 0 ||
    !sameValue(commitPlan.staged_changes, expectedStaged) ||
    !sameValue(commitPlan.remaining_changes, expectedRemaining)
  ) {
    throw new GitCheckpointCommitProposalError(
      "INVALID_COMMIT_PREFLIGHT",
      "Eligible Commit preflight contains an inconsistent change plan",
    );
  }

  const proposal: GitCheckpointCommitProposalPayload = structuredClone({
    id: options.id ?? `git-checkpoint-commit-${randomUUID()}`,
    created_at: options.created_at ?? new Date().toISOString(),
    project: {
      key: gitProjectKey(state.root),
      root: state.root,
    },
    operation: {
      kind: "commit-staged-diff",
      base_branch: commitPlan.base_branch,
      current_branch: state.branch,
      head_sha: state.latest_commit.sha,
      commit_message: commitPlan.commit_message,
      commit_message_sha256: sha256(commitPlan.commit_message),
    },
    policy: {
      resolution_sha256: policyResolutionChecksum(policyResolution),
      sources: policyResolution.sources,
      effective_policy: policyResolution.effective_policy,
    },
    repository: {
      conflicts: [],
      changes: state.changes,
      staged_diff: {
        patch_bytes: diff.patch_bytes,
        patch_sha256: diff.patch_sha256,
      },
    },
  });

  return {
    schema_version: 1,
    proposal,
    integrity: {
      proposal_sha256: gitCheckpointCommitProposalIntegrity(proposal),
    },
    state: {
      status: "pending",
      applied_at: null,
    },
  };
}

export function buildGitCheckpointCommitReview(
  record: GitCheckpointCommitProposalRecord,
  diff: GitCheckpointCommitDiff,
): GitCheckpointCommitReview {
  const proposal = record.proposal;

  if (
    diff.repository_root !== proposal.project.root ||
    diff.patch_bytes !== proposal.repository.staged_diff.patch_bytes ||
    diff.patch_sha256 !== proposal.repository.staged_diff.patch_sha256 ||
    diff.patch_bytes !== Buffer.byteLength(diff.patch, "utf8") ||
    diff.patch_sha256 !== sha256(diff.patch)
  ) {
    throw new GitCheckpointCommitProposalError(
      "INVALID_COMMIT_PREFLIGHT",
      "Commit review diff does not match the immutable proposal",
    );
  }

  const validation = validateCommitMessage(
    proposal.operation.commit_message,
    proposal.policy.effective_policy,
  );

  return {
    operation: proposal.operation.kind,
    repository_root: proposal.project.root,
    base_branch: proposal.operation.base_branch,
    current_branch: proposal.operation.current_branch,
    head_sha: proposal.operation.head_sha,
    staged_changes: proposal.repository.changes.filter(isStaged),
    remaining_changes: proposal.repository.changes.filter(
      hasRemainingWorktreeChange,
    ),
    commit_message: proposal.operation.commit_message,
    commit_message_sha256: proposal.operation.commit_message_sha256,
    semantic_review: validation.semantic_review,
    staged_diff: diff.patch,
    staged_diff_bytes: diff.patch_bytes,
    staged_diff_sha256: diff.patch_sha256,
    policy_resolution_sha256: proposal.policy.resolution_sha256,
    project_policy_present: proposal.policy.sources.project.present,
  };
}

export async function persistGitCheckpointCommitProposal(
  record: GitCheckpointCommitProposalRecord,
  storageRoot = gitCheckpointCommitProposalRoot(),
): Promise<string> {
  const validated = parseGitCheckpointCommitProposalRecord(
    structuredClone(record),
  );

  if (
    validated.state.status !== "pending" ||
    validated.integrity.proposal_sha256 !==
      gitCheckpointCommitProposalIntegrity(validated.proposal)
  ) {
    throw new GitCheckpointCommitProposalError(
      "INVALID_PROPOSAL",
      "Git checkpoint Commit proposal is not safe to persist",
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
      throw new GitCheckpointCommitProposalError(
        "PROPOSAL_STORAGE_FAILED",
        `Unable to persist Git checkpoint Commit proposal: ${error.message}`,
      );
    }

    throw error;
  }
}

export async function loadGitCheckpointCommitProposal(
  projectRoot: string,
  proposalId: string,
  storageRoot = gitCheckpointCommitProposalRoot(),
): Promise<LoadedGitCheckpointCommitProposal> {
  validateProposalId(proposalId);

  let canonicalProjectRoot: string;

  try {
    canonicalProjectRoot = await realpath(projectRoot);
  } catch (error) {
    throw new GitCheckpointCommitProposalError(
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
      throw new GitCheckpointCommitProposalError(
        "PROPOSAL_NOT_FOUND",
        "Git checkpoint Commit proposal was not found for the current project",
      );
    }

    if (error instanceof GitLifecycleStorageError) {
      throw new GitCheckpointCommitProposalError(
        "INVALID_PROPOSAL",
        error.message,
      );
    }

    throw error;
  }

  const record = parseGitCheckpointCommitProposalRecord(loaded.value);

  if (record.proposal.id !== proposalId) {
    throw new GitCheckpointCommitProposalError(
      "INVALID_PROPOSAL",
      "Git checkpoint Commit proposal identifier does not match its storage path",
    );
  }

  if (
    record.proposal.project.root !== canonicalProjectRoot ||
    record.proposal.project.key !== projectKey
  ) {
    throw new GitCheckpointCommitProposalError(
      "PROJECT_MISMATCH",
      "Git checkpoint Commit proposal belongs to a different project",
    );
  }

  if (
    record.integrity.proposal_sha256 !==
    gitCheckpointCommitProposalIntegrity(record.proposal)
  ) {
    throw new GitCheckpointCommitProposalError(
      "PROPOSAL_INTEGRITY_FAILED",
      "Git checkpoint Commit proposal integrity validation failed",
    );
  }

  if (record.state.status === "applied") {
    throw new GitCheckpointCommitProposalError(
      "PROPOSAL_ALREADY_APPLIED",
      "Git checkpoint Commit proposal has already been applied",
    );
  }

  return {
    record,
    record_path: loaded.record_path,
  };
}
