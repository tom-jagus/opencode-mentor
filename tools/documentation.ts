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
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

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

type ProposalRecord = {
  schema_version: 1;
  proposal: ProposalPayload;
  integrity: {
    proposal_sha256: string;
  };
  state: {
    status: "pending";
    applied_at: null;
  };
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
  | "PREVIEW_FAILED";

class DocumentationError extends Error {
  readonly code: ErrorCode;
  readonly path?: string;

  constructor(code: ErrorCode, message: string, path?: string) {
    super(message);
    this.name = "DocumentationError";
    this.code = code;
    this.path = path;
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
        };
      }

      throw error;
    }
  }

  return {
    absolutePath,
    exists: false,
    regularFile: false,
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

function proposalStateRoot(): string {
  const configured = Bun.env.XDG_STATE_HOME;

  const stateHome =
    configured && isAbsolute(configured)
      ? configured
      : join(homedir(), ".local", "state");

  return join(stateHome, "opencode-mentor", "documentation-proposals");
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
