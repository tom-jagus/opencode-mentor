import { createHash } from "node:crypto";
import { lstat, readlink, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { canonicalJson, sha256 } from "./git_lifecycle_proposal";

export type GitCheckpointPathSnapshot =
  | {
      path: string;
      kind: "file";
      sha256: string;
      size: number;
      executable: boolean;
    }
  | {
      path: string;
      kind: "symlink";
      sha256: string;
      size: number;
      executable: null;
    }
  | {
      path: string;
      kind: "missing";
      sha256: null;
      size: null;
      executable: null;
    };

export type GitCheckpointStageSnapshot = {
  repository_root: string;
  paths: GitCheckpointPathSnapshot[];
  snapshot_sha256: string;
};

export class GitCheckpointStageSnapshotError extends Error {
  readonly code:
    "INVALID_SNAPSHOT_PATH" | "UNSUPPORTED_PATH_TYPE" | "SNAPSHOT_FAILED";

  constructor(code: GitCheckpointStageSnapshotError["code"], message: string) {
    super(message);
    this.name = "GitCheckpointStageSnapshotError";
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

function isInsideRoot(root: string, target: string): boolean {
  const relativePath = relative(root, target);

  return (
    relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${sep}`) &&
      !isAbsolute(relativePath))
  );
}

function validateRelativePath(path: string): void {
  if (path.length === 0 || isAbsolute(path) || path.includes("\0")) {
    throw new GitCheckpointStageSnapshotError(
      "INVALID_SNAPSHOT_PATH",
      `Snapshot path ${JSON.stringify(path)} is invalid`,
    );
  }
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = Bun.file(path).stream();

  for await (const chunk of stream) {
    hash.update(chunk);
  }

  return hash.digest("hex");
}

async function snapshotPath(
  repositoryRoot: string,
  path: string,
): Promise<GitCheckpointPathSnapshot> {
  validateRelativePath(path);

  const candidate = resolve(repositoryRoot, path);

  if (!isInsideRoot(repositoryRoot, candidate)) {
    throw new GitCheckpointStageSnapshotError(
      "INVALID_SNAPSHOT_PATH",
      `Snapshot path ${JSON.stringify(path)} escapes the repository`,
    );
  }

  let status;

  try {
    status = await lstat(candidate);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      return {
        path,
        kind: "missing",
        sha256: null,
        size: null,
        executable: null,
      };
    }

    throw new GitCheckpointStageSnapshotError(
      "SNAPSHOT_FAILED",
      `Could not inspect ${JSON.stringify(path)}: ${errorMessage(error)}`,
    );
  }

  if (status.isSymbolicLink()) {
    let target: string;

    try {
      target = await readlink(candidate);
    } catch (error) {
      throw new GitCheckpointStageSnapshotError(
        "SNAPSHOT_FAILED",
        `Could not read symbolic link ${JSON.stringify(path)}: ${errorMessage(error)}`,
      );
    }

    return {
      path,
      kind: "symlink",
      sha256: sha256(target),
      size: Buffer.byteLength(target, "utf8"),
      executable: null,
    };
  }

  if (!status.isFile()) {
    throw new GitCheckpointStageSnapshotError(
      "UNSUPPORTED_PATH_TYPE",
      `Selected path ${JSON.stringify(path)} is not a regular file, symbolic link, or missing path`,
    );
  }

  let canonicalPath: string;

  try {
    canonicalPath = await realpath(candidate);
  } catch (error) {
    throw new GitCheckpointStageSnapshotError(
      "SNAPSHOT_FAILED",
      `Could not resolve ${JSON.stringify(path)}: ${errorMessage(error)}`,
    );
  }

  if (!isInsideRoot(repositoryRoot, canonicalPath)) {
    throw new GitCheckpointStageSnapshotError(
      "INVALID_SNAPSHOT_PATH",
      `Selected path ${JSON.stringify(path)} resolves outside the repository`,
    );
  }

  return {
    path,
    kind: "file",
    sha256: await hashFile(canonicalPath),
    size: status.size,
    executable: (status.mode & 0o111) !== 0,
  };
}

export async function inspectGitCheckpointStageSnapshot(
  repositoryRoot: string,
  pathspecs: string[],
): Promise<GitCheckpointStageSnapshot> {
  let canonicalRoot: string;

  try {
    canonicalRoot = await realpath(repositoryRoot);
  } catch (error) {
    throw new GitCheckpointStageSnapshotError(
      "SNAPSHOT_FAILED",
      `Could not resolve repository root: ${errorMessage(error)}`,
    );
  }

  if (pathspecs.length === 0 || new Set(pathspecs).size !== pathspecs.length) {
    throw new GitCheckpointStageSnapshotError(
      "INVALID_SNAPSHOT_PATH",
      "Stage snapshot requires unique selected pathspecs",
    );
  }

  const paths: GitCheckpointPathSnapshot[] = [];

  for (const path of pathspecs) {
    paths.push(await snapshotPath(canonicalRoot, path));
  }

  return {
    repository_root: canonicalRoot,
    paths,
    snapshot_sha256: sha256(canonicalJson(paths)),
  };
}
