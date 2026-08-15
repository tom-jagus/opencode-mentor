import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

type GitCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type GitCheckpointOperationState = {
  repository_root: string;
  active_operations: string[];
};

export class GitCheckpointOperationStateError extends Error {
  readonly code = "OPERATION_STATE_INSPECTION_FAILED";

  constructor(message: string) {
    super(message);
    this.name = "GitCheckpointOperationStateError";
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
  const subprocess = Bun.spawn(
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
        GIT_OPTIONAL_LOCKS: "0",
        GIT_TERMINAL_PROMPT: "0",
        LANG: "C",
        LC_ALL: "C",
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
    subprocess.exited,
  ]);

  return {
    stdout,
    stderr,
    exitCode,
  };
}

async function refExists(
  repositoryRoot: string,
  ref: string,
): Promise<boolean> {
  const result = await runGit(repositoryRoot, [
    "rev-parse",
    "--verify",
    "--quiet",
    ref,
  ]);

  if (result.exitCode === 0) {
    return true;
  }

  if (result.exitCode === 1) {
    return false;
  }

  throw new GitCheckpointOperationStateError(
    result.stderr.trim() || `Could not inspect Git operation ref ${ref}`,
  );
}

async function gitPathExists(
  repositoryRoot: string,
  name: string,
): Promise<boolean> {
  const result = await runGit(repositoryRoot, [
    "rev-parse",
    "--git-path",
    name,
  ]);

  if (result.exitCode !== 0) {
    throw new GitCheckpointOperationStateError(
      result.stderr.trim() || `Could not resolve Git operation path ${name}`,
    );
  }

  const value = result.stdout.trim();

  if (value.length === 0) {
    throw new GitCheckpointOperationStateError(
      `Git returned an empty operation path for ${name}`,
    );
  }

  const path = isAbsolute(value) ? value : resolve(repositoryRoot, value);

  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      return false;
    }

    throw new GitCheckpointOperationStateError(
      `Could not inspect Git operation path ${name}: ${errorMessage(error)}`,
    );
  }
}

export async function inspectGitCheckpointOperationState(
  repositoryRoot: string,
): Promise<GitCheckpointOperationState> {
  let canonicalRoot: string;

  try {
    canonicalRoot = await realpath(repositoryRoot);
  } catch (error) {
    throw new GitCheckpointOperationStateError(
      `Could not resolve repository root: ${errorMessage(error)}`,
    );
  }

  const activeOperations: string[] = [];

  const refChecks = [
    ["merge", "MERGE_HEAD"],
    ["cherry-pick", "CHERRY_PICK_HEAD"],
    ["revert", "REVERT_HEAD"],
  ] as const;

  for (const [operation, ref] of refChecks) {
    if (await refExists(canonicalRoot, ref)) {
      activeOperations.push(operation);
    }
  }

  const pathChecks = [
    ["rebase", "rebase-merge"],
    ["rebase", "rebase-apply"],
    ["sequencer", "sequencer"],
  ] as const;

  for (const [operation, path] of pathChecks) {
    if (
      (await gitPathExists(canonicalRoot, path)) &&
      !activeOperations.includes(operation)
    ) {
      activeOperations.push(operation);
    }
  }

  return {
    repository_root: canonicalRoot,
    active_operations: activeOperations,
  };
}
