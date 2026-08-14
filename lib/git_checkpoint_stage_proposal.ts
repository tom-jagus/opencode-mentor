import { randomUUID } from "node:crypto";
import type { EffectiveGitPolicyResolution, GitPolicy } from "./git_policy";
import type { FileChange } from "./git_state";
import type { GitCheckpointStagePreflight } from "./git_checkpoint";
import {
  canonicalJson,
  gitProjectKey,
  mentorStateRoot,
  policyResolutionChecksum,
  sha256,
} from "./git_lifecycle_proposal";
import { join } from "node:path";
import {
  GitLifecycleStorageError,
  persistPrivateJsonRecord,
  readPrivateJsonRecord,
} from "./git_lifecycle_storage";
import { realpath } from "node:fs/promises";
import { validateEffectiveGitPolicy } from "./git_policy";
import { validateWorkingBranchName } from "./git_validation";
import type {
  GitCheckpointPathSnapshot,
  GitCheckpointStageSnapshot,
} from "./git_checkpoint_stage_snapshot";

export type GitCheckpointStageProposalState =
  | {
      status: "pending";
      applied_at: null;
    }
  | {
      status: "applied";
      applied_at: string;
    };

export type LoadedGitCheckpointStageProposal = {
  record: GitCheckpointStageProposalRecord;
  record_path: string;
};

export type GitCheckpointStageProposalPayload = {
  id: string;
  created_at: string;
  project: {
    key: string;
    root: string;
  };
  operation: {
    kind: "stage-selected-paths";
    base_branch: string;
    current_branch: string;
    head_sha: string;
    selected_paths: string[];
    staging_pathspecs: string[];
  };
  policy: {
    resolution_sha256: string;
    sources: EffectiveGitPolicyResolution["sources"];
    effective_policy: GitPolicy;
  };
  repository: {
    clean: false;
    conflicts: [];
    changes: FileChange[];
    snapshot: GitCheckpointStageSnapshot;
  };
};

export type GitCheckpointStageProposalRecord = {
  schema_version: 1;
  proposal: GitCheckpointStageProposalPayload;
  integrity: {
    proposal_sha256: string;
  };
  state: GitCheckpointStageProposalState;
};

export type GitCheckpointStageReview = {
  operation: "stage-selected-paths";
  repository_root: string;
  base_branch: string;
  current_branch: string;
  head_sha: string;
  selected_changes: FileChange[];
  unselected_changes: FileChange[];
  staging_pathspecs: string[];
  policy_resolution_sha256: string;
  project_policy_present: boolean;
  path_snapshots: GitCheckpointPathSnapshot[];
  snapshot_sha256: string;
};

export class GitCheckpointStageProposalError extends Error {
  readonly code:
    | "STAGE_PREFLIGHT_FAILED"
    | "STAGE_NOT_ELIGIBLE"
    | "INVALID_STAGE_PREFLIGHT"
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

  constructor(code: GitCheckpointStageProposalError["code"], message: string) {
    super(message);
    this.name = "GitCheckpointStageProposalError";
    this.code = code;
  }
}

function sameValue(first: unknown, second: unknown): boolean {
  return canonicalJson(first) === canonicalJson(second);
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values)];
}

function stagingPathspecs(changes: FileChange[]): string[] {
  const pathspecs: string[] = [];

  for (const change of changes) {
    if (change.original_path) {
      pathspecs.push(change.original_path);
    }

    pathspecs.push(change.path);
  }

  return uniqueValues(pathspecs);
}

export function gitCheckpointStageProposalIntegrity(
  proposal: GitCheckpointStageProposalPayload,
): string {
  return sha256(
    canonicalJson({
      schema_version: 1,
      proposal,
    }),
  );
}

export function gitCheckpointStageProposalRoot(): string {
  return join(mentorStateRoot(), "git-checkpoint-stage-proposals");
}

function validateRecordForPersistence(
  record: GitCheckpointStageProposalRecord,
): void {
  if (
    record.schema_version !== 1 ||
    record.state.status !== "pending" ||
    record.state.applied_at !== null ||
    !/^git-checkpoint-stage-[A-Za-z0-9-]+$/.test(record.proposal.id) ||
    record.proposal.project.key !==
      gitProjectKey(record.proposal.project.root) ||
    record.integrity.proposal_sha256 !==
      gitCheckpointStageProposalIntegrity(record.proposal)
  ) {
    throw new GitCheckpointStageProposalError(
      "INVALID_PROPOSAL",
      "Git checkpoint Stage proposal is not safe to persist",
    );
  }
}

export async function persistGitCheckpointStageProposal(
  record: GitCheckpointStageProposalRecord,
  storageRoot = gitCheckpointStageProposalRoot(),
): Promise<string> {
  validateRecordForPersistence(record);

  try {
    return await persistPrivateJsonRecord({
      storage_root: storageRoot,
      project_key: record.proposal.project.key,
      proposal_id: record.proposal.id,
      record,
    });
  } catch (error) {
    if (error instanceof GitLifecycleStorageError) {
      throw new GitCheckpointStageProposalError(
        "PROPOSAL_STORAGE_FAILED",
        `Unable to persist Git checkpoint Stage proposal: ${error.message}`,
      );
    }

    throw error;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function isUniqueStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(isNonEmptyString) &&
    new Set(value).size === value.length
  );
}

function isFileChange(value: unknown): value is FileChange {
  if (!isRecord(value)) {
    return false;
  }

  const expectedKeys =
    value.original_path === undefined
      ? ["path", "index_status", "worktree_status"]
      : ["path", "original_path", "index_status", "worktree_status"];

  return (
    hasExactKeys(value, expectedKeys) &&
    isNonEmptyString(value.path) &&
    (value.original_path === undefined ||
      isNonEmptyString(value.original_path)) &&
    typeof value.index_status === "string" &&
    value.index_status.length === 1 &&
    typeof value.worktree_status === "string" &&
    value.worktree_status.length === 1
  );
}

function isPathSnapshot(value: unknown): value is GitCheckpointPathSnapshot {
  if (!isRecord(value)) {
    return false;
  }

  if (
    !hasExactKeys(value, ["path", "kind", "sha256", "size", "executable"]) ||
    !isNonEmptyString(value.path)
  ) {
    return false;
  }

  if (value.kind === "file") {
    return (
      isSha256(value.sha256) &&
      typeof value.size === "number" &&
      Number.isSafeInteger(value.size) &&
      value.size >= 0 &&
      typeof value.executable === "boolean"
    );
  }

  if (value.kind === "symlink") {
    return (
      isSha256(value.sha256) &&
      typeof value.size === "number" &&
      Number.isSafeInteger(value.size) &&
      value.size >= 0 &&
      value.executable === null
    );
  }

  if (value.kind === "missing") {
    return (
      value.sha256 === null && value.size === null && value.executable === null
    );
  }

  return false;
}

function validateProposalId(proposalId: string): void {
  if (!/^git-checkpoint-stage-[A-Za-z0-9-]+$/.test(proposalId)) {
    throw new GitCheckpointStageProposalError(
      "INVALID_PROPOSAL_ID",
      "Git checkpoint Stage proposal identifier is invalid",
    );
  }
}

function parseGitCheckpointStageProposalRecord(
  value: unknown,
): GitCheckpointStageProposalRecord {
  if (!isRecord(value)) {
    throw new GitCheckpointStageProposalError(
      "INVALID_PROPOSAL",
      "Git checkpoint Stage proposal record must be an object",
    );
  }

  if (value.schema_version !== 1) {
    throw new GitCheckpointStageProposalError(
      "UNSUPPORTED_PROPOSAL_VERSION",
      "Git checkpoint Stage proposal schema version is unsupported",
    );
  }

  const proposal = value.proposal;
  const integrity = value.integrity;
  const state = value.state;

  if (
    !isRecord(proposal) ||
    !isRecord(integrity) ||
    !isRecord(state) ||
    !hasExactKeys(value, [
      "schema_version",
      "proposal",
      "integrity",
      "state",
    ]) ||
    !hasExactKeys(proposal, [
      "id",
      "created_at",
      "project",
      "operation",
      "policy",
      "repository",
    ]) ||
    !hasExactKeys(integrity, ["proposal_sha256"]) ||
    !hasExactKeys(state, ["status", "applied_at"])
  ) {
    throw new GitCheckpointStageProposalError(
      "INVALID_PROPOSAL",
      "Git checkpoint Stage proposal contains unknown or missing fields",
    );
  }

  const project = proposal.project;
  const operation = proposal.operation;
  const policy = proposal.policy;
  const repository = proposal.repository;

  if (
    !isRecord(project) ||
    !isRecord(operation) ||
    !isRecord(policy) ||
    !isRecord(repository) ||
    !hasExactKeys(project, ["key", "root"]) ||
    !hasExactKeys(operation, [
      "kind",
      "base_branch",
      "current_branch",
      "head_sha",
      "selected_paths",
      "staging_pathspecs",
    ]) ||
    !hasExactKeys(policy, [
      "resolution_sha256",
      "sources",
      "effective_policy",
    ]) ||
    !hasExactKeys(repository, ["clean", "conflicts", "changes", "snapshot"])
  ) {
    throw new GitCheckpointStageProposalError(
      "INVALID_PROPOSAL",
      "Git checkpoint Stage proposal payload is incomplete",
    );
  }

  const sources = policy.sources;
  const snapshot = repository.snapshot;

  if (
    !isNonEmptyString(proposal.id) ||
    !isIsoDate(proposal.created_at) ||
    !isNonEmptyString(project.key) ||
    !isNonEmptyString(project.root) ||
    operation.kind !== "stage-selected-paths" ||
    !isNonEmptyString(operation.base_branch) ||
    !isNonEmptyString(operation.current_branch) ||
    !isGitObjectId(operation.head_sha) ||
    !isUniqueStringArray(operation.selected_paths) ||
    !isUniqueStringArray(operation.staging_pathspecs) ||
    !isSha256(policy.resolution_sha256) ||
    !isRecord(sources) ||
    !hasExactKeys(sources, ["global", "project"]) ||
    !isRecord(sources.global) ||
    !hasExactKeys(sources.global, ["path"]) ||
    !isNonEmptyString(sources.global.path) ||
    !isRecord(sources.project) ||
    !hasExactKeys(sources.project, ["present", "path"]) ||
    typeof sources.project.present !== "boolean" ||
    !isNonEmptyString(sources.project.path) ||
    !isRecord(policy.effective_policy) ||
    repository.clean !== false ||
    !Array.isArray(repository.conflicts) ||
    repository.conflicts.length !== 0 ||
    !Array.isArray(repository.changes) ||
    repository.changes.length === 0 ||
    !repository.changes.every(isFileChange) ||
    !isSha256(integrity.proposal_sha256) ||
    !isRecord(snapshot) ||
    !hasExactKeys(snapshot, ["repository_root", "paths", "snapshot_sha256"]) ||
    !isNonEmptyString(snapshot.repository_root) ||
    !Array.isArray(snapshot.paths) ||
    snapshot.paths.length === 0 ||
    !snapshot.paths.every(isPathSnapshot) ||
    !isSha256(snapshot.snapshot_sha256)
  ) {
    throw new GitCheckpointStageProposalError(
      "INVALID_PROPOSAL",
      "Git checkpoint Stage proposal contains invalid values",
    );
  }

  if (state.status !== "pending" && state.status !== "applied") {
    throw new GitCheckpointStageProposalError(
      "INVALID_PROPOSAL",
      "Git checkpoint Stage proposal state is invalid",
    );
  }

  if (
    (state.status === "pending" && state.applied_at !== null) ||
    (state.status === "applied" && !isIsoDate(state.applied_at))
  ) {
    throw new GitCheckpointStageProposalError(
      "INVALID_PROPOSAL",
      "Git checkpoint Stage proposal application state is inconsistent",
    );
  }

  let effectivePolicy: GitPolicy;

  try {
    effectivePolicy = validateEffectiveGitPolicy(policy.effective_policy);
  } catch (error) {
    throw new GitCheckpointStageProposalError(
      "INVALID_PROPOSAL",
      `Git checkpoint Stage proposal contains invalid effective policy: ${errorMessage(error)}`,
    );
  }

  if (
    operation.base_branch !== effectivePolicy.base_branch ||
    operation.current_branch === operation.base_branch ||
    !validateWorkingBranchName(operation.current_branch, effectivePolicy).valid
  ) {
    throw new GitCheckpointStageProposalError(
      "INVALID_PROPOSAL",
      "Git checkpoint Stage proposal contains invalid branch state",
    );
  }

  const changes = repository.changes as FileChange[];
  const changePaths = changes.map((change) => change.path);

  if (new Set(changePaths).size !== changePaths.length) {
    throw new GitCheckpointStageProposalError(
      "INVALID_PROPOSAL",
      "Git checkpoint Stage proposal contains duplicate changed paths",
    );
  }

  const selectedPathSet = new Set(operation.selected_paths as string[]);
  const selectedChanges = changes.filter((change) =>
    selectedPathSet.has(change.path),
  );

  if (
    selectedChanges.length !== selectedPathSet.size ||
    !sameValue(
      operation.selected_paths,
      selectedChanges.map((change) => change.path),
    ) ||
    !sameValue(operation.staging_pathspecs, stagingPathspecs(selectedChanges))
  ) {
    throw new GitCheckpointStageProposalError(
      "INVALID_PROPOSAL",
      "Git checkpoint Stage proposal contains an inconsistent path selection",
    );
  }

  const pathSnapshots = snapshot.paths as GitCheckpointPathSnapshot[];

  if (
    snapshot.repository_root !== project.root ||
    !sameValue(
      pathSnapshots.map((entry) => entry.path),
      operation.staging_pathspecs,
    ) ||
    snapshot.snapshot_sha256 !== sha256(canonicalJson(pathSnapshots))
  ) {
    throw new GitCheckpointStageProposalError(
      "INVALID_PROPOSAL",
      "Git checkpoint Stage proposal contains an inconsistent selected-content snapshot",
    );
  }

  const record = value as unknown as GitCheckpointStageProposalRecord;

  record.proposal.policy.effective_policy = effectivePolicy;

  const expectedPolicyChecksum = policyResolutionChecksum({
    project_root: record.proposal.project.root,
    sources: record.proposal.policy.sources,
    effective_policy: effectivePolicy,
  });

  if (record.proposal.policy.resolution_sha256 !== expectedPolicyChecksum) {
    throw new GitCheckpointStageProposalError(
      "INVALID_PROPOSAL",
      "Git checkpoint Stage proposal policy checksum is inconsistent",
    );
  }

  return record;
}

export async function loadGitCheckpointStageProposal(
  projectRoot: string,
  proposalId: string,
  storageRoot = gitCheckpointStageProposalRoot(),
): Promise<LoadedGitCheckpointStageProposal> {
  validateProposalId(proposalId);

  let canonicalProjectRoot: string;

  try {
    canonicalProjectRoot = await realpath(projectRoot);
  } catch (error) {
    throw new GitCheckpointStageProposalError(
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
    if (error instanceof GitLifecycleStorageError) {
      if (error.code === "RECORD_NOT_FOUND") {
        throw new GitCheckpointStageProposalError(
          "PROPOSAL_NOT_FOUND",
          "Git checkpoint Stage proposal was not found for the current project",
        );
      }

      throw new GitCheckpointStageProposalError(
        "INVALID_PROPOSAL",
        error.message,
      );
    }

    throw error;
  }

  const record = parseGitCheckpointStageProposalRecord(loaded.value);

  if (record.proposal.id !== proposalId) {
    throw new GitCheckpointStageProposalError(
      "INVALID_PROPOSAL",
      "Git checkpoint Stage proposal identifier does not match its storage path",
    );
  }

  if (
    record.proposal.project.root !== canonicalProjectRoot ||
    record.proposal.project.key !== projectKey
  ) {
    throw new GitCheckpointStageProposalError(
      "PROJECT_MISMATCH",
      "Git checkpoint Stage proposal belongs to a different project",
    );
  }

  if (
    record.integrity.proposal_sha256 !==
    gitCheckpointStageProposalIntegrity(record.proposal)
  ) {
    throw new GitCheckpointStageProposalError(
      "PROPOSAL_INTEGRITY_FAILED",
      "Git checkpoint Stage proposal integrity validation failed",
    );
  }

  if (record.state.status === "applied") {
    throw new GitCheckpointStageProposalError(
      "PROPOSAL_ALREADY_APPLIED",
      "Git checkpoint Stage proposal has already been applied",
    );
  }

  return {
    record,
    record_path: loaded.record_path,
  };
}

export function buildGitCheckpointStageProposal(
  preflight: GitCheckpointStagePreflight,
  options: {
    id?: string;
    created_at?: string;
  } = {},
): GitCheckpointStageProposalRecord {
  if (!preflight.ok) {
    throw new GitCheckpointStageProposalError(
      "STAGE_PREFLIGHT_FAILED",
      preflight.error.message,
    );
  }

  if (!preflight.stage_plan.eligible) {
    throw new GitCheckpointStageProposalError(
      "STAGE_NOT_ELIGIBLE",
      "Git checkpoint Stage preflight is not eligible for Preview",
    );
  }

  const {
    state,
    stage_plan: stagePlan,
    policy_resolution: policyResolution,
    snapshot,
  } = preflight;

  if (
    state.branch === null ||
    state.latest_commit === null ||
    state.clean !== false ||
    state.conflicts.length !== 0 ||
    state.changes.length === 0 ||
    stagePlan.selected_changes.length === 0 ||
    stagePlan.repository_root !== state.root ||
    stagePlan.current_branch !== state.branch ||
    stagePlan.head_sha !== state.latest_commit.sha ||
    stagePlan.base_branch !== policyResolution.effective_policy.base_branch ||
    policyResolution.project_root !== state.root ||
    snapshot === null ||
    snapshot.repository_root !== state.root
  ) {
    throw new GitCheckpointStageProposalError(
      "INVALID_STAGE_PREFLIGHT",
      "Eligible Stage preflight is missing required immutable repository state",
    );
  }

  const selectedPathSet = new Set(
    stagePlan.selected_changes.map((change) => change.path),
  );

  const expectedSelected = state.changes.filter((change) =>
    selectedPathSet.has(change.path),
  );
  const expectedUnselected = state.changes.filter(
    (change) => !selectedPathSet.has(change.path),
  );
  const expectedPathspecs = stagingPathspecs(expectedSelected);

  const expectedSnapshotChecksum = sha256(canonicalJson(snapshot.paths));

  if (
    selectedPathSet.size !== stagePlan.selected_changes.length ||
    !sameValue(stagePlan.selected_changes, expectedSelected) ||
    !sameValue(stagePlan.unselected_changes, expectedUnselected) ||
    !sameValue(stagePlan.staging_pathspecs, expectedPathspecs) ||
    !sameValue(
      snapshot.paths.map((entry) => entry.path),
      expectedPathspecs,
    ) ||
    snapshot.snapshot_sha256 !== expectedSnapshotChecksum
  ) {
    throw new GitCheckpointStageProposalError(
      "INVALID_STAGE_PREFLIGHT",
      "Eligible Stage preflight contains an inconsistent staging plan",
    );
  }

  const proposal: GitCheckpointStageProposalPayload = structuredClone({
    id: options.id ?? `git-checkpoint-stage-${randomUUID()}`,
    created_at: options.created_at ?? new Date().toISOString(),
    project: {
      key: gitProjectKey(state.root),
      root: state.root,
    },
    operation: {
      kind: "stage-selected-paths",
      base_branch: stagePlan.base_branch,
      current_branch: state.branch,
      head_sha: state.latest_commit.sha,
      selected_paths: stagePlan.selected_changes.map((change) => change.path),
      staging_pathspecs: stagePlan.staging_pathspecs,
    },
    policy: {
      resolution_sha256: policyResolutionChecksum(policyResolution),
      sources: policyResolution.sources,
      effective_policy: policyResolution.effective_policy,
    },
    repository: {
      clean: false,
      conflicts: [],
      changes: state.changes,
      snapshot,
    },
  });

  return {
    schema_version: 1,
    proposal,
    integrity: {
      proposal_sha256: gitCheckpointStageProposalIntegrity(proposal),
    },
    state: {
      status: "pending",
      applied_at: null,
    },
  };
}

export function buildGitCheckpointStageReview(
  record: GitCheckpointStageProposalRecord,
): GitCheckpointStageReview {
  const proposal = record.proposal;
  const selectedPathSet = new Set(proposal.operation.selected_paths);

  return {
    operation: proposal.operation.kind,
    repository_root: proposal.project.root,
    base_branch: proposal.operation.base_branch,
    current_branch: proposal.operation.current_branch,
    head_sha: proposal.operation.head_sha,
    selected_changes: proposal.repository.changes.filter((change) =>
      selectedPathSet.has(change.path),
    ),
    unselected_changes: proposal.repository.changes.filter(
      (change) => !selectedPathSet.has(change.path),
    ),
    staging_pathspecs: [...proposal.operation.staging_pathspecs],
    policy_resolution_sha256: proposal.policy.resolution_sha256,
    project_policy_present: proposal.policy.sources.project.present,
    path_snapshots: structuredClone(proposal.repository.snapshot.paths),
    snapshot_sha256: proposal.repository.snapshot.snapshot_sha256,
  };
}
