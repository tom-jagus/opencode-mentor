import { realpath } from "node:fs/promises";

type GitCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

type BranchState = {
  branch: string;
  head_sha: string;
  clean: boolean;
};

export type GitFinishUpdateReceipt = {
  repository_root: string;
  branch: string;
  previous_head_sha: string;
  resulting_head_sha: string;
  base_branch: string;
  base_ref: string;
  base_commit_sha: string;
  rebased: boolean;
};

export class GitFinishUpdateMutationError extends Error {
  readonly code:
    | "INVALID_UPDATE_INPUT"
    | "UPDATE_STATE_FAILED"
    | "FETCH_FAILED"
    | "UPDATE_FAILED"
    | "UPDATE_VERIFICATION_FAILED"
    | "ROLLBACK_FAILED";

  constructor(code: GitFinishUpdateMutationError["code"], message: string) {
    super(message);
    this.name = "GitFinishUpdateMutationError";
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
    GIT_EDITOR: "true",
    GIT_SEQUENCE_EDITOR: "true",
    GIT_TERMINAL_PROMPT: "0",
    LANG: "C",
    LC_ALL: "C",
  };
}

async function runGit(
  repositoryRoot: string,
  args: string[],
  timeoutMilliseconds = 120_000,
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
      "commit.gpgSign=false",
      "-c",
      "rebase.autoStash=false",
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
      throw new GitFinishUpdateMutationError(
        "UPDATE_STATE_FAILED",
        "Git Finish Update command timed out and repository state may require inspection",
      );
    }

    if (
      Buffer.byteLength(stdout, "utf8") > 1024 * 1024 ||
      Buffer.byteLength(stderr, "utf8") > 1024 * 1024
    ) {
      throw new GitFinishUpdateMutationError(
        "UPDATE_STATE_FAILED",
        "Git Finish Update output exceeded the allowed size",
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

async function inspectBranchState(
  repositoryRoot: string,
): Promise<BranchState> {
  const [branchResult, headResult, statusResult] = await Promise.all([
    runGit(repositoryRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
    runGit(repositoryRoot, ["rev-parse", "--verify", "HEAD"]),
    runGit(repositoryRoot, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
    ]),
  ]);

  const branch = branchResult.stdout.trim();
  const headSha = headResult.stdout.trim();

  if (
    branchResult.exitCode !== 0 ||
    headResult.exitCode !== 0 ||
    statusResult.exitCode !== 0 ||
    branch.length === 0 ||
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(headSha)
  ) {
    throw new GitFinishUpdateMutationError(
      "UPDATE_STATE_FAILED",
      branchResult.stderr.trim() ||
        headResult.stderr.trim() ||
        statusResult.stderr.trim() ||
        "Could not inspect the current branch, HEAD, and working tree",
    );
  }

  return {
    branch,
    head_sha: headSha,
    clean: statusResult.stdout.length === 0,
  };
}

function validateInput(input: {
  branch: string;
  expected_head_sha: string;
  fetch_url: string;
  base_branch: string;
  base_ref: string;
  base_commit_sha: string;
}): void {
  if (
    input.branch.length === 0 ||
    input.branch.startsWith("-") ||
    input.branch.includes("\0") ||
    input.fetch_url.length === 0 ||
    input.fetch_url.startsWith("-") ||
    input.fetch_url.includes("\0") ||
    input.fetch_url.includes("\n") ||
    input.fetch_url.includes("\r") ||
    input.base_branch.length === 0 ||
    input.base_branch.startsWith("-") ||
    input.base_branch.includes("\0") ||
    input.base_ref !== `refs/heads/${input.base_branch}` ||
    input.branch === input.base_branch ||
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(input.expected_head_sha) ||
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(input.base_commit_sha)
  ) {
    throw new GitFinishUpdateMutationError(
      "INVALID_UPDATE_INPUT",
      "Finish Update mutation requires a valid non-base branch, exact commits, base ref, and safe fetch URL",
    );
  }
}

async function validateBranchNames(
  repositoryRoot: string,
  branch: string,
  baseBranch: string,
): Promise<void> {
  const [branchResult, baseResult] = await Promise.all([
    runGit(repositoryRoot, ["check-ref-format", "--branch", branch]),
    runGit(repositoryRoot, ["check-ref-format", "--branch", baseBranch]),
  ]);

  if (branchResult.exitCode !== 0 || baseResult.exitCode !== 0) {
    throw new GitFinishUpdateMutationError(
      "INVALID_UPDATE_INPUT",
      branchResult.stderr.trim() ||
        baseResult.stderr.trim() ||
        "Finish Update branch input is invalid",
    );
  }
}

async function verifyCommit(
  repositoryRoot: string,
  commitSha: string,
): Promise<void> {
  const result = await runGit(repositoryRoot, [
    "cat-file",
    "-e",
    `${commitSha}^{commit}`,
  ]);

  if (result.exitCode !== 0) {
    throw new GitFinishUpdateMutationError(
      "FETCH_FAILED",
      result.stderr.trim() ||
        "The exact reviewed remote base commit was not fetched",
    );
  }
}

async function mergeBase(
  repositoryRoot: string,
  firstCommit: string,
  secondCommit: string,
): Promise<string> {
  const result = await runGit(repositoryRoot, [
    "merge-base",
    firstCommit,
    secondCommit,
  ]);
  const value = result.stdout.trim();

  if (result.exitCode !== 0 || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value)) {
    throw new GitFinishUpdateMutationError(
      "UPDATE_STATE_FAILED",
      result.stderr.trim() ||
        "The working branch and reviewed base commit have no verifiable merge base",
    );
  }

  return value;
}

async function verifyBaseAncestry(
  repositoryRoot: string,
  baseCommitSha: string,
  resultingHeadSha: string,
): Promise<void> {
  const result = await runGit(repositoryRoot, [
    "merge-base",
    "--is-ancestor",
    baseCommitSha,
    resultingHeadSha,
  ]);

  if (result.exitCode !== 0) {
    throw new GitFinishUpdateMutationError(
      "UPDATE_VERIFICATION_FAILED",
      "The resulting branch does not contain the reviewed remote base commit",
    );
  }
}

async function abortFailedRebase(
  repositoryRoot: string,
  branch: string,
  expectedHeadSha: string,
  message: string,
): Promise<never> {
  try {
    await runGit(repositoryRoot, ["rebase", "--abort"]);
  } catch (error) {
    throw new GitFinishUpdateMutationError(
      "ROLLBACK_FAILED",
      `${message}; rebase recovery command failed: ${errorMessage(error)}`,
    );
  }

  let restored: BranchState;

  try {
    restored = await inspectBranchState(repositoryRoot);
  } catch (error) {
    throw new GitFinishUpdateMutationError(
      "ROLLBACK_FAILED",
      `${message}; rebase recovery could not be verified: ${errorMessage(error)}`,
    );
  }

  if (
    restored.branch !== branch ||
    restored.head_sha !== expectedHeadSha ||
    !restored.clean
  ) {
    throw new GitFinishUpdateMutationError(
      "ROLLBACK_FAILED",
      `${message}; rebase recovery did not restore the reviewed branch state`,
    );
  }

  throw new GitFinishUpdateMutationError("UPDATE_FAILED", message);
}

export async function rollbackGitFinishUpdate(
  receipt: GitFinishUpdateReceipt,
): Promise<void> {
  try {
    const current = await inspectBranchState(receipt.repository_root);

    if (
      current.branch !== receipt.branch ||
      current.head_sha !== receipt.resulting_head_sha ||
      !current.clean
    ) {
      throw new GitFinishUpdateMutationError(
        "ROLLBACK_FAILED",
        "Current branch, HEAD, or working tree changed after Finish Update",
      );
    }

    const result = await runGit(receipt.repository_root, [
      "reset",
      "--hard",
      receipt.previous_head_sha,
    ]);

    if (result.exitCode !== 0) {
      throw new GitFinishUpdateMutationError(
        "ROLLBACK_FAILED",
        result.stderr.trim() || "Finish Update rollback failed",
      );
    }

    const restored = await inspectBranchState(receipt.repository_root);

    if (
      restored.branch !== receipt.branch ||
      restored.head_sha !== receipt.previous_head_sha ||
      !restored.clean
    ) {
      throw new GitFinishUpdateMutationError(
        "ROLLBACK_FAILED",
        "Finish Update rollback did not restore the reviewed branch state",
      );
    }
  } catch (error) {
    if (
      error instanceof GitFinishUpdateMutationError &&
      error.code === "ROLLBACK_FAILED"
    ) {
      throw error;
    }

    throw new GitFinishUpdateMutationError(
      "ROLLBACK_FAILED",
      `Could not roll back Finish Update: ${errorMessage(error)}`,
    );
  }
}

async function failAfterRollback(
  receipt: GitFinishUpdateReceipt,
  message: string,
): Promise<never> {
  try {
    await rollbackGitFinishUpdate(receipt);
  } catch (error) {
    throw new GitFinishUpdateMutationError(
      "ROLLBACK_FAILED",
      `${message}; rollback also failed: ${errorMessage(error)}`,
    );
  }

  throw new GitFinishUpdateMutationError("UPDATE_VERIFICATION_FAILED", message);
}

export async function updateGitFinishBranch(input: {
  repository_root: string;
  branch: string;
  expected_head_sha: string;
  fetch_url: string;
  base_branch: string;
  base_ref: string;
  base_commit_sha: string;
}): Promise<GitFinishUpdateReceipt> {
  validateInput(input);

  let canonicalRoot: string;

  try {
    canonicalRoot = await realpath(input.repository_root);
  } catch (error) {
    throw new GitFinishUpdateMutationError(
      "UPDATE_STATE_FAILED",
      `Could not resolve repository root: ${errorMessage(error)}`,
    );
  }

  await validateBranchNames(canonicalRoot, input.branch, input.base_branch);

  const initial = await inspectBranchState(canonicalRoot);

  if (
    initial.branch !== input.branch ||
    initial.head_sha !== input.expected_head_sha ||
    !initial.clean
  ) {
    throw new GitFinishUpdateMutationError(
      "UPDATE_STATE_FAILED",
      "Current branch, HEAD, or working tree does not match the reviewed Finish Update proposal",
    );
  }

  const fetchResult = await runGit(canonicalRoot, [
    "fetch",
    "--no-tags",
    "--no-write-fetch-head",
    "--force",
    "--",
    input.fetch_url,
    input.base_commit_sha,
  ]);

  if (fetchResult.exitCode !== 0) {
    throw new GitFinishUpdateMutationError(
      "FETCH_FAILED",
      fetchResult.stderr.trim() ||
        "Could not fetch the exact reviewed remote base commit",
    );
  }

  await verifyCommit(canonicalRoot, input.base_commit_sha);

  const commonBase = await mergeBase(
    canonicalRoot,
    input.expected_head_sha,
    input.base_commit_sha,
  );

  let rebaseResult: GitCommandResult;

  try {
    rebaseResult = await runGit(canonicalRoot, [
      "rebase",
      "--onto",
      input.base_commit_sha,
      commonBase,
      input.branch,
    ]);
  } catch (error) {
    return await abortFailedRebase(
      canonicalRoot,
      input.branch,
      input.expected_head_sha,
      errorMessage(error),
    );
  }

  if (rebaseResult.exitCode !== 0) {
    return await abortFailedRebase(
      canonicalRoot,
      input.branch,
      input.expected_head_sha,
      rebaseResult.stderr.trim() || "Git rebase failed",
    );
  }

  let resulting: BranchState;

  try {
    resulting = await inspectBranchState(canonicalRoot);
  } catch (error) {
    throw new GitFinishUpdateMutationError(
      "ROLLBACK_FAILED",
      `Git rebase completed with an uncertain result because the resulting branch state could not be inspected: ${errorMessage(error)}`,
    );
  }

  const receipt: GitFinishUpdateReceipt = {
    repository_root: canonicalRoot,
    branch: input.branch,
    previous_head_sha: input.expected_head_sha,
    resulting_head_sha: resulting.head_sha,
    base_branch: input.base_branch,
    base_ref: input.base_ref,
    base_commit_sha: input.base_commit_sha,
    rebased: resulting.head_sha !== input.expected_head_sha,
  };

  if (resulting.branch !== input.branch || !resulting.clean) {
    return await failAfterRollback(
      receipt,
      "Finish Update changed the branch or left the working tree dirty",
    );
  }

  try {
    await verifyBaseAncestry(
      canonicalRoot,
      input.base_commit_sha,
      resulting.head_sha,
    );
  } catch (error) {
    return await failAfterRollback(receipt, errorMessage(error));
  }

  return receipt;
}
