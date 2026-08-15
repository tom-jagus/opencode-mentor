import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";

type GitCommandResult = {
  stdout: Uint8Array;
  stderr: string;
  exitCode: number;
};

export type GitCheckpointCommitDiff = {
  repository_root: string;
  patch: string;
  patch_bytes: number;
  patch_sha256: string;
};

export class GitCheckpointCommitDiffError extends Error {
  readonly code:
    | "DIFF_INSPECTION_FAILED"
    | "INVALID_DIFF_ENCODING"
    | "EMPTY_STAGED_DIFF"
    | "EMPTY_COMMIT_DIFF";

  constructor(code: GitCheckpointCommitDiffError["code"], message: string) {
    super(message);
    this.name = "GitCheckpointCommitDiffError";
    this.code = code;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
      "-c",
      "core.quotePath=true",
      "-c",
      "color.ui=false",
      "-c",
      "diff.renames=false",
      "-c",
      "diff.algorithm=myers",
      "-c",
      "diff.indentHeuristic=false",
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

  const [stdoutBuffer, stderr, exitCode] = await Promise.all([
    new Response(subprocess.stdout).arrayBuffer(),
    new Response(subprocess.stderr).text(),
    subprocess.exited,
  ]);

  return {
    stdout: new Uint8Array(stdoutBuffer),
    stderr,
    exitCode,
  };
}

async function inspectDiff(
  repositoryRoot: string,
  comparisonArgs: string[],
  emptyCode: "EMPTY_STAGED_DIFF" | "EMPTY_COMMIT_DIFF",
  emptyMessage: string,
): Promise<GitCheckpointCommitDiff> {
  let canonicalRoot: string;

  try {
    canonicalRoot = await realpath(repositoryRoot);
  } catch (error) {
    throw new GitCheckpointCommitDiffError(
      "DIFF_INSPECTION_FAILED",
      `Could not resolve repository root: ${errorMessage(error)}`,
    );
  }

  const result = await runGit(canonicalRoot, [
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    "--binary",
    "--full-index",
    "--no-renames",
    "--diff-algorithm=myers",
    "--no-indent-heuristic",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    ...comparisonArgs,
    "--",
  ]);

  if (result.exitCode !== 0) {
    throw new GitCheckpointCommitDiffError(
      "DIFF_INSPECTION_FAILED",
      result.stderr.trim() || `git diff exited with code ${result.exitCode}`,
    );
  }

  if (result.stdout.byteLength === 0) {
    throw new GitCheckpointCommitDiffError(emptyCode, emptyMessage);
  }

  let patch: string;

  try {
    patch = new TextDecoder("utf-8", {
      fatal: true,
    }).decode(result.stdout);
  } catch (error) {
    throw new GitCheckpointCommitDiffError(
      "INVALID_DIFF_ENCODING",
      `The Git diff is not valid UTF-8: ${errorMessage(error)}`,
    );
  }

  return {
    repository_root: canonicalRoot,
    patch,
    patch_bytes: result.stdout.byteLength,
    patch_sha256: createHash("sha256").update(result.stdout).digest("hex"),
  };
}

export async function inspectGitCheckpointCommitDiff(
  repositoryRoot: string,
): Promise<GitCheckpointCommitDiff> {
  return inspectDiff(
    repositoryRoot,
    ["--cached"],
    "EMPTY_STAGED_DIFF",
    "There is no staged diff to commit",
  );
}

export async function inspectGitCheckpointCommittedDiff(
  repositoryRoot: string,
  previousHeadSha: string,
  commitSha: string,
): Promise<GitCheckpointCommitDiff> {
  if (
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(previousHeadSha) ||
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(commitSha)
  ) {
    throw new GitCheckpointCommitDiffError(
      "DIFF_INSPECTION_FAILED",
      "Committed diff inspection requires valid Git object identifiers",
    );
  }

  return inspectDiff(
    repositoryRoot,
    [previousHeadSha, commitSha],
    "EMPTY_COMMIT_DIFF",
    "The created checkpoint commit contains no diff",
  );
}
