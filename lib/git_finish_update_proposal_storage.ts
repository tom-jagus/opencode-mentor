import { realpath } from "node:fs/promises";
import { join } from "node:path";
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
import { validateEffectiveGitPolicy, type GitPolicy } from "./git_policy";
import { validateWorkingBranchName } from "./git_validation";
import {
  GitFinishUpdateProposalError,
  gitFinishUpdateProposalIntegrity,
  type GitFinishUpdateProposalRecord,
} from "./git_finish_update_proposal";

export type LoadedGitFinishUpdateProposal = {
  record: GitFinishUpdateProposalRecord;
  record_path: string;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function invalidProposal(message: string): never {
  throw new GitFinishUpdateProposalError("INVALID_PROPOSAL", message);
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

function isSafeRemoteName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.startsWith("-") &&
    !value.includes("\0") &&
    !value.includes("\n") &&
    !value.includes("\r") &&
    !value.includes("..") &&
    !value.includes("@{") &&
    !value.includes("\\") &&
    !value.includes("//") &&
    !value.endsWith("/") &&
    !value.endsWith(".lock") &&
    /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value)
  );
}

function isSafeFetchUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.startsWith("-") &&
    !value.includes("\0") &&
    !value.includes("\n") &&
    !value.includes("\r")
  );
}

function validateProposalId(proposalId: string): void {
  if (!/^git-finish-update-[A-Za-z0-9-]+$/.test(proposalId)) {
    throw new GitFinishUpdateProposalError(
      "INVALID_PROPOSAL_ID",
      "Git Finish Update proposal identifier is invalid",
    );
  }
}

function parseGitFinishUpdateProposalRecord(
  value: unknown,
): GitFinishUpdateProposalRecord {
  if (!isRecord(value)) {
    invalidProposal("Git Finish Update proposal record must be an object");
  }

  if (value.schema_version !== 1) {
    throw new GitFinishUpdateProposalError(
      "UNSUPPORTED_PROPOSAL_VERSION",
      "Git Finish Update proposal schema version is unsupported",
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
      "Git Finish Update proposal contains unknown or missing fields",
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
    invalidProposal("Git Finish Update proposal payload is incomplete");
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
      "local_head_sha",
      "remote",
      "action",
    ]) ||
    !hasExactKeys(policy, [
      "resolution_sha256",
      "sources",
      "effective_policy",
    ]) ||
    !hasExactKeys(remote, [
      "fetch_url",
      "fetch_url_sha256",
      "base_ref",
      "base_commit_sha",
    ]) ||
    !isRecord(policy.sources) ||
    !isRecord(policy.effective_policy)
  ) {
    invalidProposal("Git Finish Update proposal payload is incomplete");
  }

  const sources = policy.sources;

  if (
    !hasExactKeys(sources, ["global", "project"]) ||
    !isRecord(sources.global) ||
    !isRecord(sources.project) ||
    !hasExactKeys(sources.global, ["path"]) ||
    !hasExactKeys(sources.project, ["present", "path"])
  ) {
    invalidProposal("Git Finish Update proposal policy sources are invalid");
  }

  if (
    !isNonEmptyString(proposal.id) ||
    !/^git-finish-update-[A-Za-z0-9-]+$/.test(proposal.id) ||
    !isIsoDate(proposal.created_at) ||
    !isNonEmptyString(project.key) ||
    !isNonEmptyString(project.root) ||
    operation.kind !== "finish-update" ||
    !isNonEmptyString(operation.base_branch) ||
    !isNonEmptyString(operation.current_branch) ||
    !isGitObjectId(operation.local_head_sha) ||
    !isSafeRemoteName(operation.remote) ||
    (operation.action !== "fetch-and-rebase" &&
      operation.action !== "not-required") ||
    !isSha256(policy.resolution_sha256) ||
    !isNonEmptyString(sources.global.path) ||
    typeof sources.project.present !== "boolean" ||
    !isNonEmptyString(sources.project.path) ||
    !isSafeFetchUrl(remote.fetch_url) ||
    !isSha256(remote.fetch_url_sha256) ||
    !isNonEmptyString(remote.base_ref) ||
    !isGitObjectId(remote.base_commit_sha) ||
    !isSha256(integrity.proposal_sha256)
  ) {
    invalidProposal("Git Finish Update proposal contains invalid values");
  }

  if (state.status !== "pending" && state.status !== "applied") {
    invalidProposal("Git Finish Update proposal state is invalid");
  }

  if (
    (state.status === "pending" && state.applied_at !== null) ||
    (state.status === "applied" && !isIsoDate(state.applied_at))
  ) {
    invalidProposal(
      "Git Finish Update proposal application state is inconsistent",
    );
  }

  let effectivePolicy: GitPolicy;

  try {
    effectivePolicy = validateEffectiveGitPolicy(policy.effective_policy);
  } catch (error) {
    invalidProposal(
      `Git Finish Update proposal contains invalid effective policy: ${errorMessage(error)}`,
    );
  }

  const expectedAction = effectivePolicy.branch_update
    .require_before_finalization
    ? "fetch-and-rebase"
    : "not-required";

  if (
    project.key !== gitProjectKey(project.root) ||
    operation.base_branch !== effectivePolicy.base_branch ||
    operation.current_branch === operation.base_branch ||
    !validateWorkingBranchName(operation.current_branch, effectivePolicy)
      .valid ||
    operation.action !== expectedAction ||
    remote.base_ref !== `refs/heads/${operation.base_branch}` ||
    remote.fetch_url_sha256 !== sha256(remote.fetch_url)
  ) {
    invalidProposal(
      "Git Finish Update proposal contains inconsistent operation state",
    );
  }

  const record = value as unknown as GitFinishUpdateProposalRecord;

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
      "Git Finish Update proposal policy checksum is inconsistent",
    );
  }

  return record;
}

export function gitFinishUpdateProposalRoot(): string {
  return join(mentorStateRoot(), "git-finish-update-proposals");
}

export async function persistGitFinishUpdateProposal(
  record: GitFinishUpdateProposalRecord,
  storageRoot = gitFinishUpdateProposalRoot(),
): Promise<string> {
  const validated = parseGitFinishUpdateProposalRecord(structuredClone(record));

  if (
    validated.state.status !== "pending" ||
    validated.integrity.proposal_sha256 !==
      gitFinishUpdateProposalIntegrity(validated.proposal)
  ) {
    throw new GitFinishUpdateProposalError(
      "INVALID_PROPOSAL",
      "Git Finish Update proposal is not safe to persist",
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
      throw new GitFinishUpdateProposalError(
        "PROPOSAL_STORAGE_FAILED",
        `Unable to persist Git Finish Update proposal: ${error.message}`,
      );
    }

    throw error;
  }
}

export async function loadGitFinishUpdateProposal(
  projectRoot: string,
  proposalId: string,
  storageRoot = gitFinishUpdateProposalRoot(),
): Promise<LoadedGitFinishUpdateProposal> {
  validateProposalId(proposalId);

  let canonicalProjectRoot: string;

  try {
    canonicalProjectRoot = await realpath(projectRoot);
  } catch (error) {
    throw new GitFinishUpdateProposalError(
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
      throw new GitFinishUpdateProposalError(
        "PROPOSAL_NOT_FOUND",
        "Git Finish Update proposal was not found for the current project",
      );
    }

    if (error instanceof GitLifecycleStorageError) {
      throw new GitFinishUpdateProposalError("INVALID_PROPOSAL", error.message);
    }

    throw error;
  }

  const record = parseGitFinishUpdateProposalRecord(loaded.value);

  if (record.proposal.id !== proposalId) {
    throw new GitFinishUpdateProposalError(
      "INVALID_PROPOSAL",
      "Git Finish Update proposal identifier does not match its storage path",
    );
  }

  if (
    record.proposal.project.root !== canonicalProjectRoot ||
    record.proposal.project.key !== projectKey
  ) {
    throw new GitFinishUpdateProposalError(
      "PROJECT_MISMATCH",
      "Git Finish Update proposal belongs to a different project",
    );
  }

  if (
    record.integrity.proposal_sha256 !==
    gitFinishUpdateProposalIntegrity(record.proposal)
  ) {
    throw new GitFinishUpdateProposalError(
      "PROPOSAL_INTEGRITY_FAILED",
      "Git Finish Update proposal integrity validation failed",
    );
  }

  if (record.state.status === "applied") {
    throw new GitFinishUpdateProposalError(
      "PROPOSAL_ALREADY_APPLIED",
      "Git Finish Update proposal has already been applied",
    );
  }

  return {
    record,
    record_path: loaded.record_path,
  };
}
