import { realpath } from "node:fs/promises";

type GitCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type GitFinishUpdateRemoteInspection = {
  repository_root: string;
  remote: string;
  fetch_urls: string[];
  selected_fetch_url: string;
  base_branch: string;
  base_ref: string;
  base_commit_sha: string;
};

export type GitFinishUpdateRemoteErrorCode =
  | "INVALID_REMOTE_NAME"
  | "INVALID_BASE_BRANCH"
  | "REMOTE_INSPECTION_FAILED"
  | "REMOTE_NOT_FOUND"
  | "REMOTE_URL_UNAVAILABLE"
  | "AMBIGUOUS_FETCH_URL"
  | "REMOTE_BASE_INSPECTION_FAILED"
  | "REMOTE_BASE_NOT_FOUND"
  | "INVALID_REMOTE_REF_RESPONSE";

export class GitFinishUpdateRemoteError extends Error {
  readonly code: GitFinishUpdateRemoteErrorCode;

  constructor(code: GitFinishUpdateRemoteErrorCode, message: string) {
    super(message);
    this.name = "GitFinishUpdateRemoteError";
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
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    LANG: "C",
    LC_ALL: "C",
  };
}

async function runGit(
  repositoryRoot: string,
  args: string[],
  timeoutMilliseconds = 30_000,
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
      throw new GitFinishUpdateRemoteError(
        "REMOTE_INSPECTION_FAILED",
        "Git remote inspection timed out",
      );
    }

    if (
      Buffer.byteLength(stdout, "utf8") > 1024 * 1024 ||
      Buffer.byteLength(stderr, "utf8") > 1024 * 1024
    ) {
      throw new GitFinishUpdateRemoteError(
        "REMOTE_INSPECTION_FAILED",
        "Git remote inspection output exceeded the allowed size",
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

function validateRemoteName(remote: string): void {
  if (
    remote.length === 0 ||
    remote.startsWith("-") ||
    remote.includes("\0") ||
    remote.includes("\n") ||
    remote.includes("\r") ||
    remote.includes("..") ||
    remote.includes("@{") ||
    remote.includes("\\") ||
    remote.includes("//") ||
    remote.endsWith("/") ||
    remote.endsWith(".lock") ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(remote)
  ) {
    throw new GitFinishUpdateRemoteError(
      "INVALID_REMOTE_NAME",
      "Finish Update remote must be an explicit safe Git remote name",
    );
  }
}

async function validateBaseBranch(
  repositoryRoot: string,
  baseBranch: string,
): Promise<void> {
  if (
    baseBranch.length === 0 ||
    baseBranch.startsWith("-") ||
    baseBranch.includes("\0") ||
    baseBranch.includes("\n") ||
    baseBranch.includes("\r")
  ) {
    throw new GitFinishUpdateRemoteError(
      "INVALID_BASE_BRANCH",
      "The effective base branch is invalid",
    );
  }

  const result = await runGit(repositoryRoot, [
    "check-ref-format",
    "--branch",
    baseBranch,
  ]);

  if (result.exitCode !== 0) {
    throw new GitFinishUpdateRemoteError(
      "INVALID_BASE_BRANCH",
      result.stderr.trim() || "The effective base branch is invalid",
    );
  }
}

function nonEmptyLines(output: string): string[] {
  return output.split(/\r?\n/).filter((value) => value.length > 0);
}

async function configuredRemotes(repositoryRoot: string): Promise<string[]> {
  const result = await runGit(repositoryRoot, ["remote"]);

  if (result.exitCode !== 0) {
    throw new GitFinishUpdateRemoteError(
      "REMOTE_INSPECTION_FAILED",
      result.stderr.trim() || "Could not enumerate configured Git remotes",
    );
  }

  return nonEmptyLines(result.stdout);
}

async function fetchUrls(
  repositoryRoot: string,
  remote: string,
): Promise<string[]> {
  const result = await runGit(repositoryRoot, [
    "remote",
    "get-url",
    "--all",
    remote,
  ]);

  if (result.exitCode !== 0) {
    throw new GitFinishUpdateRemoteError(
      "REMOTE_URL_UNAVAILABLE",
      result.stderr.trim() ||
        `Could not inspect fetch URLs for remote ${JSON.stringify(remote)}`,
    );
  }

  const urls = nonEmptyLines(result.stdout);

  if (
    urls.some(
      (url) =>
        url.includes("\0") ||
        url.includes("\n") ||
        url.includes("\r") ||
        url.startsWith("-"),
    )
  ) {
    throw new GitFinishUpdateRemoteError(
      "REMOTE_URL_UNAVAILABLE",
      "Configured remote contains an unsafe fetch URL",
    );
  }

  return urls;
}

function parseRemoteBase(output: string, baseRef: string): string {
  if (output.length === 0) {
    throw new GitFinishUpdateRemoteError(
      "REMOTE_BASE_NOT_FOUND",
      `The explicit remote does not advertise ${JSON.stringify(baseRef)}`,
    );
  }

  const lines = nonEmptyLines(output);

  if (lines.length !== 1) {
    throw new GitFinishUpdateRemoteError(
      "INVALID_REMOTE_REF_RESPONSE",
      "Remote base inspection returned an unexpected number of refs",
    );
  }

  const fields = lines[0]!.split("\t");

  if (
    fields.length !== 2 ||
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(fields[0] ?? "") ||
    fields[1] !== baseRef
  ) {
    throw new GitFinishUpdateRemoteError(
      "INVALID_REMOTE_REF_RESPONSE",
      "Remote base inspection returned malformed ref data",
    );
  }

  return fields[0]!;
}

async function inspectRemoteBase(
  repositoryRoot: string,
  fetchUrl: string,
  baseRef: string,
): Promise<string> {
  const result = await runGit(repositoryRoot, [
    "ls-remote",
    "--refs",
    "--",
    fetchUrl,
    baseRef,
  ]);

  if (result.exitCode !== 0) {
    throw new GitFinishUpdateRemoteError(
      "REMOTE_BASE_INSPECTION_FAILED",
      result.stderr.trim() ||
        "Could not inspect the effective base branch on the explicit remote",
    );
  }

  return parseRemoteBase(result.stdout, baseRef);
}

export async function inspectGitFinishUpdateRemote(input: {
  repository_root: string;
  remote: string;
  base_branch: string;
}): Promise<GitFinishUpdateRemoteInspection> {
  validateRemoteName(input.remote);

  let canonicalRoot: string;

  try {
    canonicalRoot = await realpath(input.repository_root);
  } catch (error) {
    throw new GitFinishUpdateRemoteError(
      "REMOTE_INSPECTION_FAILED",
      `Could not resolve repository root: ${errorMessage(error)}`,
    );
  }

  await validateBaseBranch(canonicalRoot, input.base_branch);

  const remotes = await configuredRemotes(canonicalRoot);

  if (!remotes.includes(input.remote)) {
    throw new GitFinishUpdateRemoteError(
      "REMOTE_NOT_FOUND",
      `Explicit remote ${JSON.stringify(input.remote)} is not configured`,
    );
  }

  const urls = await fetchUrls(canonicalRoot, input.remote);

  if (urls.length === 0) {
    throw new GitFinishUpdateRemoteError(
      "REMOTE_URL_UNAVAILABLE",
      `Explicit remote ${JSON.stringify(input.remote)} has no effective fetch URL`,
    );
  }

  if (urls.length !== 1) {
    throw new GitFinishUpdateRemoteError(
      "AMBIGUOUS_FETCH_URL",
      `Explicit remote ${JSON.stringify(input.remote)} must resolve to exactly one fetch URL`,
    );
  }

  const selectedFetchUrl = urls[0]!;
  const baseRef = `refs/heads/${input.base_branch}`;
  const baseCommitSha = await inspectRemoteBase(
    canonicalRoot,
    selectedFetchUrl,
    baseRef,
  );

  return {
    repository_root: canonicalRoot,
    remote: input.remote,
    fetch_urls: urls,
    selected_fetch_url: selectedFetchUrl,
    base_branch: input.base_branch,
    base_ref: baseRef,
    base_commit_sha: baseCommitSha,
  };
}
