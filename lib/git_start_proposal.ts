import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, sep } from "node:path";
import type { EffectiveGitPolicyResolution, GitPolicy } from "./git_policy";
import type { GitStartPreflight } from "./git_start";

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
  state: {
    status: "pending";
    applied_at: null;
  };
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
    "START_PREFLIGHT_FAILED" | "START_NOT_ELIGIBLE" | "PROPOSAL_STORAGE_FAILED";

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
    eligibility.head_sha === null
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
