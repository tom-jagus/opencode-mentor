import { realpath } from "node:fs/promises";

type GitCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type GitCheckpointPushDestination =
  | {
      exists: false;
      commit_sha: null;
    }
  | {
      exists: true;
      commit_sha: string;
    };

export type GitCheckpointPushRemoteInspection = {
  repository_root: string;
  remote: string;
  fetch_urls: string[];
  push_urls: string[];
  selected_push_url: string;
  destination_branch: string;
  destination_ref: string;
  destination: GitCheckpointPushDestination;
};

export type GitCheckpointPushRemoteErrorCode =
  | "INVALID_REMOTE_NAME"
  | "INVALID_DESTINATION_BRANCH"
  | "REMOTE_INSPECTION_FAILED"
  | "REMOTE_NOT_FOUND"
  | "REMOTE_URL_UNAVAILABLE"
  | "AMBIGUOUS_PUSH_URL"
  | "REMOTE_DESTINATION_INSPECTION_FAILED"
  | "INVALID_REMOTE_REF_RESPONSE";

export class GitCheckpointPushRemoteError extends Error {
  readonly code: GitCheckpointPushRemoteErrorCode;

  constructor(code: GitCheckpointPushRemoteErrorCode, message: string) {
    super(message);
    this.name = "GitCheckpointPushRemoteError";
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
      throw new GitCheckpointPushRemoteError(
        "REMOTE_INSPECTION_FAILED",
        "Git remote inspection timed out",
      );
    }

    if (
      Buffer.byteLength(stdout, "utf8") > 1024 * 1024 ||
      Buffer.byteLength(stderr, "utf8") > 1024 * 1024
    ) {
      throw new GitCheckpointPushRemoteError(
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
    throw new GitCheckpointPushRemoteError(
      "INVALID_REMOTE_NAME",
      "Push remote must be an explicit safe Git remote name",
    );
  }
}

async function validateDestinationBranch(
  repositoryRoot: string,
  destinationBranch: string,
): Promise<void> {
  if (
    destinationBranch.length === 0 ||
    destinationBranch.startsWith("-") ||
    destinationBranch.includes("\0") ||
    destinationBranch.includes("\n") ||
    destinationBranch.includes("\r")
  ) {
    throw new GitCheckpointPushRemoteError(
      "INVALID_DESTINATION_BRANCH",
      "Push destination branch is invalid",
    );
  }

  const result = await runGit(repositoryRoot, [
    "check-ref-format",
    "--branch",
    destinationBranch,
  ]);

  if (result.exitCode !== 0) {
    throw new GitCheckpointPushRemoteError(
      "INVALID_DESTINATION_BRANCH",
      result.stderr.trim() || "Push destination branch is invalid",
    );
  }
}

function nonEmptyLines(output: string): string[] {
  return output.split(/\r?\n/).filter((value) => value.length > 0);
}

async function configuredRemotes(repositoryRoot: string): Promise<string[]> {
  const result = await runGit(repositoryRoot, ["remote"]);

  if (result.exitCode !== 0) {
    throw new GitCheckpointPushRemoteError(
      "REMOTE_INSPECTION_FAILED",
      result.stderr.trim() || "Could not enumerate configured Git remotes",
    );
  }

  return nonEmptyLines(result.stdout);
}

async function remoteUrls(
  repositoryRoot: string,
  remote: string,
  push: boolean,
): Promise<string[]> {
  const result = await runGit(repositoryRoot, [
    "remote",
    "get-url",
    ...(push ? ["--push"] : []),
    "--all",
    remote,
  ]);

  if (result.exitCode !== 0) {
    throw new GitCheckpointPushRemoteError(
      "REMOTE_URL_UNAVAILABLE",
      result.stderr.trim() ||
        `Could not inspect URLs for remote ${JSON.stringify(remote)}`,
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
    throw new GitCheckpointPushRemoteError(
      "REMOTE_URL_UNAVAILABLE",
      "Configured remote contains an unsafe URL",
    );
  }

  return urls;
}

function parseDestination(
  output: string,
  destinationRef: string,
): GitCheckpointPushDestination {
  if (output.length === 0) {
    return {
      exists: false,
      commit_sha: null,
    };
  }

  const lines = nonEmptyLines(output);

  if (lines.length !== 1) {
    throw new GitCheckpointPushRemoteError(
      "INVALID_REMOTE_REF_RESPONSE",
      "Remote destination inspection returned an unexpected number of refs",
    );
  }

  const fields = lines[0]!.split("\t");

  if (
    fields.length !== 2 ||
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(fields[0] ?? "") ||
    fields[1] !== destinationRef
  ) {
    throw new GitCheckpointPushRemoteError(
      "INVALID_REMOTE_REF_RESPONSE",
      "Remote destination inspection returned malformed ref data",
    );
  }

  return {
    exists: true,
    commit_sha: fields[0]!,
  };
}

async function inspectDestination(
  repositoryRoot: string,
  pushUrl: string,
  destinationRef: string,
): Promise<GitCheckpointPushDestination> {
  const result = await runGit(repositoryRoot, [
    "ls-remote",
    "--refs",
    "--",
    pushUrl,
    destinationRef,
  ]);

  if (result.exitCode !== 0) {
    throw new GitCheckpointPushRemoteError(
      "REMOTE_DESTINATION_INSPECTION_FAILED",
      result.stderr.trim() ||
        "Could not inspect the explicit remote destination",
    );
  }

  return parseDestination(result.stdout, destinationRef);
}

export async function inspectGitCheckpointPushRemote(input: {
  repository_root: string;
  remote: string;
  destination_branch: string;
}): Promise<GitCheckpointPushRemoteInspection> {
  validateRemoteName(input.remote);

  let canonicalRoot: string;

  try {
    canonicalRoot = await realpath(input.repository_root);
  } catch (error) {
    throw new GitCheckpointPushRemoteError(
      "REMOTE_INSPECTION_FAILED",
      `Could not resolve repository root: ${errorMessage(error)}`,
    );
  }

  await validateDestinationBranch(canonicalRoot, input.destination_branch);

  const remotes = await configuredRemotes(canonicalRoot);

  if (!remotes.includes(input.remote)) {
    throw new GitCheckpointPushRemoteError(
      "REMOTE_NOT_FOUND",
      `Explicit remote ${JSON.stringify(input.remote)} is not configured`,
    );
  }

  const [fetchUrls, pushUrls] = await Promise.all([
    remoteUrls(canonicalRoot, input.remote, false),
    remoteUrls(canonicalRoot, input.remote, true),
  ]);

  if (pushUrls.length === 0) {
    throw new GitCheckpointPushRemoteError(
      "REMOTE_URL_UNAVAILABLE",
      `Explicit remote ${JSON.stringify(input.remote)} has no effective push URL`,
    );
  }

  if (pushUrls.length !== 1) {
    throw new GitCheckpointPushRemoteError(
      "AMBIGUOUS_PUSH_URL",
      `Explicit remote ${JSON.stringify(input.remote)} must resolve to exactly one push URL`,
    );
  }

  const selectedPushUrl = pushUrls[0]!;
  const destinationRef = `refs/heads/${input.destination_branch}`;

  const destination = await inspectDestination(
    canonicalRoot,
    selectedPushUrl,
    destinationRef,
  );

  return {
    repository_root: canonicalRoot,
    remote: input.remote,
    fetch_urls: fetchUrls,
    push_urls: pushUrls,
    selected_push_url: selectedPushUrl,
    destination_branch: input.destination_branch,
    destination_ref: destinationRef,
    destination,
  };
}

export async function inspectGitCheckpointPushUrlDestination(input: {
  repository_root: string;
  push_url: string;
  destination_ref: string;
}): Promise<{
  repository_root: string;
  push_url: string;
  destination_ref: string;
  destination: GitCheckpointPushDestination;
}> {
  if (
    input.push_url.length === 0 ||
    input.push_url.startsWith("-") ||
    input.push_url.includes("\0") ||
    input.push_url.includes("\n") ||
    input.push_url.includes("\r") ||
    !input.destination_ref.startsWith("refs/heads/") ||
    input.destination_ref.includes("\0") ||
    input.destination_ref.includes("\n") ||
    input.destination_ref.includes("\r")
  ) {
    throw new GitCheckpointPushRemoteError(
      "REMOTE_DESTINATION_INSPECTION_FAILED",
      "Exact Push destination inspection received invalid input",
    );
  }

  let canonicalRoot: string;

  try {
    canonicalRoot = await realpath(input.repository_root);
  } catch (error) {
    throw new GitCheckpointPushRemoteError(
      "REMOTE_DESTINATION_INSPECTION_FAILED",
      `Could not resolve repository root: ${errorMessage(error)}`,
    );
  }

  const refValidation = await runGit(canonicalRoot, [
    "check-ref-format",
    input.destination_ref,
  ]);

  if (refValidation.exitCode !== 0) {
    throw new GitCheckpointPushRemoteError(
      "REMOTE_DESTINATION_INSPECTION_FAILED",
      refValidation.stderr.trim() || "Exact Push destination ref is invalid",
    );
  }

  const destination = await inspectDestination(
    canonicalRoot,
    input.push_url,
    input.destination_ref,
  );

  return {
    repository_root: canonicalRoot,
    push_url: input.push_url,
    destination_ref: input.destination_ref,
    destination,
  };
}
