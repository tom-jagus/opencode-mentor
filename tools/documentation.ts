import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  link,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import { tool } from "@opencode-ai/plugin";

type DocumentationAuthority =
  "docs" | "project-definition" | "milestone" | "decision";

type DocumentationOperation = "create" | "replace" | "delete";

type ProposalSnapshot = {
  sha256: string;
  content: string;
};

type ProposalTarget = {
  path: string;
  operation: DocumentationOperation;
  before: ProposalSnapshot | null;
  after: ProposalSnapshot | null;
};

type ProposalPayload = {
  id: string;
  created_at: string;
  project: {
    key: string;
    root: string;
  };
  authority: DocumentationAuthority;
  targets: ProposalTarget[];
};

type ProposalState =
  | {
      status: "pending";
      applied_at: null;
    }
  | {
      status: "applied";
      applied_at: string;
    };

type ProposalRecord = {
  schema_version: 1;
  proposal: ProposalPayload;
  integrity: {
    proposal_sha256: string;
  };
  state: ProposalState;
};

type PreviewChange = {
  path: string;
  operation: DocumentationOperation;
  content?: string;
};

type ErrorCode =
  | "INVALID_INPUT"
  | "INVALID_AUTHORITY"
  | "INVALID_PATH"
  | "PATH_NOT_ALLOWED"
  | "OPERATION_NOT_ALLOWED"
  | "DUPLICATE_PATH"
  | "TARGET_EXISTS"
  | "TARGET_MISSING"
  | "TARGET_NOT_REGULAR_FILE"
  | "TARGET_NOT_UTF8"
  | "SYMLINK_NOT_ALLOWED"
  | "NO_CHANGE"
  | "PROJECT_RESOLUTION_FAILED"
  | "PROPOSAL_STORAGE_FAILED"
  | "PREVIEW_FAILED"
  | "PROPOSAL_NOT_FOUND"
  | "UNSUPPORTED_PROPOSAL_VERSION"
  | "INVALID_PROPOSAL"
  | "PROPOSAL_ALREADY_APPLIED"
  | "PROPOSAL_INTEGRITY_FAILED"
  | "PROJECT_MISMATCH"
  | "STALE_TARGET"
  | "APPLY_PREPARATION_FAILED"
  | "APPLY_FAILED"
  | "PROPOSAL_STATE_FAILED"
  | "ROLLBACK_FAILED";

type PreparedTarget = {
  target: ProposalTarget;
  absolute_path: string;
  staged_path: string | null;
  backup_path: string | null;
  original_mode: number | null;
};

type AppliedTarget = {
  target: ProposalTarget;
  absolute_path: string;
  original_mode: number | null;
};

type RollbackResult = {
  succeeded: boolean;
  unresolved_paths: string[];
};

type ApplySuccessChange = {
  path: string;
  operation: DocumentationOperation;
  sha256: string | null;
};

class DocumentationError extends Error {
  readonly code: ErrorCode;
  readonly path?: string;
  readonly reason?: string;

  constructor(
    code: ErrorCode,
    message: string,
    path?: string,
    reason?: string,
  ) {
    super(message);
    this.name = "DocumentationError";
    this.code = code;
    this.path = path;
    this.reason = reason;
  }
}

const rootDocumentationPaths = new Set([
  "README.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "CODE_OF_CONDUCT.md",
  "LICENSE",
  "LICENSE.md",
]);

const projectDefinitionPaths = new Set([
  "docs/project/definition.md",
  "docs/project/progress.md",
  "docs/project/decisions.md",
]);

const milestonePath = "docs/project/progress.md";
const decisionPath = "docs/project/decisions.md";

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function sha256Bytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Text(value: string): string {
  return sha256Bytes(Buffer.from(value, "utf8"));
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

function proposalIntegrity(
  schemaVersion: 1,
  proposal: ProposalPayload,
): string {
  return sha256Text(
    canonicalJson({
      schema_version: schemaVersion,
      proposal,
    }),
  );
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

async function resolveProjectRoot(directory: string): Promise<string> {
  try {
    return await realpath(directory);
  } catch (error) {
    throw new DocumentationError(
      "PROJECT_RESOLUTION_FAILED",
      `Unable to resolve canonical project root: ${errorMessage(error)}`,
    );
  }
}

function projectKey(projectRoot: string): string {
  const rawName = basename(projectRoot) || "project";

  const safeName =
    rawName.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") ||
    "project";

  const pathHash = createHash("sha256")
    .update(projectRoot, "utf8")
    .digest("hex")
    .slice(0, 12);

  return `${safeName}-${pathHash}`;
}

function validateRelativePath(value: string): void {
  if (!value) {
    throw new DocumentationError(
      "INVALID_PATH",
      "Documentation path must not be empty.",
      value,
    );
  }

  if (value.includes("\0")) {
    throw new DocumentationError(
      "INVALID_PATH",
      "Documentation path must not contain NUL characters.",
      value,
    );
  }

  if (value.includes("\\")) {
    throw new DocumentationError(
      "INVALID_PATH",
      "Documentation path must use forward slashes.",
      value,
    );
  }

  if (isAbsolute(value)) {
    throw new DocumentationError(
      "INVALID_PATH",
      "Documentation path must be relative to the project root.",
      value,
    );
  }

  const segments = value.split("/");

  if (
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  ) {
    throw new DocumentationError(
      "INVALID_PATH",
      "Documentation path must not contain empty, '.' or '..' segments.",
      value,
    );
  }
}

function isGeneralDocumentationPath(value: string): boolean {
  if (rootDocumentationPaths.has(value)) {
    return true;
  }

  if (!value.startsWith("docs/")) {
    return false;
  }

  if (!value.endsWith(".md")) {
    return false;
  }

  if (value.startsWith("docs/project/")) {
    return false;
  }

  return true;
}

function pathAllowed(authority: DocumentationAuthority, path: string): boolean {
  switch (authority) {
    case "docs":
      return isGeneralDocumentationPath(path);

    case "project-definition":
      return projectDefinitionPaths.has(path);

    case "milestone":
      return path === milestonePath;

    case "decision":
      return path === decisionPath;
  }
}

function operationAllowed(
  authority: DocumentationAuthority,
  operation: DocumentationOperation,
): boolean {
  switch (authority) {
    case "docs":
      return true;

    case "project-definition":
      return operation === "create" || operation === "replace";

    case "milestone":
    case "decision":
      return operation === "replace";
  }
}

function validateAuthorityBoundary(
  authority: DocumentationAuthority,
  change: PreviewChange,
): void {
  if (!pathAllowed(authority, change.path)) {
    throw new DocumentationError(
      "PATH_NOT_ALLOWED",
      `Path is not writable by '${authority}' authority.`,
      change.path,
    );
  }

  if (!operationAllowed(authority, change.operation)) {
    throw new DocumentationError(
      "OPERATION_NOT_ALLOWED",
      `Operation '${change.operation}' is not permitted by '${authority}' authority.`,
      change.path,
    );
  }
}

function validateChangeContent(change: PreviewChange): void {
  if (change.operation === "create" || change.operation === "replace") {
    if (typeof change.content !== "string") {
      throw new DocumentationError(
        "INVALID_INPUT",
        `Operation '${change.operation}' requires complete resulting content.`,
        change.path,
      );
    }

    return;
  }

  if (change.content !== undefined) {
    throw new DocumentationError(
      "INVALID_INPUT",
      "Delete operations must not include content.",
      change.path,
    );
  }
}

function ensureInsideProject(projectRoot: string, targetPath: string): string {
  const absolutePath = resolve(projectRoot, targetPath);
  const relativePath = relative(projectRoot, absolutePath);

  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new DocumentationError(
      "INVALID_PATH",
      "Documentation path escapes the project root.",
      targetPath,
    );
  }

  return absolutePath;
}

async function inspectTargetPath(
  projectRoot: string,
  targetPath: string,
): Promise<{
  absolutePath: string;
  exists: boolean;
  regularFile: boolean;
  mode: number | null;
}> {
  const absolutePath = ensureInsideProject(projectRoot, targetPath);

  const segments = targetPath.split("/");
  let current = projectRoot;

  for (let index = 0; index < segments.length; index += 1) {
    current = join(current, segments[index]!);

    try {
      const stat = await lstat(current);

      if (stat.isSymbolicLink()) {
        throw new DocumentationError(
          "SYMLINK_NOT_ALLOWED",
          "Documentation transaction paths must not contain symbolic links.",
          targetPath,
        );
      }

      const isTarget = index === segments.length - 1;

      if (!isTarget && !stat.isDirectory()) {
        throw new DocumentationError(
          "INVALID_PATH",
          "A documentation path component is not a directory.",
          targetPath,
        );
      }

      if (isTarget) {
        return {
          absolutePath,
          exists: true,
          regularFile: stat.isFile(),
          mode: stat.mode & 0o777,
        };
      }
    } catch (error) {
      if (error instanceof DocumentationError) {
        throw error;
      }

      if (isNodeError(error, "ENOENT")) {
        return {
          absolutePath,
          exists: false,
          regularFile: false,
          mode: null,
        };
      }

      throw error;
    }
  }

  return {
    absolutePath,
    exists: false,
    regularFile: false,
    mode: null,
  };
}

async function readUtf8Snapshot(
  absolutePath: string,
  targetPath: string,
): Promise<ProposalSnapshot> {
  const bytes = await readFile(absolutePath);

  let content: string;

  try {
    content = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
  } catch {
    throw new DocumentationError(
      "TARGET_NOT_UTF8",
      "Existing documentation target is not valid UTF-8.",
      targetPath,
    );
  }

  return {
    sha256: sha256Bytes(bytes),
    content,
  };
}

function afterSnapshot(content: string): ProposalSnapshot {
  return {
    sha256: sha256Text(content),
    content,
  };
}

async function buildTarget(
  projectRoot: string,
  change: PreviewChange,
): Promise<ProposalTarget> {
  const inspected = await inspectTargetPath(projectRoot, change.path);

  switch (change.operation) {
    case "create": {
      if (inspected.exists) {
        throw new DocumentationError(
          "TARGET_EXISTS",
          "Create requested but target already exists.",
          change.path,
        );
      }

      return {
        path: change.path,
        operation: "create",
        before: null,
        after: afterSnapshot(change.content!),
      };
    }
    case "replace": {
      if (!inspected.exists) {
        throw new DocumentationError(
          "TARGET_MISSING",
          "Replace requested but target does not exist.",
          change.path,
        );
      }

      if (!inspected.regularFile) {
        throw new DocumentationError(
          "TARGET_NOT_REGULAR_FILE",
          "Replace target is not a regular file.",
          change.path,
        );
      }

      const before = await readUtf8Snapshot(
        inspected.absolutePath,
        change.path,
      );

      const after = afterSnapshot(change.content!);

      if (before.sha256 === after.sha256) {
        throw new DocumentationError(
          "NO_CHANGE",
          "Replacement content is identical to the current file.",
          change.path,
        );
      }

      return {
        path: change.path,
        operation: "replace",
        before,
        after,
      };
    }

    case "delete": {
      if (!inspected.exists) {
        throw new DocumentationError(
          "TARGET_MISSING",
          "Delete requested but target does not exist.",
          change.path,
        );
      }

      if (!inspected.regularFile) {
        throw new DocumentationError(
          "TARGET_NOT_REGULAR_FILE",
          "Delete target is not a regular file.",
          change.path,
        );
      }

      return {
        path: change.path,
        operation: "delete",
        before: await readUtf8Snapshot(inspected.absolutePath, change.path),
        after: null,
      };
    }
  }
}

function mentorStateRoot(): string {
  const configured = Bun.env.XDG_STATE_HOME;

  const stateHome =
    configured && isAbsolute(configured)
      ? configured
      : join(homedir(), ".local", "state");

  return join(stateHome, "opencode-mentor");
}

function proposalStateRoot(): string {
  return join(mentorStateRoot(), "documentation-proposals");
}

function transactionStateRoot(): string {
  return join(mentorStateRoot(), "documentation-transactions");
}

async function persistProposal(record: ProposalRecord): Promise<void> {
  const projectDirectory = join(
    proposalStateRoot(),
    record.proposal.project.key,
  );

  const finalPath = join(projectDirectory, `${record.proposal.id}.json`);

  const temporaryPath = join(
    projectDirectory,
    `.${record.proposal.id}.${randomUUID()}.tmp`,
  );

  const serialized = `${json(record)}\n`;

  try {
    await mkdir(projectDirectory, {
      recursive: true,
      mode: 0o700,
    });

    await writeFile(temporaryPath, serialized, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });

    await rename(temporaryPath, finalPath);
  } catch (error) {
    try {
      await unlink(temporaryPath);
    } catch {
      // Best-effort cleanup only.
    }

    throw new DocumentationError(
      "PROPOSAL_STORAGE_FAILED",
      `Unable to persist documentation proposal: ${errorMessage(error)}`,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function isProposalId(value: string): boolean {
  return /^doc-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
    value,
  );
}

function isDocumentationAuthority(
  value: unknown,
): value is DocumentationAuthority {
  return (
    value === "docs" ||
    value === "project-definition" ||
    value === "milestone" ||
    value === "decision"
  );
}

function isDocumentationOperation(
  value: unknown,
): value is DocumentationOperation {
  return value === "create" || value === "replace" || value === "delete";
}

function invalidProposal(message: string, path?: string): never {
  throw new DocumentationError("INVALID_PROPOSAL", message, path);
}

function validateStoredSnapshot(
  value: unknown,
  path: string,
): ProposalSnapshot {
  if (
    !isRecord(value) ||
    !isSha256(value.sha256) ||
    typeof value.content !== "string"
  ) {
    invalidProposal("Proposal contains an invalid content snapshot.", path);
  }

  const calculated = sha256Text(value.content);

  if (calculated !== value.sha256) {
    throw new DocumentationError(
      "PROPOSAL_INTEGRITY_FAILED",
      "Stored proposal content does not match its checksum.",
      path,
    );
  }

  return {
    sha256: value.sha256,
    content: value.content,
  };
}

async function loadProposal(
  projectRoot: string,
  key: string,
  proposalId: string,
): Promise<{
  record: ProposalRecord;
  recordPath: string;
}> {
  if (!isProposalId(proposalId)) {
    throw new DocumentationError(
      "INVALID_INPUT",
      "Invalid documentation proposal identifier.",
    );
  }

  const recordPath = join(proposalStateRoot(), key, `${proposalId}.json`);

  let rawText: string;

  try {
    rawText = await readFile(recordPath, "utf8");
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      throw new DocumentationError(
        "PROPOSAL_NOT_FOUND",
        "Documentation proposal was not found for the current project.",
      );
    }

    throw new DocumentationError(
      "INVALID_PROPOSAL",
      `Unable to read documentation proposal: ${errorMessage(error)}`,
    );
  }

  let raw: unknown;

  try {
    raw = JSON.parse(rawText);
  } catch {
    throw new DocumentationError(
      "INVALID_PROPOSAL",
      "Documentation proposal is not valid JSON.",
    );
  }

  if (!isRecord(raw)) {
    invalidProposal("Documentation proposal must be a JSON object.");
  }

  if (raw.schema_version !== 1) {
    if (raw.schema_version !== undefined) {
      throw new DocumentationError(
        "UNSUPPORTED_PROPOSAL_VERSION",
        `Unsupported documentation proposal schema version: ${String(raw.schema_version)}`,
      );
    }

    invalidProposal("Documentation proposal has no schema version.");
  }

  if (
    !isRecord(raw.proposal) ||
    !isRecord(raw.integrity) ||
    !isRecord(raw.state)
  ) {
    invalidProposal("Documentation proposal structure is incomplete.");
  }

  const proposal = raw.proposal;

  if (
    proposal.id !== proposalId ||
    typeof proposal.created_at !== "string" ||
    !isRecord(proposal.project) ||
    !isDocumentationAuthority(proposal.authority) ||
    !Array.isArray(proposal.targets) ||
    proposal.targets.length === 0
  ) {
    invalidProposal(
      "Documentation proposal contains invalid identity or payload fields.",
    );
  }

  if (proposal.project.root !== projectRoot || proposal.project.key !== key) {
    throw new DocumentationError(
      "PROJECT_MISMATCH",
      "Documentation proposal belongs to a different project.",
    );
  }

  if (!isSha256(raw.integrity.proposal_sha256)) {
    invalidProposal("Documentation proposal integrity checksum is invalid.");
  }

  const expectedIntegrity = sha256Text(
    canonicalJson({
      schema_version: 1,
      proposal,
    }),
  );

  if (expectedIntegrity !== raw.integrity.proposal_sha256) {
    throw new DocumentationError(
      "PROPOSAL_INTEGRITY_FAILED",
      "Documentation proposal payload has changed since Preview.",
    );
  }

  if (raw.state.status === "applied") {
    if (typeof raw.state.applied_at !== "string") {
      invalidProposal("Applied proposal has invalid lifecycle state.");
    }

    throw new DocumentationError(
      "PROPOSAL_ALREADY_APPLIED",
      "Documentation proposal has already been applied.",
    );
  }

  if (raw.state.status !== "pending" || raw.state.applied_at !== null) {
    invalidProposal("Documentation proposal has invalid lifecycle state.");
  }

  const targets: ProposalTarget[] = [];
  const seenPaths = new Set<string>();
  let previousPath: string | null = null;

  for (const rawTarget of proposal.targets) {
    if (
      !isRecord(rawTarget) ||
      typeof rawTarget.path !== "string" ||
      !isDocumentationOperation(rawTarget.operation)
    ) {
      invalidProposal("Documentation proposal contains an invalid target.");
    }

    const path = rawTarget.path;

    try {
      validateRelativePath(path);
    } catch {
      invalidProposal("Proposal contains an invalid target path.", path);
    }

    if (seenPaths.has(path)) {
      invalidProposal("Proposal contains duplicate target paths.", path);
    }

    if (previousPath !== null && previousPath >= path) {
      invalidProposal(
        "Proposal targets are not in deterministic path order.",
        path,
      );
    }

    seenPaths.add(path);
    previousPath = path;

    if (
      !pathAllowed(proposal.authority, path) ||
      !operationAllowed(proposal.authority, rawTarget.operation)
    ) {
      invalidProposal("Proposal target violates its authority contract.", path);
    }

    let before: ProposalSnapshot | null = null;
    let after: ProposalSnapshot | null = null;

    if (rawTarget.before !== null) {
      before = validateStoredSnapshot(rawTarget.before, path);
    }

    if (rawTarget.after !== null) {
      after = validateStoredSnapshot(rawTarget.after, path);
    }

    switch (rawTarget.operation) {
      case "create":
        if (before !== null || after === null) {
          invalidProposal(
            "Create target has invalid before/after state.",
            path,
          );
        }
        break;

      case "replace":
        if (
          before === null ||
          after === null ||
          before.sha256 === after.sha256
        ) {
          invalidProposal(
            "Replace target has invalid before/after state.",
            path,
          );
        }
        break;

      case "delete":
        if (before === null || after !== null) {
          invalidProposal(
            "Delete target has invalid before/after state.",
            path,
          );
        }
        break;
    }

    targets.push({
      path,
      operation: rawTarget.operation,
      before,
      after,
    });
  }

  const validatedProposal: ProposalPayload = {
    id: proposalId,
    created_at: proposal.created_at,
    project: {
      key,
      root: projectRoot,
    },
    authority: proposal.authority,
    targets,
  };

  return {
    record: {
      schema_version: 1,
      proposal: validatedProposal,
      integrity: {
        proposal_sha256: raw.integrity.proposal_sha256,
      },
      state: {
        status: "pending",
        applied_at: null,
      },
    },
    recordPath,
  };
}

async function validateFreshTarget(
  projectRoot: string,
  target: ProposalTarget,
): Promise<{
  absolutePath: string;
  mode: number | null;
}> {
  let inspected;

  try {
    inspected = await inspectTargetPath(projectRoot, target.path);
  } catch (error) {
    throw new DocumentationError(
      "STALE_TARGET",
      "Target no longer matches the reviewed filesystem state.",
      target.path,
      error instanceof DocumentationError &&
        error.code === "SYMLINK_NOT_ALLOWED"
        ? "symlink-detected"
        : "target-type-changed",
    );
  }

  if (target.operation === "create") {
    if (inspected.exists) {
      throw new DocumentationError(
        "STALE_TARGET",
        "Create target now exists.",
        target.path,
        "target-now-exists",
      );
    }

    return {
      absolutePath: inspected.absolutePath,
      mode: null,
    };
  }

  if (!inspected.exists) {
    throw new DocumentationError(
      "STALE_TARGET",
      "Reviewed target no longer exists.",
      target.path,
      "target-now-missing",
    );
  }

  if (!inspected.regularFile) {
    throw new DocumentationError(
      "STALE_TARGET",
      "Reviewed target is no longer a regular file.",
      target.path,
      "target-type-changed",
    );
  }

  const bytes = await readFile(inspected.absolutePath);

  if (sha256Bytes(bytes) !== target.before!.sha256) {
    throw new DocumentationError(
      "STALE_TARGET",
      "Target content has changed since Preview.",
      target.path,
      "checksum-mismatch",
    );
  }

  return {
    absolutePath: inspected.absolutePath,
    mode: inspected.mode,
  };
}

async function verifyFileChecksum(
  path: string,
  expected: string,
): Promise<void> {
  const bytes = await readFile(path);

  if (sha256Bytes(bytes) !== expected) {
    throw new Error(`Checksum verification failed for ${path}`);
  }
}

async function prepareTransaction(
  projectRoot: string,
  key: string,
  proposal: ProposalPayload,
): Promise<{
  directory: string;
  targets: PreparedTarget[];
}> {
  const projectTransactions = join(transactionStateRoot(), key);

  const transactionDirectory = join(projectTransactions, proposal.id);

  try {
    await mkdir(projectTransactions, {
      recursive: true,
      mode: 0o700,
    });

    await mkdir(transactionDirectory, {
      mode: 0o700,
    });
  } catch (error) {
    if (isNodeError(error, "EEXIST")) {
      throw new DocumentationError(
        "APPLY_PREPARATION_FAILED",
        "Recovery state already exists for this proposal. Refusing to overwrite it.",
      );
    }

    throw new DocumentationError(
      "APPLY_PREPARATION_FAILED",
      `Unable to create transaction workspace: ${errorMessage(error)}`,
    );
  }

  const stagedDirectory = join(transactionDirectory, "staged");

  const backupDirectory = join(transactionDirectory, "backup");

  try {
    await mkdir(stagedDirectory, {
      mode: 0o700,
    });

    await mkdir(backupDirectory, {
      mode: 0o700,
    });

    const prepared: PreparedTarget[] = [];

    for (let index = 0; index < proposal.targets.length; index += 1) {
      const target = proposal.targets[index]!;
      const number = String(index + 1).padStart(4, "0");

      const live = await validateFreshTarget(projectRoot, target);

      let stagedPath: string | null = null;
      let backupPath: string | null = null;

      if (target.after !== null) {
        stagedPath = join(stagedDirectory, number);

        await writeFile(stagedPath, Buffer.from(target.after.content, "utf8"), {
          flag: "wx",
          mode: 0o600,
        });

        await verifyFileChecksum(stagedPath, target.after.sha256);
      }

      if (target.before !== null) {
        backupPath = join(backupDirectory, number);

        await copyFile(live.absolutePath, backupPath);

        await verifyFileChecksum(backupPath, target.before.sha256);
      }

      prepared.push({
        target,
        absolute_path: live.absolutePath,
        staged_path: stagedPath,
        backup_path: backupPath,
        original_mode: live.mode,
      });
    }

    return {
      directory: transactionDirectory,
      targets: prepared,
    };
  } catch (error) {
    try {
      await rm(transactionDirectory, {
        recursive: true,
        force: true,
      });
    } catch {
      // Best-effort cleanup before project mutation.
    }

    if (error instanceof DocumentationError) {
      throw error;
    }

    throw new DocumentationError(
      "APPLY_PREPARATION_FAILED",
      `Unable to prepare documentation transaction: ${errorMessage(error)}`,
    );
  }
}

async function ensureTargetParents(
  projectRoot: string,
  targetPath: string,
  createdDirectories: string[],
): Promise<void> {
  const segments = targetPath.split("/").slice(0, -1);

  let current = projectRoot;

  for (const segment of segments) {
    current = join(current, segment);

    try {
      const stat = await lstat(current);

      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error(`Parent path is not a safe directory: ${current}`);
      }
    } catch (error) {
      if (!isNodeError(error, "ENOENT")) {
        throw error;
      }

      try {
        await mkdir(current);
        createdDirectories.push(current);
      } catch (mkdirError) {
        if (!isNodeError(mkdirError, "EEXIST")) {
          throw mkdirError;
        }

        const stat = await lstat(current);

        if (stat.isSymbolicLink() || !stat.isDirectory()) {
          throw new Error(`Parent path is not a safe directory: ${current}`);
        }
      }
    }
  }
}

async function replaceWithContent(
  absolutePath: string,
  content: Uint8Array,
  mode: number,
  expectedSha256: string,
): Promise<void> {
  const temporaryPath = join(
    dirname(absolutePath),
    `.${basename(absolutePath)}.${randomUUID()}.tmp`,
  );

  try {
    await writeFile(temporaryPath, content, {
      flag: "wx",
      mode,
    });

    await verifyFileChecksum(temporaryPath, expectedSha256);

    await rename(temporaryPath, absolutePath);
  } finally {
    try {
      await unlink(temporaryPath);
    } catch {
      // Temp may already have been renamed.
    }
  }
}

async function commitTargets(
  projectRoot: string,
  prepared: PreparedTarget[],
  applied: AppliedTarget[],
  createdDirectories: string[],
): Promise<ApplySuccessChange[]> {
  const results: ApplySuccessChange[] = [];

  for (const item of prepared) {
    const target = item.target;

    // Revalidate immediately before each mutation.
    await validateFreshTarget(projectRoot, target);

    switch (target.operation) {
      case "create": {
        await ensureTargetParents(projectRoot, target.path, createdDirectories);

        const staged = await readFile(item.staged_path!);

        try {
          await createWithContent(
            item.absolute_path,
            staged,
            0o644,
            target.after!.sha256,
          );
        } catch (error) {
          throw new DocumentationError(
            "APPLY_FAILED",
            `Unable to create target: ${errorMessage(error)}`,
            target.path,
          );
        }

        applied.push({
          target,
          absolute_path: item.absolute_path,
          original_mode: null,
        });

        results.push({
          path: target.path,
          operation: "create",
          sha256: target.after!.sha256,
        });

        break;
      }

      case "replace": {
        const staged = await readFile(item.staged_path!);

        try {
          await replaceWithContent(
            item.absolute_path,
            staged,
            item.original_mode ?? 0o644,
            target.after!.sha256,
          );
        } catch (error) {
          throw new DocumentationError(
            "APPLY_FAILED",
            `Unable to replace target: ${errorMessage(error)}`,
            target.path,
          );
        }

        applied.push({
          target,
          absolute_path: item.absolute_path,
          original_mode: item.original_mode,
        });

        await verifyFileChecksum(item.absolute_path, target.after!.sha256);

        results.push({
          path: target.path,
          operation: "replace",
          sha256: target.after!.sha256,
        });

        break;
      }

      case "delete": {
        try {
          await unlink(item.absolute_path);
        } catch (error) {
          throw new DocumentationError(
            "APPLY_FAILED",
            `Unable to delete target: ${errorMessage(error)}`,
            target.path,
          );
        }

        applied.push({
          target,
          absolute_path: item.absolute_path,
          original_mode: item.original_mode,
        });

        try {
          await lstat(item.absolute_path);

          throw new DocumentationError(
            "APPLY_FAILED",
            "Deleted target still exists.",
            target.path,
          );
        } catch (error) {
          if (!isNodeError(error, "ENOENT")) {
            throw error;
          }
        }

        results.push({
          path: target.path,
          operation: "delete",
          sha256: null,
        });

        break;
      }
    }
  }

  return results;
}

async function rollbackTargets(
  applied: AppliedTarget[],
  prepared: PreparedTarget[],
  createdDirectories: string[],
): Promise<RollbackResult> {
  const unresolved = new Set<string>();

  const preparedByPath = new Map(
    prepared.map((item) => [item.target.path, item]),
  );

  for (let index = applied.length - 1; index >= 0; index -= 1) {
    const item = applied[index]!;
    const target = item.target;
    const preparedItem = preparedByPath.get(target.path)!;

    try {
      if (target.operation === "create") {
        try {
          const bytes = await readFile(item.absolute_path);

          if (sha256Bytes(bytes) !== target.after!.sha256) {
            unresolved.add(target.path);
            continue;
          }

          await unlink(item.absolute_path);
        } catch (error) {
          if (!isNodeError(error, "ENOENT")) {
            throw error;
          }
        }

        continue;
      }

      if (target.operation === "replace") {
        let canRestore = false;

        try {
          const bytes = await readFile(item.absolute_path);

          canRestore = sha256Bytes(bytes) === target.after!.sha256;
        } catch (error) {
          if (isNodeError(error, "ENOENT")) {
            canRestore = true;
          } else {
            throw error;
          }
        }

        if (!canRestore) {
          unresolved.add(target.path);
          continue;
        }

        const backup = await readFile(preparedItem.backup_path!);

        await replaceWithContent(
          item.absolute_path,
          backup,
          item.original_mode ?? 0o644,
          target.before!.sha256,
        );

        continue;
      }

      // delete
      try {
        const bytes = await readFile(item.absolute_path);

        if (sha256Bytes(bytes) === target.before!.sha256) {
          continue;
        }

        unresolved.add(target.path);
        continue;
      } catch (error) {
        if (!isNodeError(error, "ENOENT")) {
          throw error;
        }
      }

      const backup = await readFile(preparedItem.backup_path!);

      await replaceWithContent(
        item.absolute_path,
        backup,
        item.original_mode ?? 0o644,
        target.before!.sha256,
      );
    } catch {
      unresolved.add(target.path);
    }
  }

  for (let index = createdDirectories.length - 1; index >= 0; index -= 1) {
    try {
      await rmdir(createdDirectories[index]!);
    } catch {
      // Remove only empty transaction-created
      // directories. Leave anything else intact.
    }
  }

  return {
    succeeded: unresolved.size === 0,
    unresolved_paths: [...unresolved],
  };
}

async function persistAppliedState(
  recordPath: string,
  record: ProposalRecord,
  appliedAt: string,
): Promise<void> {
  const updated: ProposalRecord = {
    ...record,
    state: {
      status: "applied",
      applied_at: appliedAt,
    },
  };

  const temporaryPath = join(
    dirname(recordPath),
    `.${basename(recordPath)}.${randomUUID()}.tmp`,
  );

  try {
    await writeFile(temporaryPath, `${json(updated)}\n`, {
      flag: "wx",
      mode: 0o600,
    });

    await rename(temporaryPath, recordPath);
  } catch (error) {
    try {
      await unlink(temporaryPath);
    } catch {
      // Best-effort cleanup.
    }

    throw new DocumentationError(
      "PROPOSAL_STATE_FAILED",
      `Unable to persist applied proposal state: ${errorMessage(error)}`,
    );
  }
}

async function createWithContent(
  absolutePath: string,
  content: Uint8Array,
  mode: number,
  expectedSha256: string,
): Promise<void> {
  const temporaryPath = join(
    dirname(absolutePath),
    `.${basename(absolutePath)}.${randomUUID()}.tmp`,
  );

  try {
    await writeFile(temporaryPath, content, {
      flag: "wx",
      mode,
    });

    await verifyFileChecksum(temporaryPath, expectedSha256);

    await link(temporaryPath, absolutePath);
  } finally {
    try {
      await unlink(temporaryPath);
    } catch {
      // Temp may already be absent.
    }
  }
}

function failure(error: DocumentationError): string {
  return json({
    version: 1,
    ok: false,
    error: {
      code: error.code,
      ...(error.path ? { path: error.path } : {}),
      message: error.message,
    },
  });
}

function applyFailure(
  proposalId: string | undefined,
  error: DocumentationError,
  rollback?: RollbackResult,
  recoveryStatePreserved?: boolean,
): string {
  return json({
    version: 1,
    ok: false,
    ...(proposalId ? { proposal_id: proposalId } : {}),
    error: {
      code: error.code,
      message: error.message,
      ...(error.path ? { path: error.path } : {}),
      ...(error.reason ? { reason: error.reason } : {}),
    },
    ...(rollback
      ? {
          rollback: {
            attempted: true,
            succeeded: rollback.succeeded,
            ...(rollback.unresolved_paths.length > 0
              ? {
                  unresolved_paths: rollback.unresolved_paths,
                }
              : {}),
          },
        }
      : {}),
    ...(recoveryStatePreserved !== undefined
      ? {
          recovery_state_preserved: recoveryStatePreserved,
        }
      : {}),
  });
}

export const preview = tool({
  description:
    "Create an immutable review proposal for allowed project documentation " +
    "without modifying project files. The proposal is bound to the current " +
    "project and records exact before/after content and checksums.",

  args: {
    authority: tool.schema
      .enum(["docs", "project-definition", "milestone", "decision"])
      .describe(
        "Semantic workflow authority requesting the documentation change.",
      ),

    changes: tool.schema
      .array(
        tool.schema.object({
          path: tool.schema
            .string()
            .describe(
              "Strict project-relative documentation path using forward slashes.",
            ),

          operation: tool.schema
            .enum(["create", "replace", "delete"])
            .describe("Exact requested filesystem operation."),

          content: tool.schema
            .string()
            .optional()
            .describe(
              "Complete resulting UTF-8 file content. Required for create/replace and omitted for delete.",
            ),
        }),
      )
      .min(1)
      .describe(
        "Complete documentation change set. The proposal is rejected as a whole if any change is invalid.",
      ),
  },

  async execute(args, context) {
    try {
      const directory = context.worktree || context.directory;

      if (!directory) {
        throw new DocumentationError(
          "PROJECT_RESOLUTION_FAILED",
          "OpenCode did not provide a project directory.",
        );
      }

      const projectRoot = await resolveProjectRoot(directory);

      const key = projectKey(projectRoot);

      const seenPaths = new Set<string>();

      for (const change of args.changes) {
        validateRelativePath(change.path);
        validateChangeContent(change);

        if (seenPaths.has(change.path)) {
          throw new DocumentationError(
            "DUPLICATE_PATH",
            "A proposal must not contain the same target path more than once.",
            change.path,
          );
        }

        seenPaths.add(change.path);

        validateAuthorityBoundary(args.authority, change);
      }

      const sortedChanges = [...args.changes].sort((left, right) => {
        if (left.path < right.path) {
          return -1;
        }

        if (left.path > right.path) {
          return 1;
        }

        return 0;
      });

      const targets: ProposalTarget[] = [];

      for (const change of sortedChanges) {
        targets.push(await buildTarget(projectRoot, change));
      }

      const proposal: ProposalPayload = {
        id: `doc-${randomUUID()}`,
        created_at: new Date().toISOString(),
        project: {
          key,
          root: projectRoot,
        },
        authority: args.authority,
        targets,
      };

      const record: ProposalRecord = {
        schema_version: 1,
        proposal,
        integrity: {
          proposal_sha256: proposalIntegrity(1, proposal),
        },
        state: {
          status: "pending",
          applied_at: null,
        },
      };

      await persistProposal(record);

      return json({
        version: 1,
        ok: true,
        proposal_id: proposal.id,
        project_root: projectRoot,
        project_key: key,
        authority: proposal.authority,
        changes: targets.map((target) => ({
          path: target.path,
          operation: target.operation,
          before: target.before,
          after: target.after,
        })),
      });
    } catch (error) {
      if (error instanceof DocumentationError) {
        return failure(error);
      }

      return failure(
        new DocumentationError("PREVIEW_FAILED", errorMessage(error)),
      );
    }
  },
});

export const apply = tool({
  description:
    "Apply one exact previously reviewed documentation proposal. " +
    "Revalidates proposal integrity, project binding, target freshness, " +
    "and transaction invariants before any project mutation.",

  args: {
    proposal_id: tool.schema
      .string()
      .describe(
        "Exact documentation proposal identifier returned by documentation_preview.",
      ),
  },

  async execute(args, context) {
    const proposalId = args.proposal_id;

    let transactionDirectory: string | null = null;

    let prepared: PreparedTarget[] = [];
    const applied: AppliedTarget[] = [];
    const createdDirectories: string[] = [];

    try {
      const directory = context.worktree || context.directory;

      if (!directory) {
        throw new DocumentationError(
          "PROJECT_RESOLUTION_FAILED",
          "OpenCode did not provide a project directory.",
        );
      }

      const projectRoot = await resolveProjectRoot(directory);

      const key = projectKey(projectRoot);

      const { record, recordPath } = await loadProposal(
        projectRoot,
        key,
        proposalId,
      );

      // Full freshness validation before
      // transaction preparation.
      for (const target of record.proposal.targets) {
        await validateFreshTarget(projectRoot, target);
      }

      const transaction = await prepareTransaction(
        projectRoot,
        key,
        record.proposal,
      );

      transactionDirectory = transaction.directory;

      prepared = transaction.targets;

      let changes: ApplySuccessChange[];

      try {
        changes = await commitTargets(
          projectRoot,
          prepared,
          applied,
          createdDirectories,
        );
      } catch (error) {
        const rollback = await rollbackTargets(
          applied,
          prepared,
          createdDirectories,
        );

        if (!rollback.succeeded) {
          return applyFailure(
            proposalId,
            new DocumentationError(
              "ROLLBACK_FAILED",
              "Documentation Apply failed and rollback could not fully restore the project.",
            ),
            rollback,
            true,
          );
        }

        let recoveryStatePreserved = false;

        if (transactionDirectory) {
          try {
            await rm(transactionDirectory, {
              recursive: true,
              force: true,
            });
          } catch {
            recoveryStatePreserved = true;
          }
        }

        const applyError =
          error instanceof DocumentationError
            ? error
            : new DocumentationError("APPLY_FAILED", errorMessage(error));

        return applyFailure(
          proposalId,
          applyError,
          rollback,
          recoveryStatePreserved,
        );
      }

      const appliedAt = new Date().toISOString();

      try {
        await persistAppliedState(recordPath, record, appliedAt);
      } catch (error) {
        const rollback = await rollbackTargets(
          applied,
          prepared,
          createdDirectories,
        );

        if (!rollback.succeeded) {
          return applyFailure(
            proposalId,
            new DocumentationError(
              "ROLLBACK_FAILED",
              "Proposal state persistence failed and rollback could not fully restore the project.",
            ),
            rollback,
            true,
          );
        }

        let recoveryStatePreserved = false;

        if (transactionDirectory) {
          try {
            await rm(transactionDirectory, {
              recursive: true,
              force: true,
            });
          } catch {
            recoveryStatePreserved = true;
          }
        }

        return applyFailure(
          proposalId,
          error instanceof DocumentationError
            ? error
            : new DocumentationError(
                "PROPOSAL_STATE_FAILED",
                errorMessage(error),
              ),
          rollback,
          recoveryStatePreserved,
        );
      }

      let cleanupWarning: string | undefined;

      if (transactionDirectory) {
        try {
          await rm(transactionDirectory, {
            recursive: true,
            force: true,
          });
        } catch (error) {
          cleanupWarning = `Transaction cleanup failed: ${errorMessage(error)}`;
        }
      }

      return json({
        version: 1,
        ok: true,
        proposal_id: proposalId,
        applied_at: appliedAt,
        changes,
        ...(cleanupWarning
          ? {
              warnings: [cleanupWarning],
            }
          : {}),
      });
    } catch (error) {
      if (transactionDirectory && applied.length === 0) {
        try {
          await rm(transactionDirectory, {
            recursive: true,
            force: true,
          });
        } catch {
          // No project mutation occurred.
        }
      }

      return applyFailure(
        proposalId,
        error instanceof DocumentationError
          ? error
          : new DocumentationError(
              "APPLY_PREPARATION_FAILED",
              errorMessage(error),
            ),
      );
    }
  },
});
