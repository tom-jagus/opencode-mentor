import { inspectGitState, inspectLocalBranch } from "./git_state";

type GitCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type GitStartMutationResult = {
  repository_root: string;
  base_branch: string;
  target_branch: string;
  head_sha: string;
};

export type GitStartRollbackResult = {
  succeeded: boolean;
  errors: string[];
};

export class GitStartMutationError extends Error {
  readonly rollback: GitStartRollbackResult;

  constructor(message: string, rollback: GitStartRollbackResult) {
    super(message);
    this.name = "GitStartMutationError";
    this.rollback = rollback;
  }
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

function commandError(command: string, result: GitCommandResult): Error {
  return new Error(
    result.stderr.trim() || `${command} exited with code ${result.exitCode}`,
  );
}

export async function createAndSwitchGitStartBranch(input: {
  repository_root: string;
  base_branch: string;
  target_branch: string;
  head_sha: string;
}): Promise<GitStartMutationResult> {
  const result = await runGit(input.repository_root, [
    "switch",
    "--no-track",
    "-c",
    input.target_branch,
    input.head_sha,
  ]);

  if (result.exitCode !== 0) {
    throw commandError("git switch", result);
  }

  const mutation: GitStartMutationResult = {
    repository_root: input.repository_root,
    base_branch: input.base_branch,
    target_branch: input.target_branch,
    head_sha: input.head_sha,
  };

  const state = await inspectGitState(input.repository_root);

  if (
    !state.available ||
    !state.repository ||
    state.branch !== input.target_branch ||
    state.latest_commit?.sha !== input.head_sha ||
    state.clean !== true ||
    state.conflicts.length !== 0
  ) {
    const rollback = await rollbackGitStartBranch(mutation);

    throw new GitStartMutationError(
      rollback.succeeded
        ? "Created branch failed post-mutation verification and was rolled back"
        : "Created branch failed post-mutation verification and rollback failed",
      rollback,
    );
  }

  return mutation;
}

export async function rollbackGitStartBranch(
  input: GitStartMutationResult,
): Promise<GitStartRollbackResult> {
  const errors: string[] = [];

  const state = await inspectGitState(input.repository_root);

  if (
    state.available &&
    state.repository &&
    state.branch === input.target_branch
  ) {
    const switchResult = await runGit(input.repository_root, [
      "switch",
      "--detach",
      input.head_sha,
    ]);

    if (switchResult.exitCode !== 0) {
      errors.push(commandError("git switch --detach", switchResult).message);
    }
  }

  if (errors.length === 0) {
    const deleteResult = await runGit(input.repository_root, [
      "branch",
      "-D",
      "--",
      input.target_branch,
    ]);

    if (deleteResult.exitCode !== 0) {
      errors.push(commandError("git branch -D", deleteResult).message);
    }
  }

  if (errors.length === 0) {
    const restoreResult = await runGit(input.repository_root, [
      "switch",
      input.base_branch,
    ]);

    if (restoreResult.exitCode !== 0) {
      errors.push(commandError("git switch", restoreResult).message);
    }
  }

  const finalState = await inspectGitState(input.repository_root);
  const target = await inspectLocalBranch(
    input.repository_root,
    input.target_branch,
  );

  if (
    !finalState.available ||
    !finalState.repository ||
    finalState.branch !== input.base_branch ||
    finalState.latest_commit?.sha !== input.head_sha ||
    !target.available ||
    target.exists
  ) {
    errors.push("Rollback verification failed");
  }

  return {
    succeeded: errors.length === 0,
    errors,
  };
}
