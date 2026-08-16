import { realpath } from "node:fs/promises";
import { join } from "node:path";
import {
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
  GitFinishPublishProposalError,
  gitFinishPublishProposalIntegrity,
  type GitFinishPublishAppliedResult,
  type GitFinishPublishProposalRecord,
} from "./git_finish_publish_proposal";

export type LoadedGitFinishPublishProposal = {
  record: GitFinishPublishProposalRecord;
  record_path: string;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function invalidProposal(message: string): never {
  throw new GitFinishPublishProposalError("INVALID_PROPOSAL", message);
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

function isSafePushUrl(value: unknown): value is string {
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
  if (!/^git-finish-publish-[A-Za-z0-9-]+$/.test(proposalId)) {
    throw new GitFinishPublishProposalError(
      "INVALID_PROPOSAL_ID",
      "Git Finish Publish proposal identifier is invalid",
    );
  }
}

function parseGitFinishPublishProposalRecord(
  value: unknown,
): GitFinishPublishProposalRecord {
  if (!isRecord(value)) {
    invalidProposal("Git Finish Publish proposal record must be an object");
  }

  if (value.schema_version !== 1) {
    throw new GitFinishPublishProposalError(
      "UNSUPPORTED_PROPOSAL_VERSION",
      "Git Finish Publish proposal schema version is unsupported",
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
      "Git Finish Publish proposal contains unknown or missing fields",
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
      "update",
    ]) ||
    !hasExactKeys(integrity, ["proposal_sha256"]) ||
    !hasExactKeys(state, ["status", "applied_at", "result"]) ||
    !isRecord(proposal.project) ||
    !isRecord(proposal.operation) ||
    !isRecord(proposal.policy) ||
    !isRecord(proposal.remote) ||
    !isRecord(proposal.update)
  ) {
    invalidProposal("Git Finish Publish proposal payload is incomplete");
  }

  const project = proposal.project;
  const operation = proposal.operation;
  const policy = proposal.policy;
  const remote = proposal.remote;
  const update = proposal.update;

  if (
    !hasExactKeys(project, ["key", "root"]) ||
    !hasExactKeys(operation, [
      "kind",
      "base_branch",
      "current_branch",
      "local_head_sha",
      "remote",
      "destination_branch",
      "destination_ref",
      "disposition",
      "force_with_lease_expected_sha",
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
    !hasExactKeys(update, [
      "proposal_id",
      "proposal_sha256",
      "applied_at",
      "previous_head_sha",
      "resulting_head_sha",
      "base_commit_sha",
      "rebased",
    ]) ||
    !isRecord(policy.sources) ||
    !isRecord(policy.effective_policy)
  ) {
    invalidProposal("Git Finish Publish proposal payload is incomplete");
  }

  const sources = policy.sources;

  if (
    !hasExactKeys(sources, ["global", "project"]) ||
    !isRecord(sources.global) ||
    !isRecord(sources.project) ||
    !hasExactKeys(sources.global, ["path"]) ||
    !hasExactKeys(sources.project, ["present", "path"])
  ) {
    invalidProposal("Git Finish Publish proposal policy sources are invalid");
  }

  if (
    !isNonEmptyString(proposal.id) ||
    !/^git-finish-publish-[A-Za-z0-9-]+$/.test(proposal.id) ||
    !isIsoDate(proposal.created_at) ||
    !isNonEmptyString(project.key) ||
    !isNonEmptyString(project.root) ||
    operation.kind !== "finish-publish" ||
    !isNonEmptyString(operation.base_branch) ||
    !isNonEmptyString(operation.current_branch) ||
    !isGitObjectId(operation.local_head_sha) ||
    !isSafeRemoteName(operation.remote) ||
    !isNonEmptyString(operation.destination_branch) ||
    !isNonEmptyString(operation.destination_ref) ||
    (operation.disposition !== "create" &&
      operation.disposition !== "up-to-date" &&
      operation.disposition !== "fast-forward" &&
      operation.disposition !== "force-with-lease") ||
    (operation.force_with_lease_expected_sha !== null &&
      !isGitObjectId(operation.force_with_lease_expected_sha)) ||
    !isSha256(policy.resolution_sha256) ||
    !isNonEmptyString(sources.global.path) ||
    typeof sources.project.present !== "boolean" ||
    !isNonEmptyString(sources.project.path) ||
    !isSafePushUrl(remote.push_url) ||
    !isSha256(remote.push_url_sha256) ||
    (remote.expected_commit_sha !== null &&
      !isGitObjectId(remote.expected_commit_sha)) ||
    !isNonEmptyString(update.proposal_id) ||
    !/^git-finish-update-[A-Za-z0-9-]+$/.test(update.proposal_id) ||
    !isSha256(update.proposal_sha256) ||
    !isIsoDate(update.applied_at) ||
    !isGitObjectId(update.previous_head_sha) ||
    !isGitObjectId(update.resulting_head_sha) ||
    !isGitObjectId(update.base_commit_sha) ||
    typeof update.rebased !== "boolean" ||
    !isSha256(integrity.proposal_sha256)
  ) {
    invalidProposal("Git Finish Publish proposal contains invalid values");
  }

  if (
    update.resulting_head_sha !== operation.local_head_sha ||
    update.rebased !== (update.resulting_head_sha !== update.previous_head_sha)
  ) {
    invalidProposal(
      "Git Finish Publish proposal contains inconsistent Update provenance",
    );
  }

  if (state.status !== "pending" && state.status !== "applied") {
    invalidProposal("Git Finish Publish proposal state is invalid");
  }

  if (
    state.status === "pending" &&
    (state.applied_at !== null || state.result !== null)
  ) {
    invalidProposal(
      "Pending Git Finish Publish proposal state is inconsistent",
    );
  }

  if (state.status === "applied") {
    if (
      !isIsoDate(state.applied_at) ||
      !isRecord(state.result) ||
      !hasExactKeys(state.result, [
        "published_commit_sha",
        "remote_commit_sha",
        "remote_updated",
      ]) ||
      !isGitObjectId(state.result.published_commit_sha) ||
      !isGitObjectId(state.result.remote_commit_sha) ||
      typeof state.result.remote_updated !== "boolean"
    ) {
      invalidProposal("Applied Git Finish Publish proposal result is invalid");
    }

    const result = state.result as unknown as GitFinishPublishAppliedResult;

    if (
      result.published_commit_sha !== operation.local_head_sha ||
      result.remote_commit_sha !== operation.local_head_sha ||
      result.remote_updated !== (operation.disposition !== "up-to-date")
    ) {
      invalidProposal(
        "Applied Git Finish Publish proposal result is inconsistent",
      );
    }
  }

  let effectivePolicy: GitPolicy;

  try {
    effectivePolicy = validateEffectiveGitPolicy(policy.effective_policy);
  } catch (error) {
    invalidProposal(
      `Git Finish Publish proposal contains invalid effective policy: ${errorMessage(error)}`,
    );
  }

  if (
    project.key !== gitProjectKey(project.root) ||
    operation.base_branch !== effectivePolicy.base_branch ||
    operation.current_branch === operation.base_branch ||
    !validateWorkingBranchName(operation.current_branch, effectivePolicy)
      .valid ||
    operation.destination_branch !== operation.current_branch ||
    operation.destination_ref !== `refs/heads/${operation.current_branch}` ||
    remote.push_url_sha256 !== sha256(remote.push_url)
  ) {
    invalidProposal(
      "Git Finish Publish proposal contains inconsistent operation state",
    );
  }

  switch (operation.disposition) {
    case "create":
      if (
        remote.expected_commit_sha !== null ||
        operation.force_with_lease_expected_sha !== null
      ) {
        invalidProposal("Git Finish Publish creation state is inconsistent");
      }
      break;

    case "up-to-date":
      if (
        remote.expected_commit_sha !== operation.local_head_sha ||
        operation.force_with_lease_expected_sha !== null
      ) {
        invalidProposal("Up-to-date Git Finish Publish state is inconsistent");
      }
      break;

    case "fast-forward":
      if (
        remote.expected_commit_sha === null ||
        remote.expected_commit_sha === operation.local_head_sha ||
        operation.force_with_lease_expected_sha !== null
      ) {
        invalidProposal(
          "Fast-forward Git Finish Publish state is inconsistent",
        );
      }
      break;

    case "force-with-lease":
      if (
        !update.rebased ||
        remote.expected_commit_sha !== update.previous_head_sha ||
        operation.force_with_lease_expected_sha !== update.previous_head_sha ||
        effectivePolicy.branch_update.force_push !== "force-with-lease"
      ) {
        invalidProposal(
          "Force-with-lease Git Finish Publish state is inconsistent",
        );
      }
      break;
  }

  const record = value as unknown as GitFinishPublishProposalRecord;

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
      "Git Finish Publish proposal policy checksum is inconsistent",
    );
  }

  return record;
}

export function gitFinishPublishProposalRoot(): string {
  return join(mentorStateRoot(), "git-finish-publish-proposals");
}

export async function persistGitFinishPublishProposal(
  record: GitFinishPublishProposalRecord,
  storageRoot = gitFinishPublishProposalRoot(),
): Promise<string> {
  const validated = parseGitFinishPublishProposalRecord(
    structuredClone(record),
  );

  if (
    validated.state.status !== "pending" ||
    validated.integrity.proposal_sha256 !==
      gitFinishPublishProposalIntegrity(validated.proposal)
  ) {
    throw new GitFinishPublishProposalError(
      "INVALID_PROPOSAL",
      "Git Finish Publish proposal is not safe to persist",
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
      throw new GitFinishPublishProposalError(
        "PROPOSAL_STORAGE_FAILED",
        `Unable to persist Git Finish Publish proposal: ${error.message}`,
      );
    }

    throw error;
  }
}

async function loadGitFinishPublishProposalRecord(
  projectRoot: string,
  proposalId: string,
  storageRoot = gitFinishPublishProposalRoot(),
): Promise<LoadedGitFinishPublishProposal> {
  validateProposalId(proposalId);

  let canonicalProjectRoot: string;

  try {
    canonicalProjectRoot = await realpath(projectRoot);
  } catch (error) {
    throw new GitFinishPublishProposalError(
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
      throw new GitFinishPublishProposalError(
        "PROPOSAL_NOT_FOUND",
        "Git Finish Publish proposal was not found for the current project",
      );
    }

    if (error instanceof GitLifecycleStorageError) {
      throw new GitFinishPublishProposalError(
        "INVALID_PROPOSAL",
        error.message,
      );
    }

    throw error;
  }

  const record = parseGitFinishPublishProposalRecord(loaded.value);

  if (record.proposal.id !== proposalId) {
    throw new GitFinishPublishProposalError(
      "INVALID_PROPOSAL",
      "Git Finish Publish proposal identifier does not match its storage path",
    );
  }

  if (
    record.proposal.project.root !== canonicalProjectRoot ||
    record.proposal.project.key !== projectKey
  ) {
    throw new GitFinishPublishProposalError(
      "PROJECT_MISMATCH",
      "Git Finish Publish proposal belongs to a different project",
    );
  }

  if (
    record.integrity.proposal_sha256 !==
    gitFinishPublishProposalIntegrity(record.proposal)
  ) {
    throw new GitFinishPublishProposalError(
      "PROPOSAL_INTEGRITY_FAILED",
      "Git Finish Publish proposal integrity validation failed",
    );
  }

  return {
    record,
    record_path: loaded.record_path,
  };
}

export async function loadGitFinishPublishProposal(
  projectRoot: string,
  proposalId: string,
  storageRoot = gitFinishPublishProposalRoot(),
): Promise<LoadedGitFinishPublishProposal> {
  const loaded = await loadGitFinishPublishProposalRecord(
    projectRoot,
    proposalId,
    storageRoot,
  );

  if (loaded.record.state.status === "applied") {
    throw new GitFinishPublishProposalError(
      "PROPOSAL_ALREADY_APPLIED",
      "Git Finish Publish proposal has already been applied",
    );
  }

  return loaded;
}

export async function loadGitFinishPublishAppliedProposal(
  projectRoot: string,
  proposalId: string,
  storageRoot = gitFinishPublishProposalRoot(),
): Promise<LoadedGitFinishPublishProposal> {
  const loaded = await loadGitFinishPublishProposalRecord(
    projectRoot,
    proposalId,
    storageRoot,
  );

  if (loaded.record.state.status !== "applied") {
    throw new GitFinishPublishProposalError(
      "PROPOSAL_NOT_APPLIED",
      "Git Finish Publish proposal has not been applied",
    );
  }

  return loaded;
}
