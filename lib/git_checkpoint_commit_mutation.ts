import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

type GitCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

type BranchAndHead = {
  branch: string;
  head_sha: string;
};

export type GitCheckpointCommitReceipt = {
  repository_root: string;
  branch: string;
  previous_head_sha: string;
  commit_sha: string;
};

export class GitCheckpointCommitMutationError extends Error {
  readonly code:
    | "INVALID_COMMIT_INPUT"
    | "COMMIT_STATE_FAILED"
    | "COMMIT_FAILED"
    | "COMMIT_VERIFICATION_FAILED"
    | "ROLLBACK_FAILED";

  constructor(code: GitCheckpointCommitMutationError["code"], message: string) {
    super(message);
    this.name = "GitCheckpointCommitMutationError";
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
      "commit.gpgSign=false",
      "-c",
      "commit.cleanup=verbatim",
      ...args,
    ],
    {
      cwd: repositoryRoot,
      env: {
        ...Bun.env,
        GIT_EDITOR: "true",
        GIT_SEQUENCE_EDITOR: "true",
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

async function inspectBranchAndHead(
  repositoryRoot: string,
): Promise<BranchAndHead> {
  const [branchResult, headResult] = await Promise.all([
    runGit(repositoryRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
    runGit(repositoryRoot, ["rev-parse", "--verify", "HEAD"]),
  ]);

  if (branchResult.exitCode !== 0 || headResult.exitCode !== 0) {
    throw new GitCheckpointCommitMutationError(
      "COMMIT_STATE_FAILED",
      branchResult.stderr.trim() ||
        headResult.stderr.trim() ||
        "Could not inspect the current branch and HEAD",
    );
  }

  const branch = branchResult.stdout.trim();
  const headSha = headResult.stdout.trim();

  if (branch.length === 0 || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(headSha)) {
    throw new GitCheckpointCommitMutationError(
      "COMMIT_STATE_FAILED",
      "Git returned invalid branch or HEAD state",
    );
  }

  return {
    branch,
    head_sha: headSha,
  };
}

async function inspectCommitParents(
  repositoryRoot: string,
  commitSha: string,
): Promise<string[]> {
  const result = await runGit(repositoryRoot, [
    "rev-list",
    "--parents",
    "-n",
    "1",
    commitSha,
  ]);

  if (result.exitCode !== 0) {
    throw new GitCheckpointCommitMutationError(
      "COMMIT_VERIFICATION_FAILED",
      result.stderr.trim() || "Could not inspect the created commit parents",
    );
  }

  const values = result.stdout.trim().split(/\s+/);

  if (values[0] !== commitSha) {
    throw new GitCheckpointCommitMutationError(
      "COMMIT_VERIFICATION_FAILED",
      "Git returned inconsistent commit-parent state",
    );
  }

  return values.slice(1);
}

async function inspectRawCommitMessage(
  repositoryRoot: string,
  commitSha: string,
): Promise<string> {
  const result = await runGit(repositoryRoot, [
    "cat-file",
    "commit",
    commitSha,
  ]);

  if (result.exitCode !== 0) {
    throw new GitCheckpointCommitMutationError(
      "COMMIT_VERIFICATION_FAILED",
      result.stderr.trim() || "Could not inspect the created commit object",
    );
  }

  const separator = result.stdout.indexOf("\n\n");

  if (separator < 0) {
    throw new GitCheckpointCommitMutationError(
      "COMMIT_VERIFICATION_FAILED",
      "Created commit object does not contain a message separator",
    );
  }

  return result.stdout.slice(separator + 2);
}

export async function rollbackGitCheckpointCommit(
  receipt: GitCheckpointCommitReceipt,
): Promise<void> {
  try {
    const current = await inspectBranchAndHead(receipt.repository_root);

    if (
      current.branch !== receipt.branch ||
      current.head_sha !== receipt.commit_sha
    ) {
      throw new GitCheckpointCommitMutationError(
        "ROLLBACK_FAILED",
        "Current branch or HEAD changed after the checkpoint commit",
      );
    }

    const result = await runGit(receipt.repository_root, [
      "update-ref",
      `refs/heads/${receipt.branch}`,
      receipt.previous_head_sha,
      receipt.commit_sha,
    ]);

    if (result.exitCode !== 0) {
      throw new GitCheckpointCommitMutationError(
        "ROLLBACK_FAILED",
        result.stderr.trim() || "Conditional branch rollback failed",
      );
    }

    const restored = await inspectBranchAndHead(receipt.repository_root);

    if (
      restored.branch !== receipt.branch ||
      restored.head_sha !== receipt.previous_head_sha
    ) {
      throw new GitCheckpointCommitMutationError(
        "ROLLBACK_FAILED",
        "Checkpoint rollback did not restore the reviewed branch and HEAD",
      );
    }
  } catch (error) {
    if (
      error instanceof GitCheckpointCommitMutationError &&
      error.code === "ROLLBACK_FAILED"
    ) {
      throw error;
    }

    throw new GitCheckpointCommitMutationError(
      "ROLLBACK_FAILED",
      `Could not roll back checkpoint commit: ${errorMessage(error)}`,
    );
  }
}

async function failAfterRollback(
  receipt: GitCheckpointCommitReceipt,
  code: "COMMIT_FAILED" | "COMMIT_VERIFICATION_FAILED",
  message: string,
): Promise<never> {
  try {
    await rollbackGitCheckpointCommit(receipt);
  } catch (error) {
    throw new GitCheckpointCommitMutationError(
      "ROLLBACK_FAILED",
      `${message}; rollback also failed: ${errorMessage(error)}`,
    );
  }

  throw new GitCheckpointCommitMutationError(code, message);
}

function validateInput(
  branch: string,
  expectedHeadSha: string,
  commitMessage: string,
): void {
  if (
    branch.length === 0 ||
    branch.includes("\0") ||
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(expectedHeadSha) ||
    commitMessage.length === 0 ||
    commitMessage.includes("\0") ||
    commitMessage.includes("\r") ||
    commitMessage.endsWith("\n")
  ) {
    throw new GitCheckpointCommitMutationError(
      "INVALID_COMMIT_INPUT",
      "Commit mutation requires a named branch, valid expected HEAD, and canonical non-empty message",
    );
  }
}

export async function commitGitCheckpoint(
  repositoryRoot: string,
  branch: string,
  expectedHeadSha: string,
  commitMessage: string,
): Promise<GitCheckpointCommitReceipt> {
  validateInput(branch, expectedHeadSha, commitMessage);

  let canonicalRoot: string;

  try {
    canonicalRoot = await realpath(repositoryRoot);
  } catch (error) {
    throw new GitCheckpointCommitMutationError(
      "COMMIT_STATE_FAILED",
      `Could not resolve repository root: ${errorMessage(error)}`,
    );
  }

  const initial = await inspectBranchAndHead(canonicalRoot);

  if (initial.branch !== branch || initial.head_sha !== expectedHeadSha) {
    throw new GitCheckpointCommitMutationError(
      "COMMIT_STATE_FAILED",
      "Current branch or HEAD does not match the reviewed Commit proposal",
    );
  }

  const messageDirectory = await mkdtemp(
    join(tmpdir(), "opencode-mentor-commit-message-"),
  );
  const messagePath = join(messageDirectory, "message.txt");

  try {
    await writeFile(messagePath, `${commitMessage}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });

    const commitResult = await runGit(canonicalRoot, [
      "commit",
      "--no-verify",
      "--no-gpg-sign",
      "--cleanup=verbatim",
      "--file",
      messagePath,
    ]);

    let resulting: BranchAndHead;

    try {
      resulting = await inspectBranchAndHead(canonicalRoot);
    } catch (error) {
      throw new GitCheckpointCommitMutationError(
        "ROLLBACK_FAILED",
        `Git commit completed with an uncertain result because resulting branch and HEAD state could not be inspected: ${errorMessage(error)}`,
      );
    }

    if (resulting.head_sha === expectedHeadSha) {
      throw new GitCheckpointCommitMutationError(
        "COMMIT_FAILED",
        commitResult.stderr.trim() ||
          commitResult.stdout.trim() ||
          `git commit exited with code ${commitResult.exitCode}`,
      );
    }

    const receipt: GitCheckpointCommitReceipt = {
      repository_root: canonicalRoot,
      branch,
      previous_head_sha: expectedHeadSha,
      commit_sha: resulting.head_sha,
    };

    if (commitResult.exitCode !== 0) {
      return await failAfterRollback(
        receipt,
        "COMMIT_FAILED",
        commitResult.stderr.trim() ||
          `git commit exited with code ${commitResult.exitCode}`,
      );
    }

    if (resulting.branch !== branch) {
      return await failAfterRollback(
        receipt,
        "COMMIT_VERIFICATION_FAILED",
        "Current branch changed during checkpoint commit",
      );
    }

    try {
      const parents = await inspectCommitParents(
        canonicalRoot,
        receipt.commit_sha,
      );

      if (parents.length !== 1 || parents[0] !== expectedHeadSha) {
        throw new GitCheckpointCommitMutationError(
          "COMMIT_VERIFICATION_FAILED",
          "Created checkpoint is not a single-parent child of the reviewed HEAD",
        );
      }

      const rawMessage = await inspectRawCommitMessage(
        canonicalRoot,
        receipt.commit_sha,
      );

      if (rawMessage !== `${commitMessage}\n`) {
        throw new GitCheckpointCommitMutationError(
          "COMMIT_VERIFICATION_FAILED",
          "Created commit message differs from the reviewed message",
        );
      }
    } catch (error) {
      return await failAfterRollback(
        receipt,
        "COMMIT_VERIFICATION_FAILED",
        errorMessage(error),
      );
    }

    return receipt;
  } finally {
    try {
      await rm(messageDirectory, {
        recursive: true,
        force: true,
      });
    } catch {
      // Private temporary-message cleanup must not hide
      // the result of an already completed Git mutation.
    }
  }
}
