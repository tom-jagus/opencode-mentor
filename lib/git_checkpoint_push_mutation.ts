import { realpath } from "node:fs/promises";
import { sha256 } from "./git_lifecycle_proposal";

type GitCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type GitCheckpointPushReceipt = {
  repository_root: string;
  local_commit_sha: string;
  destination_ref: string;
  push_url_sha256: string;
  output: string;
};

export class GitCheckpointPushMutationError extends Error {
  readonly code: "INVALID_PUSH_INPUT" | "PUSH_STATE_FAILED" | "PUSH_FAILED";

  constructor(code: GitCheckpointPushMutationError["code"], message: string) {
    super(message);
    this.name = "GitCheckpointPushMutationError";
    this.code = code;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sanitizedEnvironment(): Record<string, string | undefined> {
  const environment = {
    ...Bun.env,
  };

  const exactOverrides = new Set([
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_CONFIG",
    "GIT_CONFIG_COUNT",
    "GIT_SSH_COMMAND",
    "GIT_PROXY_COMMAND",
    "GIT_ASKPASS",
    "SSH_ASKPASS",
  ]);

  for (const key of Object.keys(environment)) {
    if (exactOverrides.has(key) || /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(key)) {
      delete environment[key];
    }
  }

  return {
    ...environment,
    GIT_TERMINAL_PROMPT: "0",
    LANG: "C",
    LC_ALL: "C",
  };
}

async function runGit(
  repositoryRoot: string,
  args: string[],
  timeoutMilliseconds = 60_000,
): Promise<GitCommandResult> {
  const subprocess = Bun.spawn(
    [
      "git",
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "credential.interactive=false",
      "-c",
      "protocol.ext.allow=never",
      "-c",
      "push.autoSetupRemote=false",
      "-c",
      "push.default=nothing",
      ...args,
    ],
    {
      cwd: repositoryRoot,
      env: sanitizedEnvironment(),
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  let timedOut = false;

  const timeout = setTimeout(() => {
    timedOut = true;

    try {
      subprocess.kill();
    } catch {
      // The process may have exited concurrently.
    }
  }, timeoutMilliseconds);

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(subprocess.stdout).text(),
      new Response(subprocess.stderr).text(),
      subprocess.exited,
    ]);

    if (timedOut) {
      throw new GitCheckpointPushMutationError(
        "PUSH_STATE_FAILED",
        "Git push timed out and its remote result is uncertain",
      );
    }

    if (
      Buffer.byteLength(stdout, "utf8") > 1024 * 1024 ||
      Buffer.byteLength(stderr, "utf8") > 1024 * 1024
    ) {
      throw new GitCheckpointPushMutationError(
        "PUSH_STATE_FAILED",
        "Git push output exceeded the allowed size and its result is uncertain",
      );
    }

    return {
      stdout,
      stderr,
      exitCode,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function validateInput(
  pushUrl: string,
  localCommitSha: string,
  destinationRef: string,
): void {
  if (
    pushUrl.length === 0 ||
    pushUrl.startsWith("-") ||
    pushUrl.includes("\0") ||
    pushUrl.includes("\n") ||
    pushUrl.includes("\r") ||
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(localCommitSha) ||
    !/^refs\/heads\/.+/.test(destinationRef) ||
    destinationRef.includes("\0") ||
    destinationRef.includes("\n") ||
    destinationRef.includes("\r") ||
    destinationRef.startsWith("-")
  ) {
    throw new GitCheckpointPushMutationError(
      "INVALID_PUSH_INPUT",
      "Push mutation requires a safe URL, exact commit identifier, and full destination branch ref",
    );
  }
}

async function verifyDestinationRef(
  repositoryRoot: string,
  destinationRef: string,
): Promise<void> {
  const result = await runGit(repositoryRoot, [
    "check-ref-format",
    destinationRef,
  ]);

  if (result.exitCode !== 0) {
    throw new GitCheckpointPushMutationError(
      "INVALID_PUSH_INPUT",
      result.stderr.trim() || "Push destination ref is invalid",
    );
  }
}

async function verifyLocalCommit(
  repositoryRoot: string,
  localCommitSha: string,
): Promise<void> {
  const subprocess = Bun.spawn(
    [
      "git",
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.hooksPath=/dev/null",
      "cat-file",
      "-e",
      `${localCommitSha}^{commit}`,
    ],
    {
      cwd: repositoryRoot,
      env: sanitizedEnvironment(),
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  const [stderr, exitCode] = await Promise.all([
    new Response(subprocess.stderr).text(),
    subprocess.exited,
  ]);

  if (exitCode !== 0) {
    throw new GitCheckpointPushMutationError(
      "PUSH_STATE_FAILED",
      stderr.trim() || "The reviewed local commit is unavailable",
    );
  }
}

export async function pushGitCheckpoint(
  repositoryRoot: string,
  pushUrl: string,
  localCommitSha: string,
  destinationRef: string,
): Promise<GitCheckpointPushReceipt> {
  validateInput(pushUrl, localCommitSha, destinationRef);

  let canonicalRoot: string;

  try {
    canonicalRoot = await realpath(repositoryRoot);
  } catch (error) {
    throw new GitCheckpointPushMutationError(
      "PUSH_STATE_FAILED",
      `Could not resolve repository root: ${errorMessage(error)}`,
    );
  }

  await verifyDestinationRef(canonicalRoot, destinationRef);

  await verifyLocalCommit(canonicalRoot, localCommitSha);

  const refspec = `${localCommitSha}:${destinationRef}`;

  const result = await runGit(canonicalRoot, [
    "push",
    "--no-verify",
    "--porcelain",
    "--",
    pushUrl,
    refspec,
  ]);

  if (result.exitCode !== 0) {
    throw new GitCheckpointPushMutationError(
      "PUSH_FAILED",
      result.stderr.trim() ||
        result.stdout.trim() ||
        `git push exited with code ${result.exitCode}`,
    );
  }

  return {
    repository_root: canonicalRoot,
    local_commit_sha: localCommitSha,
    destination_ref: destinationRef,
    push_url_sha256: sha256(pushUrl),
    output: result.stdout.trim() || result.stderr.trim(),
  };
}
