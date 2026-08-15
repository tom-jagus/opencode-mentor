import type { EffectiveGitPolicyResolution, GitPolicy } from "./git_policy";
import { resolveEffectiveGitPolicy } from "./git_policy";
import type { GitRepositoryState, GitState } from "./git_state";
import { inspectGitState } from "./git_state";
import {
  GitCheckpointOperationStateError,
  inspectGitCheckpointOperationState,
} from "./git_checkpoint_operation_state";
import type {
  GitCheckpointPushRemoteErrorCode,
  GitCheckpointPushRemoteInspection,
} from "./git_checkpoint_push_remote";
import {
  GitCheckpointPushRemoteError,
  inspectGitCheckpointPushRemote,
} from "./git_checkpoint_push_remote";
import { validateWorkingBranchName } from "./git_validation";

type GitCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type GitCheckpointPushDisposition =
  "create" | "up-to-date" | "fast-forward" | "non-fast-forward" | "unavailable";

export type GitCheckpointPushIssueCode =
  | "DETACHED_HEAD"
  | "UNBORN_HEAD"
  | "HEAD_UNAVAILABLE"
  | "ON_PROTECTED_BASE_BRANCH"
  | "CURRENT_BRANCH_INVALID"
  | "LOCAL_COMMIT_INVALID"
  | "LOCAL_COMMIT_MISMATCH"
  | "DESTINATION_PROTECTED"
  | "DESTINATION_BRANCH_INVALID"
  | "ACTIVE_GIT_OPERATION"
  | "NON_FAST_FORWARD"
  | "ANCESTRY_UNAVAILABLE";

export type GitCheckpointPushIssue = {
  code: GitCheckpointPushIssueCode;
  message: string;
};

export type GitCheckpointPushPlan = {
  eligible: boolean;
  repository_root: string;
  base_branch: string;
  current_branch: string | null;
  local_commit_sha: string;
  remote: string;
  remote_push_url: string | null;
  destination_branch: string;
  destination_ref: string | null;
  remote_commit_sha: string | null;
  disposition: GitCheckpointPushDisposition;
  issues: GitCheckpointPushIssue[];
};

export type GitCheckpointPushPreflightInput = {
  directory: string;
  configuration_root: string;
  local_commit_sha: string;
  remote: string;
  destination_branch: string;
};

export type GitCheckpointPushPreflight =
  | {
      ok: true;
      state: GitRepositoryState;
      policy_resolution: EffectiveGitPolicyResolution;
      push_plan: GitCheckpointPushPlan;
      remote_inspection: GitCheckpointPushRemoteInspection | null;
    }
  | {
      ok: false;
      stage: "repository";
      state: GitState;
      error: {
        code: "GIT_UNAVAILABLE" | "NOT_GIT_REPOSITORY";
        message: string;
      };
    }
  | {
      ok: false;
      stage: "operation";
      state: GitRepositoryState;
      policy_resolution: EffectiveGitPolicyResolution;
      error: {
        code: "OPERATION_STATE_INSPECTION_FAILED";
        message: string;
      };
    }
  | {
      ok: false;
      stage: "remote";
      state: GitRepositoryState;
      policy_resolution: EffectiveGitPolicyResolution;
      error: {
        code: GitCheckpointPushRemoteErrorCode;
        message: string;
      };
    };

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

async function localBranchCommit(
  repositoryRoot: string,
  branch: string,
): Promise<string | null> {
  const result = await runGit(repositoryRoot, [
    "rev-parse",
    "--verify",
    `refs/heads/${branch}`,
  ]);

  if (result.exitCode !== 0) {
    return null;
  }

  const value = result.stdout.trim();

  return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value) ? value : null;
}

async function commitExists(
  repositoryRoot: string,
  commitSha: string,
): Promise<boolean> {
  const result = await runGit(repositoryRoot, [
    "cat-file",
    "-e",
    `${commitSha}^{commit}`,
  ]);

  return result.exitCode === 0;
}

async function classifyAncestry(
  repositoryRoot: string,
  remoteCommitSha: string,
  localCommitSha: string,
): Promise<"fast-forward" | "non-fast-forward" | "unavailable"> {
  const result = await runGit(repositoryRoot, [
    "merge-base",
    "--is-ancestor",
    remoteCommitSha,
    localCommitSha,
  ]);

  if (result.exitCode === 0) {
    return "fast-forward";
  }

  if (result.exitCode === 1) {
    return "non-fast-forward";
  }

  return "unavailable";
}

function initialPlan(
  state: GitRepositoryState,
  policy: GitPolicy,
  input: GitCheckpointPushPreflightInput,
): GitCheckpointPushPlan {
  const issues: GitCheckpointPushIssue[] = [];

  if (state.detached) {
    issues.push({
      code: "DETACHED_HEAD",
      message: "A checkpoint cannot be pushed from detached HEAD",
    });
  }

  if (state.unborn) {
    issues.push({
      code: "UNBORN_HEAD",
      message:
        "A checkpoint cannot be pushed before the repository has an initial commit",
    });
  }

  if (state.latest_commit === null) {
    issues.push({
      code: "HEAD_UNAVAILABLE",
      message: "The current HEAD commit could not be determined",
    });
  }

  if (state.branch === policy.base_branch) {
    issues.push({
      code: "ON_PROTECTED_BASE_BRANCH",
      message: `A checkpoint cannot be pushed directly from the effective base branch ${JSON.stringify(policy.base_branch)}`,
    });
  } else if (state.branch === null) {
    issues.push({
      code: "CURRENT_BRANCH_INVALID",
      message: "The current working branch could not be determined",
    });
  } else {
    const validation = validateWorkingBranchName(state.branch, policy);

    if (!validation.valid) {
      issues.push({
        code: "CURRENT_BRANCH_INVALID",
        message: validation.issues.map((issue) => issue.message).join("; "),
      });
    }
  }

  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(input.local_commit_sha)) {
    issues.push({
      code: "LOCAL_COMMIT_INVALID",
      message:
        "Push requires the exact valid commit identifier returned by Commit Apply",
    });
  }

  if (state.latest_commit?.sha !== input.local_commit_sha) {
    issues.push({
      code: "LOCAL_COMMIT_MISMATCH",
      message:
        "Current HEAD does not match the explicitly supplied local commit",
    });
  }

  if (input.destination_branch === policy.base_branch) {
    issues.push({
      code: "DESTINATION_PROTECTED",
      message: `A checkpoint cannot push directly to the effective base branch ${JSON.stringify(policy.base_branch)}`,
    });
  }

  const destinationValidation = validateWorkingBranchName(
    input.destination_branch,
    policy,
  );

  if (!destinationValidation.valid) {
    issues.push({
      code: "DESTINATION_BRANCH_INVALID",
      message: destinationValidation.issues
        .map((issue) => issue.message)
        .join("; "),
    });
  }

  return {
    eligible: false,
    repository_root: state.root,
    base_branch: policy.base_branch,
    current_branch: state.branch,
    local_commit_sha: input.local_commit_sha,
    remote: input.remote,
    remote_push_url: null,
    destination_branch: input.destination_branch,
    destination_ref: null,
    remote_commit_sha: null,
    disposition: "unavailable",
    issues,
  };
}

export async function runGitCheckpointPushPreflight(
  input: GitCheckpointPushPreflightInput,
): Promise<GitCheckpointPushPreflight> {
  const state = await inspectGitState(input.directory);

  if (!state.available) {
    return {
      ok: false,
      stage: "repository",
      state,
      error: {
        code: "GIT_UNAVAILABLE",
        message: `Git inspection failed: ${state.error}`,
      },
    };
  }

  if (!state.repository) {
    return {
      ok: false,
      stage: "repository",
      state,
      error: {
        code: "NOT_GIT_REPOSITORY",
        message: "The current workspace is not inside a Git repository",
      },
    };
  }

  const policyResolution = await resolveEffectiveGitPolicy(
    state.root,
    input.configuration_root,
  );

  let pushPlan = initialPlan(state, policyResolution.effective_policy, input);

  if (
    state.branch !== null &&
    /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(input.local_commit_sha)
  ) {
    const [branchCommit, localCommitExists] = await Promise.all([
      localBranchCommit(state.root, state.branch),
      commitExists(state.root, input.local_commit_sha),
    ]);

    if (!localCommitExists || branchCommit !== input.local_commit_sha) {
      pushPlan = {
        ...pushPlan,
        issues: [
          ...pushPlan.issues,
          {
            code: "LOCAL_COMMIT_MISMATCH",
            message:
              "The supplied commit is not the exact current local branch tip",
          },
        ],
      };
    }
  }

  try {
    const operationState = await inspectGitCheckpointOperationState(state.root);

    if (operationState.active_operations.length > 0) {
      pushPlan = {
        ...pushPlan,
        issues: [
          ...pushPlan.issues,
          {
            code: "ACTIVE_GIT_OPERATION",
            message: `A checkpoint cannot be pushed during an active Git operation: ${operationState.active_operations.join(", ")}`,
          },
        ],
      };
    }
  } catch (error) {
    if (error instanceof GitCheckpointOperationStateError) {
      return {
        ok: false,
        stage: "operation",
        state,
        policy_resolution: policyResolution,
        error: {
          code: error.code,
          message: error.message,
        },
      };
    }

    throw error;
  }

  if (pushPlan.issues.length > 0) {
    return {
      ok: true,
      state,
      policy_resolution: policyResolution,
      push_plan: pushPlan,
      remote_inspection: null,
    };
  }

  let remoteInspection: GitCheckpointPushRemoteInspection;

  try {
    remoteInspection = await inspectGitCheckpointPushRemote({
      repository_root: state.root,
      remote: input.remote,
      destination_branch: input.destination_branch,
    });
  } catch (error) {
    if (error instanceof GitCheckpointPushRemoteError) {
      return {
        ok: false,
        stage: "remote",
        state,
        policy_resolution: policyResolution,
        error: {
          code: error.code,
          message: error.message,
        },
      };
    }

    throw error;
  }

  let disposition: GitCheckpointPushDisposition;
  const remoteCommitSha = remoteInspection.destination.commit_sha;

  if (!remoteInspection.destination.exists) {
    disposition = "create";
  } else if (remoteCommitSha === input.local_commit_sha) {
    disposition = "up-to-date";
  } else {
    disposition = await classifyAncestry(
      state.root,
      remoteCommitSha,
      input.local_commit_sha,
    );
  }

  const issues = [...pushPlan.issues];

  if (disposition === "non-fast-forward") {
    issues.push({
      code: "NON_FAST_FORWARD",
      message:
        "The explicit remote destination cannot be advanced by a normal fast-forward push",
    });
  }

  if (disposition === "unavailable") {
    issues.push({
      code: "ANCESTRY_UNAVAILABLE",
      message:
        "Remote destination ancestry could not be verified locally without fetching",
    });
  }

  pushPlan = {
    ...pushPlan,
    eligible:
      issues.length === 0 &&
      disposition !== "unavailable" &&
      disposition !== "non-fast-forward",
    remote_push_url: remoteInspection.selected_push_url,
    destination_ref: remoteInspection.destination_ref,
    remote_commit_sha: remoteCommitSha,
    disposition,
    issues,
  };

  return {
    ok: true,
    state,
    policy_resolution: policyResolution,
    push_plan: pushPlan,
    remote_inspection: remoteInspection,
  };
}
