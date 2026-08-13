import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, sep } from "node:path";
import type { EffectiveGitPolicyResolution, GitPolicy } from "./git_policy";
import type { GitStartPreflight } from "./git_start";
import { validateEffectiveGitPolicy } from "./git_policy";

export type GitStartProposalState =
  | {
      status: "pending";
      applied_at: null;
    }
  | {
      status: "applied";
      applied_at: string;
    };

export type GitStartProposalPayload = {
  id: string;
  created_at: string;
  project: {
    key: string;
    root: string;
  };
  operation: {
    kind: "create-and-switch-local-branch";
    base_branch: string;
    target_branch: string;
    head_sha: string;
  };
  policy: {
    resolution_sha256: string;
    sources: EffectiveGitPolicyResolution["sources"];
    effective_policy: GitPolicy;
  };
  repository: {
    clean: true;
    conflicts: [];
  };
};

export type GitStartProposalRecord = {
  schema_version: 1;
  proposal: GitStartProposalPayload;
  integrity: {
    proposal_sha256: string;
  };
  state: GitStartProposalState;
};

export type LoadedGitStartProposal = {
  record: GitStartProposalRecord;
  record_path: string;
};

export type GitStartReview = {
  operation: "create-and-switch-local-branch";
  repository_root: string;
  current_branch: string;
  base_branch: string;
  target_branch: string;
  head_sha: string;
  working_tree: "clean";
  policy_resolution_sha256: string;
  project_policy_present: boolean;
};

export type GitStartPreviewSuccess = {
  version: 1;
  ok: true;
  proposal_id: string;
  project_root: string;
  review: GitStartReview;
};

export type GitStartPreviewFailure = {
  version: 1;
  ok: false;
  error: {
    code:
      | "START_PREFLIGHT_FAILED"
      | "START_NOT_ELIGIBLE"
      | "PROPOSAL_STORAGE_FAILED";
    message: string;
  };
  issues?: {
    code: string;
    message: string;
  }[];
};

export type GitStartPreviewResult =
  GitStartPreviewSuccess | GitStartPreviewFailure;

export class GitStartProposalError extends Error {
  readonly code:
    | "START_PREFLIGHT_FAILED"
    | "START_NOT_ELIGIBLE"
    | "PROPOSAL_STORAGE_FAILED"
    | "INVALID_PROPOSAL_ID"
    | "PROPOSAL_NOT_FOUND"
    | "INVALID_PROPOSAL"
    | "UNSUPPORTED_PROPOSAL_VERSION"
    | "PROPOSAL_INTEGRITY_FAILED"
    | "PROJECT_MISMATCH"
    | "PROPOSAL_ALREADY_APPLIED"
    | "STALE_PROPOSAL";

  constructor(code: GitStartProposalError["code"], message: string) {
    super(message);
    this.name = "GitStartProposalError";
    this.code = code;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Canonical JSON cannot contain non-finite numbers");
    }

    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;

    const entries = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);

    return `{${entries.join(",")}}`;
  }

  throw new Error(`Unsupported canonical JSON value: ${typeof value}`);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function gitStartProjectKey(projectRoot: string): string {
  const rawName = basename(projectRoot) || "project";

  const safeName =
    rawName.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") ||
    "project";

  const pathHash = sha256(projectRoot).slice(0, 12);

  return `${safeName}-${pathHash}`;
}

export function policyResolutionChecksum(
  resolution: EffectiveGitPolicyResolution,
): string {
  return sha256(
    canonicalJson({
      sources: resolution.sources,
      effective_policy: resolution.effective_policy,
    }),
  );
}

export function gitStartProposalIntegrity(
  proposal: GitStartProposalPayload,
): string {
  return sha256(
    canonicalJson({
      schema_version: 1,
      proposal,
    }),
  );
}

export function buildGitStartProposal(
  preflight: GitStartPreflight,
  options: {
    id?: string;
    created_at?: string;
  } = {},
): GitStartProposalRecord {
  if (!preflight.ok) {
    throw new GitStartProposalError(
      "START_PREFLIGHT_FAILED",
      preflight.error.message,
    );
  }

  if (!preflight.eligibility.eligible) {
    throw new GitStartProposalError(
      "START_NOT_ELIGIBLE",
      "Git start preflight is not eligible for Preview",
    );
  }

  const { state, eligibility, policy_resolution } = preflight;

  if (
    state.branch === null ||
    state.latest_commit === null ||
    state.clean !== true ||
    state.conflicts.length !== 0 ||
    eligibility.repository_root === null ||
    eligibility.head_sha === null ||
    policy_resolution.project_root !== state.root ||
    eligibility.repository_root !== state.root ||
    eligibility.current_branch !== state.branch ||
    eligibility.head_sha !== state.latest_commit.sha ||
    eligibility.base_branch !==
      policy_resolution.effective_policy.base_branch ||
    preflight.target_branch_exists
  ) {
    throw new GitStartProposalError(
      "START_NOT_ELIGIBLE",
      "Eligible preflight is missing required immutable repository state",
    );
  }

  const proposal: GitStartProposalPayload = {
    id: options.id ?? `git-start-${randomUUID()}`,
    created_at: options.created_at ?? new Date().toISOString(),
    project: {
      key: gitStartProjectKey(state.root),
      root: state.root,
    },
    operation: {
      kind: "create-and-switch-local-branch",
      base_branch: eligibility.base_branch,
      target_branch: eligibility.target_branch,
      head_sha: state.latest_commit.sha,
    },
    policy: {
      resolution_sha256: policyResolutionChecksum(policy_resolution),
      sources: policy_resolution.sources,
      effective_policy: policy_resolution.effective_policy,
    },
    repository: {
      clean: true,
      conflicts: [],
    },
  };

  return {
    schema_version: 1,
    proposal,
    integrity: {
      proposal_sha256: gitStartProposalIntegrity(proposal),
    },
    state: {
      status: "pending",
      applied_at: null,
    },
  };
}

export function buildGitStartReview(
  record: GitStartProposalRecord,
): GitStartReview {
  const proposal = record.proposal;

  return {
    operation: proposal.operation.kind,
    repository_root: proposal.project.root,
    current_branch: proposal.operation.base_branch,
    base_branch: proposal.operation.base_branch,
    target_branch: proposal.operation.target_branch,
    head_sha: proposal.operation.head_sha,
    working_tree: "clean",
    policy_resolution_sha256: proposal.policy.resolution_sha256,
    project_policy_present: proposal.policy.sources.project.present,
  };
}

function mentorStateRoot(): string {
  const configured = Bun.env.XDG_STATE_HOME;

  const stateHome =
    configured && isAbsolute(configured)
      ? configured
      : join(homedir(), ".local", "state");

  return join(stateHome, "opencode-mentor");
}

export function gitStartProposalRoot(): string {
  return join(mentorStateRoot(), "git-start-proposals");
}

async function ensureSafeDirectory(
  directory: string,
  storageRoot: string,
): Promise<void> {
  const relativePath = relative(storageRoot, directory);

  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new GitStartProposalError(
      "PROPOSAL_STORAGE_FAILED",
      "Git start proposal path escapes its state root",
    );
  }

  await mkdir(storageRoot, {
    recursive: true,
    mode: 0o700,
  });

  const rootStat = await lstat(storageRoot);

  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new GitStartProposalError(
      "PROPOSAL_STORAGE_FAILED",
      "Git start proposal state root is not a safe directory",
    );
  }

  if (relativePath === "") {
    return;
  }

  let current = storageRoot;

  for (const segment of relativePath.split(sep)) {
    current = join(current, segment);

    try {
      await mkdir(current, {
        mode: 0o700,
      });
    } catch (error) {
      if (!isNodeError(error, "EEXIST")) {
        throw error;
      }
    }

    const status = await lstat(current);

    if (status.isSymbolicLink() || !status.isDirectory()) {
      throw new GitStartProposalError(
        "PROPOSAL_STORAGE_FAILED",
        "Git start proposal path contains an unsafe component",
      );
    }
  }
}

export async function persistGitStartProposal(
  record: GitStartProposalRecord,
  storageRoot = gitStartProposalRoot(),
): Promise<void> {
  const projectDirectory = join(storageRoot, record.proposal.project.key);

  const finalPath = join(projectDirectory, `${record.proposal.id}.json`);

  const temporaryPath = join(
    projectDirectory,
    `.${record.proposal.id}.${randomUUID()}.tmp`,
  );

  const serialized = `${JSON.stringify(record, null, 2)}\n`;

  try {
    await ensureSafeDirectory(projectDirectory, storageRoot);

    await writeFile(temporaryPath, serialized, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });

    try {
      const existing = await lstat(finalPath);

      if (existing.isSymbolicLink() || !existing.isFile()) {
        throw new GitStartProposalError(
          "PROPOSAL_STORAGE_FAILED",
          "Git start proposal destination is unsafe",
        );
      }

      throw new GitStartProposalError(
        "PROPOSAL_STORAGE_FAILED",
        "Git start proposal already exists",
      );
    } catch (error) {
      if (
        error instanceof GitStartProposalError ||
        !isNodeError(error, "ENOENT")
      ) {
        throw error;
      }
    }

    await rename(temporaryPath, finalPath);
  } catch (error) {
    try {
      await unlink(temporaryPath);
    } catch {
      // Best-effort cleanup only.
    }

    if (error instanceof GitStartProposalError) {
      throw error;
    }

    throw new GitStartProposalError(
      "PROPOSAL_STORAGE_FAILED",
      `Unable to persist Git start proposal: ${errorMessage(error)}`,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function validateProposalId(proposalId: string): void {
  if (!/^git-start-[A-Za-z0-9-]+$/.test(proposalId)) {
    throw new GitStartProposalError(
      "INVALID_PROPOSAL_ID",
      "Git start proposal identifier is invalid",
    );
  }
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();

  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isGitObjectId(value: unknown): value is string {
  return (
    typeof value === "string" && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value)
  );
}

function isIsoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !Number.isNaN(Date.parse(value))
  );
}

function parseGitStartProposalRecord(value: unknown): GitStartProposalRecord {
  if (!isRecord(value)) {
    throw new GitStartProposalError(
      "INVALID_PROPOSAL",
      "Git start proposal record must be an object",
    );
  }

  if (value.schema_version !== 1) {
    throw new GitStartProposalError(
      "UNSUPPORTED_PROPOSAL_VERSION",
      "Git start proposal schema version is unsupported",
    );
  }

  const proposal = value.proposal;
  const integrity = value.integrity;
  const state = value.state;

  if (!isRecord(proposal) || !isRecord(integrity) || !isRecord(state)) {
    throw new GitStartProposalError(
      "INVALID_PROPOSAL",
      "Git start proposal record is incomplete",
    );
  }

  if (
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
    throw new GitStartProposalError(
      "INVALID_PROPOSAL",
      "Git start proposal contains unknown or missing record fields",
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
    !isRecord(repository)
  ) {
    throw new GitStartProposalError(
      "INVALID_PROPOSAL",
      "Git start proposal payload is incomplete",
    );
  }

  if (
    !hasExactKeys(project, ["key", "root"]) ||
    !hasExactKeys(operation, [
      "kind",
      "base_branch",
      "target_branch",
      "head_sha",
    ]) ||
    !hasExactKeys(policy, [
      "resolution_sha256",
      "sources",
      "effective_policy",
    ]) ||
    !hasExactKeys(repository, ["clean", "conflicts"])
  ) {
    throw new GitStartProposalError(
      "INVALID_PROPOSAL",
      "Git start proposal payload contains unknown or missing fields",
    );
  }

  if (
    !isNonEmptyString(proposal.id) ||
    !isIsoDate(proposal.created_at) ||
    !isNonEmptyString(project.key) ||
    !isNonEmptyString(project.root) ||
    operation.kind !== "create-and-switch-local-branch" ||
    !isNonEmptyString(operation.base_branch) ||
    !isNonEmptyString(operation.target_branch) ||
    !isGitObjectId(operation.head_sha) ||
    !isSha256(policy.resolution_sha256) ||
    !isRecord(policy.sources) ||
    !isRecord(policy.effective_policy) ||
    repository.clean !== true ||
    !Array.isArray(repository.conflicts) ||
    repository.conflicts.length !== 0 ||
    !isSha256(integrity.proposal_sha256)
  ) {
    throw new GitStartProposalError(
      "INVALID_PROPOSAL",
      "Git start proposal contains invalid values",
    );
  }

  if (state.status !== "pending" && state.status !== "applied") {
    throw new GitStartProposalError(
      "INVALID_PROPOSAL",
      "Git start proposal state is invalid",
    );
  }

  if (
    (state.status === "pending" && state.applied_at !== null) ||
    (state.status === "applied" && !isNonEmptyString(state.applied_at))
  ) {
    throw new GitStartProposalError(
      "INVALID_PROPOSAL",
      "Git start proposal application state is inconsistent",
    );
  }

  const sources = policy.sources;

  if (
    !isRecord(sources) ||
    !hasExactKeys(sources, ["global", "project"]) ||
    !isRecord(sources.global) ||
    !hasExactKeys(sources.global, ["path"]) ||
    !isNonEmptyString(sources.global.path) ||
    !isRecord(sources.project) ||
    !hasExactKeys(sources.project, ["present", "path"]) ||
    typeof sources.project.present !== "boolean" ||
    !isNonEmptyString(sources.project.path)
  ) {
    throw new GitStartProposalError(
      "INVALID_PROPOSAL",
      "Git start proposal contains invalid policy source information",
    );
  }

  let effectivePolicy: GitPolicy;

  try {
    effectivePolicy = validateEffectiveGitPolicy(policy.effective_policy);
  } catch (error) {
    throw new GitStartProposalError(
      "INVALID_PROPOSAL",
      `Git start proposal contains invalid effective policy: ${errorMessage(error)}`,
    );
  }

  const record = value as unknown as GitStartProposalRecord;

  record.proposal.policy.effective_policy = effectivePolicy;

  const expectedResolutionChecksum = policyResolutionChecksum({
    project_root: record.proposal.project.root,
    sources: record.proposal.policy.sources,
    effective_policy: effectivePolicy,
  });

  if (record.proposal.policy.resolution_sha256 !== expectedResolutionChecksum) {
    throw new GitStartProposalError(
      "INVALID_PROPOSAL",
      "Git start proposal policy checksum is inconsistent",
    );
  }

  return record;
}

export function gitStartPreviewFailure(error: unknown): GitStartPreviewFailure {
  if (error instanceof GitStartProposalError) {
    return {
      version: 1,
      ok: false,
      error: {
        code: error.code,
        message: error.message,
      },
    };
  }

  return {
    version: 1,
    ok: false,
    error: {
      code: "PROPOSAL_STORAGE_FAILED",
      message: errorMessage(error),
    },
  };
}

export async function loadGitStartProposal(
  projectRoot: string,
  proposalId: string,
  storageRoot = gitStartProposalRoot(),
): Promise<LoadedGitStartProposal> {
  validateProposalId(proposalId);

  let canonicalProjectRoot: string;

  try {
    canonicalProjectRoot = await realpath(projectRoot);
  } catch (error) {
    throw new GitStartProposalError(
      "PROJECT_MISMATCH",
      `Could not resolve current project: ${errorMessage(error)}`,
    );
  }

  const projectKey = gitStartProjectKey(canonicalProjectRoot);
  const projectDirectory = join(storageRoot, projectKey);
  const recordPath = join(projectDirectory, `${proposalId}.json`);

  let rootStatus;
  let projectStatus;
  let recordStatus;

  try {
    [rootStatus, projectStatus, recordStatus] = await Promise.all([
      lstat(storageRoot),
      lstat(projectDirectory),
      lstat(recordPath),
    ]);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      throw new GitStartProposalError(
        "PROPOSAL_NOT_FOUND",
        "Git start proposal was not found for the current project",
      );
    }

    throw new GitStartProposalError(
      "INVALID_PROPOSAL",
      `Could not inspect Git start proposal storage: ${errorMessage(error)}`,
    );
  }

  if (
    rootStatus.isSymbolicLink() ||
    !rootStatus.isDirectory() ||
    projectStatus.isSymbolicLink() ||
    !projectStatus.isDirectory() ||
    recordStatus.isSymbolicLink() ||
    !recordStatus.isFile()
  ) {
    throw new GitStartProposalError(
      "INVALID_PROPOSAL",
      "Git start proposal storage contains an unsafe path component",
    );
  }

  if (recordStatus.size > 1024 * 1024) {
    throw new GitStartProposalError(
      "INVALID_PROPOSAL",
      "Git start proposal record is too large",
    );
  }

  let text: string;

  try {
    const bytes = await readFile(recordPath);

    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new GitStartProposalError(
      "INVALID_PROPOSAL",
      `Could not read Git start proposal: ${errorMessage(error)}`,
    );
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new GitStartProposalError(
      "INVALID_PROPOSAL",
      `Git start proposal is not valid JSON: ${errorMessage(error)}`,
    );
  }

  const record = parseGitStartProposalRecord(parsed);

  if (record.proposal.id !== proposalId) {
    throw new GitStartProposalError(
      "INVALID_PROPOSAL",
      "Git start proposal identifier does not match its storage path",
    );
  }

  if (
    record.proposal.project.root !== canonicalProjectRoot ||
    record.proposal.project.key !== projectKey
  ) {
    throw new GitStartProposalError(
      "PROJECT_MISMATCH",
      "Git start proposal belongs to a different project",
    );
  }

  const expectedIntegrity = gitStartProposalIntegrity(record.proposal);

  if (record.integrity.proposal_sha256 !== expectedIntegrity) {
    throw new GitStartProposalError(
      "PROPOSAL_INTEGRITY_FAILED",
      "Git start proposal integrity validation failed",
    );
  }

  if (record.state.status === "applied") {
    throw new GitStartProposalError(
      "PROPOSAL_ALREADY_APPLIED",
      "Git start proposal has already been applied",
    );
  }

  return {
    record,
    record_path: recordPath,
  };
}
