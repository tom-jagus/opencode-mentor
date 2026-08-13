import {
  lstat,
  readFile,
  realpath,
} from "node:fs/promises";
import {
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { tool } from "@opencode-ai/plugin";

type PolicyErrorCode =
  | "PROJECT_RESOLUTION_FAILED"
  | "GLOBAL_POLICY_MISSING"
  | "POLICY_READ_FAILED"
  | "POLICY_NOT_REGULAR_FILE"
  | "POLICY_SYMLINK_NOT_ALLOWED"
  | "POLICY_OUTSIDE_ROOT"
  | "POLICY_TOO_LARGE"
  | "POLICY_NOT_UTF8"
  | "POLICY_PARSE_FAILED"
  | "UNSUPPORTED_SCHEMA_VERSION"
  | "UNKNOWN_POLICY_KEY"
  | "MISSING_POLICY_VALUE"
  | "INVALID_POLICY_VALUE";

type PolicyTable = Record<string, unknown>;

export type GitPolicy = {
  schema_version: 1;
  base_branch: string;
  branch: {
    allowed_types: string[];
    format: "<type>/<kebab-case-summary>";
  };
  commit_message: {
    style: "descriptive";
    subject_case: "sentence";
    trailing_period: false;
    forbidden_prefix_patterns: string[];
  };
  merge: {
    strategy: "squash";
    delete_branch: boolean;
  };
  branch_update: {
    strategy: "rebase";
    require_before_finalization: boolean;
    force_push: "force-with-lease";
  };
  validation: {
    profile: "standard";
  };
  pull_request: {
    draft: boolean;
    generated_body: boolean;
  };
  release: {
    enabled: boolean;
    versioning: "semantic";
    tag_prefix: string;
    notes: "generated-reviewable";
  };
};

class PolicyError extends Error {
  readonly code: PolicyErrorCode;
  readonly source?: string;
  readonly policy_path?: string;

  constructor(
    code: PolicyErrorCode,
    message: string,
    source?: string,
    policyPath?: string,
  ) {
    super(message);
    this.name = "PolicyError";
    this.code = code;
    this.source = source;
    this.policy_path = policyPath;
  }
}

const maxPolicyBytes = 256 * 1024;

const topLevelKeys = new Set([
  "schema_version",
  "base_branch",
  "branch",
  "commit_message",
  "merge",
  "branch_update",
  "validation",
  "pull_request",
  "release",
]);

const approvedBranchTypes = new Set([
  "feature",
  "fix",
  "docs",
  "refactor",
  "test",
  "chore",
]);

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
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

function isTable(value: unknown): value is PolicyTable {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function assertKnownKeys(
  table: PolicyTable,
  allowed: ReadonlySet<string>,
  path: string,
  source: string,
): void {
  for (const key of Object.keys(table)) {
    if (!allowed.has(key)) {
      throw new PolicyError(
        "UNKNOWN_POLICY_KEY",
        `${source} contains unknown policy key ${path}.${key}`,
        source,
      );
    }
  }
}

function requiredValue(
  table: PolicyTable,
  key: string,
  path: string,
  source: string,
): unknown {
  if (!(key in table)) {
    throw new PolicyError(
      "MISSING_POLICY_VALUE",
      `${source} is missing required value ${path}.${key}`,
      source,
    );
  }

  return table[key];
}

function optionalValue(
  table: PolicyTable,
  key: string,
  partial: boolean,
  path: string,
  source: string,
): unknown {
  if (key in table) {
    return table[key];
  }

  if (partial) {
    return undefined;
  }

  return requiredValue(table, key, path, source);
}

function stringValue(
  value: unknown,
  path: string,
  source: string,
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new PolicyError(
      "INVALID_POLICY_VALUE",
      `${source} value ${path} must be a non-empty string`,
      source,
    );
  }

  return value;
}

function booleanValue(
  value: unknown,
  path: string,
  source: string,
): boolean {
  if (typeof value !== "boolean") {
    throw new PolicyError(
      "INVALID_POLICY_VALUE",
      `${source} value ${path} must be a boolean`,
      source,
    );
  }

  return value;
}

function literalValue<T extends string | boolean>(
  value: unknown,
  expected: T,
  path: string,
  source: string,
): T {
  if (value !== expected) {
    throw new PolicyError(
      "INVALID_POLICY_VALUE",
      `${source} value ${path} must be ${JSON.stringify(expected)}`,
      source,
    );
  }

  return expected;
}

function stringArrayValue(
  value: unknown,
  path: string,
  source: string,
): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== "string" || item.length === 0)
  ) {
    throw new PolicyError(
      "INVALID_POLICY_VALUE",
      `${source} value ${path} must be a non-empty array of non-empty strings`,
      source,
    );
  }

  const values = [...value] as string[];

  if (new Set(values).size !== values.length) {
    throw new PolicyError(
      "INVALID_POLICY_VALUE",
      `${source} value ${path} must not contain duplicates`,
      source,
    );
  }

  return values;
}

function tableValue(
  value: unknown,
  path: string,
  source: string,
): PolicyTable {
  if (!isTable(value)) {
    throw new PolicyError(
      "INVALID_POLICY_VALUE",
      `${source} value ${path} must be a table`,
      source,
    );
  }

  return value;
}

function normalizePolicy(
  input: unknown,
  partial: boolean,
  source: string,
): PolicyTable {
  const root = tableValue(input, "policy", source);
  assertKnownKeys(root, topLevelKeys, "policy", source);

  const schemaVersion = requiredValue(
    root,
    "schema_version",
    "policy",
    source,
  );

  if (schemaVersion !== 1) {
    throw new PolicyError(
      "UNSUPPORTED_SCHEMA_VERSION",
      `${source} schema_version must be 1`,
      source,
    );
  }

  const result: PolicyTable = {
    schema_version: 1,
  };

  const baseBranch = optionalValue(
    root,
    "base_branch",
    partial,
    "policy",
    source,
  );

  if (baseBranch !== undefined) {
    const normalized = stringValue(
      baseBranch,
      "policy.base_branch",
      source,
    );

    if (
      !/^[a-z0-9](?:[a-z0-9._/-]*[a-z0-9])?$/.test(normalized) ||
      normalized.includes("..") ||
      normalized.includes("//") ||
      normalized.includes("@{")
    ) {
      throw new PolicyError(
        "INVALID_POLICY_VALUE",
        `${source} value policy.base_branch is not a safe branch name`,
        source,
      );
    }

    result.base_branch = normalized;
  }

  normalizeBranch(root, result, partial, source);
  normalizeCommitMessage(root, result, partial, source);
  normalizeMerge(root, result, partial, source);
  normalizeBranchUpdate(root, result, partial, source);
  normalizeValidation(root, result, partial, source);
  normalizePullRequest(root, result, partial, source);
  normalizeRelease(root, result, partial, source);

  return result;
}

function normalizeBranch(
  root: PolicyTable,
  result: PolicyTable,
  partial: boolean,
  source: string,
): void {
  const value = optionalValue(
    root,
    "branch",
    partial,
    "policy",
    source,
  );

  if (value === undefined) {
    return;
  }

  const table = tableValue(value, "policy.branch", source);
  assertKnownKeys(
    table,
    new Set(["allowed_types", "format"]),
    "policy.branch",
    source,
  );

  const output: PolicyTable = {};
  const allowedTypes = optionalValue(
    table,
    "allowed_types",
    partial,
    "policy.branch",
    source,
  );

  if (allowedTypes !== undefined) {
    const normalized = stringArrayValue(
      allowedTypes,
      "policy.branch.allowed_types",
      source,
    );

    for (const branchType of normalized) {
      if (!approvedBranchTypes.has(branchType)) {
        throw new PolicyError(
          "INVALID_POLICY_VALUE",
          `${source} branch type ${JSON.stringify(branchType)} is not approved by schema v1`,
          source,
        );
      }
    }

    output.allowed_types = normalized;
  }

  const format = optionalValue(
    table,
    "format",
    partial,
    "policy.branch",
    source,
  );

  if (format !== undefined) {
    output.format = literalValue(
      format,
      "<type>/<kebab-case-summary>",
      "policy.branch.format",
      source,
    );
  }

  result.branch = output;
}

function normalizeCommitMessage(
  root: PolicyTable,
  result: PolicyTable,
  partial: boolean,
  source: string,
): void {
  const value = optionalValue(
    root,
    "commit_message",
    partial,
    "policy",
    source,
  );

  if (value === undefined) {
    return;
  }

  const table = tableValue(value, "policy.commit_message", source);
  assertKnownKeys(
    table,
    new Set([
      "style",
      "subject_case",
      "trailing_period",
      "forbidden_prefix_patterns",
    ]),
    "policy.commit_message",
    source,
  );

  const output: PolicyTable = {};

  const style = optionalValue(
    table,
    "style",
    partial,
    "policy.commit_message",
    source,
  );
  if (style !== undefined) {
    output.style = literalValue(
      style,
      "descriptive",
      "policy.commit_message.style",
      source,
    );
  }

  const subjectCase = optionalValue(
    table,
    "subject_case",
    partial,
    "policy.commit_message",
    source,
  );
  if (subjectCase !== undefined) {
    output.subject_case = literalValue(
      subjectCase,
      "sentence",
      "policy.commit_message.subject_case",
      source,
    );
  }

  const trailingPeriod = optionalValue(
    table,
    "trailing_period",
    partial,
    "policy.commit_message",
    source,
  );
  if (trailingPeriod !== undefined) {
    output.trailing_period = literalValue(
      trailingPeriod,
      false,
      "policy.commit_message.trailing_period",
      source,
    );
  }

  const forbiddenPatterns = optionalValue(
    table,
    "forbidden_prefix_patterns",
    partial,
    "policy.commit_message",
    source,
  );

  if (forbiddenPatterns !== undefined) {
    const patterns = stringArrayValue(
      forbiddenPatterns,
      "policy.commit_message.forbidden_prefix_patterns",
      source,
    );

    for (const pattern of patterns) {
      try {
        new RegExp(pattern);
      } catch {
        throw new PolicyError(
          "INVALID_POLICY_VALUE",
          `${source} contains invalid commit prefix pattern ${JSON.stringify(pattern)}`,
          source,
        );
      }
    }

    output.forbidden_prefix_patterns = patterns;
  }

  result.commit_message = output;
}

function normalizeMerge(
  root: PolicyTable,
  result: PolicyTable,
  partial: boolean,
  source: string,
): void {
  const value = optionalValue(
    root,
    "merge",
    partial,
    "policy",
    source,
  );

  if (value === undefined) {
    return;
  }

  const table = tableValue(value, "policy.merge", source);
  assertKnownKeys(
    table,
    new Set(["strategy", "delete_branch"]),
    "policy.merge",
    source,
  );

  const output: PolicyTable = {};
  const strategy = optionalValue(
    table,
    "strategy",
    partial,
    "policy.merge",
    source,
  );
  if (strategy !== undefined) {
    output.strategy = literalValue(
      strategy,
      "squash",
      "policy.merge.strategy",
      source,
    );
  }

  const deleteBranch = optionalValue(
    table,
    "delete_branch",
    partial,
    "policy.merge",
    source,
  );
  if (deleteBranch !== undefined) {
    output.delete_branch = booleanValue(
      deleteBranch,
      "policy.merge.delete_branch",
      source,
    );
  }

  result.merge = output;
}

function normalizeBranchUpdate(
  root: PolicyTable,
  result: PolicyTable,
  partial: boolean,
  source: string,
): void {
  const value = optionalValue(
    root,
    "branch_update",
    partial,
    "policy",
    source,
  );

  if (value === undefined) {
    return;
  }

  const table = tableValue(value, "policy.branch_update", source);
  assertKnownKeys(
    table,
    new Set([
      "strategy",
      "require_before_finalization",
      "force_push",
    ]),
    "policy.branch_update",
    source,
  );

  const output: PolicyTable = {};

  const strategy = optionalValue(
    table,
    "strategy",
    partial,
    "policy.branch_update",
    source,
  );
  if (strategy !== undefined) {
    output.strategy = literalValue(
      strategy,
      "rebase",
      "policy.branch_update.strategy",
      source,
    );
  }

  const required = optionalValue(
    table,
    "require_before_finalization",
    partial,
    "policy.branch_update",
    source,
  );
  if (required !== undefined) {
    output.require_before_finalization = booleanValue(
      required,
      "policy.branch_update.require_before_finalization",
      source,
    );
  }

  const forcePush = optionalValue(
    table,
    "force_push",
    partial,
    "policy.branch_update",
    source,
  );
  if (forcePush !== undefined) {
    output.force_push = literalValue(
      forcePush,
      "force-with-lease",
      "policy.branch_update.force_push",
      source,
    );
  }

  result.branch_update = output;
}

function normalizeValidation(
  root: PolicyTable,
  result: PolicyTable,
  partial: boolean,
  source: string,
): void {
  const value = optionalValue(
    root,
    "validation",
    partial,
    "policy",
    source,
  );

  if (value === undefined) {
    return;
  }

  const table = tableValue(value, "policy.validation", source);
  assertKnownKeys(
    table,
    new Set(["profile"]),
    "policy.validation",
    source,
  );

  const output: PolicyTable = {};
  const profile = optionalValue(
    table,
    "profile",
    partial,
    "policy.validation",
    source,
  );

  if (profile !== undefined) {
    output.profile = literalValue(
      profile,
      "standard",
      "policy.validation.profile",
      source,
    );
  }

  result.validation = output;
}

function normalizePullRequest(
  root: PolicyTable,
  result: PolicyTable,
  partial: boolean,
  source: string,
): void {
  const value = optionalValue(
    root,
    "pull_request",
    partial,
    "policy",
    source,
  );

  if (value === undefined) {
    return;
  }

  const table = tableValue(value, "policy.pull_request", source);
  assertKnownKeys(
    table,
    new Set(["draft", "generated_body"]),
    "policy.pull_request",
    source,
  );

  const output: PolicyTable = {};

  for (const key of ["draft", "generated_body"] as const) {
    const setting = optionalValue(
      table,
      key,
      partial,
      "policy.pull_request",
      source,
    );

    if (setting !== undefined) {
      output[key] = booleanValue(
        setting,
        `policy.pull_request.${key}`,
        source,
      );
    }
  }

  result.pull_request = output;
}

function normalizeRelease(
  root: PolicyTable,
  result: PolicyTable,
  partial: boolean,
  source: string,
): void {
  const value = optionalValue(
    root,
    "release",
    partial,
    "policy",
    source,
  );

  if (value === undefined) {
    return;
  }

  const table = tableValue(value, "policy.release", source);
  assertKnownKeys(
    table,
    new Set([
      "enabled",
      "versioning",
      "tag_prefix",
      "notes",
    ]),
    "policy.release",
    source,
  );

  const output: PolicyTable = {};

  const enabled = optionalValue(
    table,
    "enabled",
    partial,
    "policy.release",
    source,
  );
  if (enabled !== undefined) {
    output.enabled = booleanValue(
      enabled,
      "policy.release.enabled",
      source,
    );
  }

  const versioning = optionalValue(
    table,
    "versioning",
    partial,
    "policy.release",
    source,
  );
  if (versioning !== undefined) {
    output.versioning = literalValue(
      versioning,
      "semantic",
      "policy.release.versioning",
      source,
    );
  }

  const tagPrefix = optionalValue(
    table,
    "tag_prefix",
    partial,
    "policy.release",
    source,
  );
  if (tagPrefix !== undefined) {
    const normalized = stringValue(
      tagPrefix,
      "policy.release.tag_prefix",
      source,
    );

    if (!/^[A-Za-z0-9._-]+$/.test(normalized)) {
      throw new PolicyError(
        "INVALID_POLICY_VALUE",
        `${source} value policy.release.tag_prefix contains unsafe characters`,
        source,
      );
    }

    output.tag_prefix = normalized;
  }

  const notes = optionalValue(
    table,
    "notes",
    partial,
    "policy.release",
    source,
  );
  if (notes !== undefined) {
    output.notes = literalValue(
      notes,
      "generated-reviewable",
      "policy.release.notes",
      source,
    );
  }

  result.release = output;
}

function mergeKnown(
  globalPolicy: PolicyTable,
  projectPolicy: PolicyTable,
): PolicyTable {
  const result: PolicyTable = {};

  for (const key of Object.keys(globalPolicy)) {
    const globalValue = globalPolicy[key];
    const projectValue = projectPolicy[key];

    if (projectValue === undefined) {
      result[key] = globalValue;
      continue;
    }

    if (isTable(globalValue) && isTable(projectValue)) {
      result[key] = mergeKnown(globalValue, projectValue);
      continue;
    }

    result[key] = projectValue;
  }

  return result;
}

function parsePolicy(text: string, source: string): unknown {
  try {
    return Bun.TOML.parse(text);
  } catch (error) {
    throw new PolicyError(
      "POLICY_PARSE_FAILED",
      `${source} is not valid TOML: ${errorMessage(error)}`,
      source,
    );
  }
}

export function resolvePolicyDocuments(
  globalText: string,
  projectText?: string,
): GitPolicy {
  const globalPolicy = normalizePolicy(
    parsePolicy(globalText, "global policy"),
    false,
    "global policy",
  );

  const projectPolicy =
    projectText === undefined
      ? { schema_version: 1 }
      : normalizePolicy(
          parsePolicy(projectText, "project policy"),
          true,
          "project policy",
        );

  const merged = mergeKnown(globalPolicy, projectPolicy);

  return normalizePolicy(
    merged,
    false,
    "effective policy",
  ) as GitPolicy;
}

function isWithinRoot(root: string, candidate: string): boolean {
  const path = relative(root, candidate);

  return (
    path === "" ||
    (!path.startsWith(`..${sep}`) &&
      path !== ".." &&
      !isAbsolute(path))
  );
}

async function readPolicyFile(
  policyPath: string,
  root: string,
  required: boolean,
  source: string,
): Promise<string | null> {
  let status;

  try {
    status = await lstat(policyPath);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      if (!required) {
        return null;
      }

      throw new PolicyError(
        "GLOBAL_POLICY_MISSING",
        `Required ${source} is missing`,
        source,
        policyPath,
      );
    }

    throw new PolicyError(
      "POLICY_READ_FAILED",
      `Could not inspect ${source}: ${errorMessage(error)}`,
      source,
      policyPath,
    );
  }

  if (status.isSymbolicLink()) {
    throw new PolicyError(
      "POLICY_SYMLINK_NOT_ALLOWED",
      `${source} must not be a symbolic link`,
      source,
      policyPath,
    );
  }

  if (!status.isFile()) {
    throw new PolicyError(
      "POLICY_NOT_REGULAR_FILE",
      `${source} must be a regular file`,
      source,
      policyPath,
    );
  }

  if (status.size > maxPolicyBytes) {
    throw new PolicyError(
      "POLICY_TOO_LARGE",
      `${source} exceeds ${maxPolicyBytes} bytes`,
      source,
      policyPath,
    );
  }

  let canonicalPath: string;

  try {
    canonicalPath = await realpath(policyPath);
  } catch (error) {
    throw new PolicyError(
      "POLICY_READ_FAILED",
      `Could not resolve ${source}: ${errorMessage(error)}`,
      source,
      policyPath,
    );
  }

  if (!isWithinRoot(root, canonicalPath)) {
    throw new PolicyError(
      "POLICY_OUTSIDE_ROOT",
      `${source} resolves outside its allowed root`,
      source,
      policyPath,
    );
  }

  let bytes: Uint8Array;

  try {
    bytes = await readFile(canonicalPath);
  } catch (error) {
    throw new PolicyError(
      "POLICY_READ_FAILED",
      `Could not read ${source}: ${errorMessage(error)}`,
      source,
      policyPath,
    );
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new PolicyError(
      "POLICY_NOT_UTF8",
      `${source} must contain valid UTF-8`,
      source,
      policyPath,
    );
  }
}

function failure(error: unknown): string {
  if (error instanceof PolicyError) {
    return json({
      version: 1,
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.source ? { source: error.source } : {}),
        ...(error.policy_path
          ? { path: error.policy_path }
          : {}),
      },
    });
  }

  return json({
    version: 1,
    ok: false,
    error: {
      code: "POLICY_READ_FAILED",
      message: errorMessage(error),
    },
  });
}

export default tool({
  description:
    "Resolve and strictly validate deterministic effective Git policy. " +
    "Reads fixed global defaults and an optional sparse project override. " +
    "Performs no Git, network, worktree, configuration, or policy mutation.",

  args: {},

  async execute(_args, context) {
    try {
      const directory = context.worktree || context.directory;

      if (!directory) {
        throw new PolicyError(
          "PROJECT_RESOLUTION_FAILED",
          "Tool context does not provide a project directory",
        );
      }

      let projectRoot: string;
      let configurationRoot: string;

      try {
        [projectRoot, configurationRoot] = await Promise.all([
          realpath(directory),
          realpath(resolve(import.meta.dir, "..")),
        ]);
      } catch (error) {
        throw new PolicyError(
          "PROJECT_RESOLUTION_FAILED",
          `Could not resolve policy roots: ${errorMessage(error)}`,
        );
      }

      const globalPath = resolve(
        configurationRoot,
        "policies",
        "git-defaults.toml",
      );
      const projectPath = resolve(
        projectRoot,
        ".opencode",
        "git-policy.toml",
      );

      const [globalText, projectText] = await Promise.all([
        readPolicyFile(
          globalPath,
          configurationRoot,
          true,
          "global policy",
        ),
        readPolicyFile(
          projectPath,
          projectRoot,
          false,
          "project policy",
        ),
      ]);

      if (globalText === null) {
        throw new PolicyError(
          "GLOBAL_POLICY_MISSING",
          "Required global policy is missing",
          "global policy",
          globalPath,
        );
      }

      const effectivePolicy = resolvePolicyDocuments(
        globalText,
        projectText ?? undefined,
      );

      return json({
        version: 1,
        ok: true,
        sources: {
          global: {
            path: globalPath,
          },
          project: projectText === null
            ? {
                present: false,
                path: projectPath,
              }
            : {
                present: true,
                path: projectPath,
              },
        },
        effective_policy: effectivePolicy,
      });
    } catch (error) {
      return failure(error);
    }
  },
});
