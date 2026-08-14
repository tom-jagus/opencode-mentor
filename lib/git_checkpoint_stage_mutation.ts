import { constants } from "node:fs";
import { copyFile, lstat, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, resolve } from "node:path";

type GitCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type GitCheckpointIndexBackup = {
  index_path: string;
  backup_path: string | null;
  index_existed: boolean;
};

export class GitCheckpointStageMutationError extends Error {
  readonly code:
    | "INVALID_STAGING_PATHS"
    | "INDEX_STATE_FAILED"
    | "STAGING_FAILED"
    | "ROLLBACK_FAILED"
    | "BACKUP_CLEANUP_FAILED";

  constructor(code: GitCheckpointStageMutationError["code"], message: string) {
    super(message);
    this.name = "GitCheckpointStageMutationError";
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

async function runGit(
  repositoryRoot: string,
  args: string[],
): Promise<GitCommandResult> {
  const process = Bun.spawn(
    [
      "git",
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.hooksPath=/dev/null",
      ...args,
    ],
    {
      cwd: repositoryRoot,
      env: {
        ...Bun.env,
        GIT_LITERAL_PATHSPECS: "1",
        GIT_TERMINAL_PROMPT: "0",
        LANG: "C",
        LC_ALL: "C",
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);

  return {
    stdout,
    stderr,
    exitCode,
  };
}

function validatePathspecs(pathspecs: string[]): void {
  if (
    pathspecs.length === 0 ||
    new Set(pathspecs).size !== pathspecs.length ||
    pathspecs.some((path) => path.length === 0 || path.includes("\0"))
  ) {
    throw new GitCheckpointStageMutationError(
      "INVALID_STAGING_PATHS",
      "Staging requires unique non-empty literal pathspecs",
    );
  }
}

async function resolveIndexPath(repositoryRoot: string): Promise<string> {
  const result = await runGit(repositoryRoot, [
    "rev-parse",
    "--git-path",
    "index",
  ]);

  if (result.exitCode !== 0) {
    throw new GitCheckpointStageMutationError(
      "INDEX_STATE_FAILED",
      result.stderr.trim() || "Could not resolve the Git index path",
    );
  }

  const value = result.stdout.trim();

  if (value.length === 0) {
    throw new GitCheckpointStageMutationError(
      "INDEX_STATE_FAILED",
      "Git returned an empty index path",
    );
  }

  return isAbsolute(value) ? value : resolve(repositoryRoot, value);
}

async function createIndexBackup(
  repositoryRoot: string,
): Promise<GitCheckpointIndexBackup> {
  const indexPath = await resolveIndexPath(repositoryRoot);
  const backupPath = resolve(
    dirname(indexPath),
    `.opencode-mentor-index-${randomUUID()}.backup`,
  );

  try {
    const status = await lstat(indexPath);

    if (status.isSymbolicLink() || !status.isFile()) {
      throw new GitCheckpointStageMutationError(
        "INDEX_STATE_FAILED",
        "Git index is not a safe regular file",
      );
    }

    await copyFile(indexPath, backupPath, constants.COPYFILE_EXCL);

    const backupStatus = await lstat(backupPath);

    if (backupStatus.isSymbolicLink() || !backupStatus.isFile()) {
      throw new GitCheckpointStageMutationError(
        "INDEX_STATE_FAILED",
        "Git index backup is not a safe regular file",
      );
    }

    return {
      index_path: indexPath,
      backup_path: backupPath,
      index_existed: true,
    };
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      return {
        index_path: indexPath,
        backup_path: null,
        index_existed: false,
      };
    }

    if (error instanceof GitCheckpointStageMutationError) {
      throw error;
    }

    throw new GitCheckpointStageMutationError(
      "INDEX_STATE_FAILED",
      `Could not back up the Git index: ${errorMessage(error)}`,
    );
  }
}

export async function rollbackGitCheckpointStage(
  backup: GitCheckpointIndexBackup,
): Promise<void> {
  try {
    if (backup.index_existed && backup.backup_path !== null) {
      await rename(backup.backup_path, backup.index_path);

      return;
    }

    try {
      await unlink(backup.index_path);
    } catch (error) {
      if (!isNodeError(error, "ENOENT")) {
        throw error;
      }
    }
  } catch (error) {
    throw new GitCheckpointStageMutationError(
      "ROLLBACK_FAILED",
      `Could not restore the Git index: ${errorMessage(error)}`,
    );
  }
}

export async function discardGitCheckpointStageBackup(
  backup: GitCheckpointIndexBackup,
): Promise<void> {
  if (backup.backup_path === null) {
    return;
  }

  try {
    await unlink(backup.backup_path);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      return;
    }

    throw new GitCheckpointStageMutationError(
      "BACKUP_CLEANUP_FAILED",
      `Could not remove the Git index backup: ${errorMessage(error)}`,
    );
  }
}

export async function stageGitCheckpointPaths(
  repositoryRoot: string,
  pathspecs: string[],
): Promise<GitCheckpointIndexBackup> {
  validatePathspecs(pathspecs);

  const backup = await createIndexBackup(repositoryRoot);

  const result = await runGit(repositoryRoot, [
    "add",
    "-A",
    "--",
    ...pathspecs,
  ]);

  if (result.exitCode === 0) {
    return backup;
  }

  try {
    await rollbackGitCheckpointStage(backup);
  } catch (rollbackError) {
    throw new GitCheckpointStageMutationError(
      "ROLLBACK_FAILED",
      `Staging failed and index rollback also failed: ${errorMessage(rollbackError)}`,
    );
  }

  throw new GitCheckpointStageMutationError(
    "STAGING_FAILED",
    result.stderr.trim() || `git add exited with code ${result.exitCode}`,
  );
}
