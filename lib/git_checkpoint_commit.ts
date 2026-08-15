import type { EffectiveGitPolicyResolution, GitPolicy } from "./git_policy";
import { resolveEffectiveGitPolicy } from "./git_policy";
import type { FileChange, GitRepositoryState, GitState } from "./git_state";
import { inspectGitState } from "./git_state";
import type {
  CommitMessageValidationResult,
  GitValidationIssue,
} from "./git_validation";
import {
  validateCommitMessage,
  validateWorkingBranchName,
} from "./git_validation";
import type { GitCheckpointCommitDiff } from "./git_checkpoint_commit_diff";
import {
  GitCheckpointCommitDiffError,
  inspectGitCheckpointCommitDiff,
} from "./git_checkpoint_commit_diff";
import {
  GitCheckpointOperationStateError,
  inspectGitCheckpointOperationState,
} from "./git_checkpoint_operation_state";

export type GitCheckpointCommitIssueCode =
  | "GIT_UNAVAILABLE"
  | "NOT_GIT_REPOSITORY"
  | "DETACHED_HEAD"
  | "UNBORN_HEAD"
  | "HEAD_UNAVAILABLE"
  | "ON_PROTECTED_BASE_BRANCH"
  | "CURRENT_BRANCH_INVALID"
  | "WORKTREE_STATE_UNAVAILABLE"
  | "UNRESOLVED_CONFLICTS"
  | "NO_STAGED_CHANGES"
  | "INVALID_COMMIT_MESSAGE"
  | "ACTIVE_GIT_OPERATION";

export type GitCheckpointCommitIssue = {
  code: GitCheckpointCommitIssueCode;
  message: string;
  validation_issues?: GitValidationIssue[];
};

export type GitCheckpointCommitPlanInput = {
  state: GitState;
  policy: GitPolicy;
  commit_message: string;
};

export type GitCheckpointCommitPlan = {
  eligible: boolean;
  repository_root: string | null;
  base_branch: string;
  current_branch: string | null;
  head_sha: string | null;
  staged_changes: FileChange[];
  remaining_changes: FileChange[];
  commit_message: string;
  message_validation: CommitMessageValidationResult;
  issues: GitCheckpointCommitIssue[];
};

export type GitCheckpointCommitPreflightInput = {
  directory: string;
  configuration_root: string;
  commit_message: string;
};

export type GitCheckpointCommitPreflight =
  | {
      ok: true;
      state: GitRepositoryState;
      policy_resolution: EffectiveGitPolicyResolution;
      commit_plan: GitCheckpointCommitPlan;
      diff: GitCheckpointCommitDiff | null;
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
      stage: "diff";
      state: GitRepositoryState;
      policy_resolution: EffectiveGitPolicyResolution;
      commit_plan: GitCheckpointCommitPlan;
      error: {
        code:
          | "DIFF_INSPECTION_FAILED"
          | "INVALID_DIFF_ENCODING"
          | "EMPTY_STAGED_DIFF";
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
    };

function isStaged(change: FileChange): boolean {
  return (
    change.index_status !== " " &&
    change.index_status !== "?" &&
    change.index_status !== "!"
  );
}

function hasRemainingWorktreeChange(change: FileChange): boolean {
  return (
    change.worktree_status !== " " ||
    change.index_status === "?" ||
    change.index_status === "!"
  );
}

function unavailableCommitPlan(
  input: GitCheckpointCommitPlanInput,
  issue: GitCheckpointCommitIssue,
): GitCheckpointCommitPlan {
  return {
    eligible: false,
    repository_root: null,
    base_branch: input.policy.base_branch,
    current_branch: null,
    head_sha: null,
    staged_changes: [],
    remaining_changes: [],
    commit_message: input.commit_message,
    message_validation: validateCommitMessage(
      input.commit_message,
      input.policy,
    ),
    issues: [issue],
  };
}

function repositoryCommitPlan(
  input: GitCheckpointCommitPlanInput,
  state: GitRepositoryState,
): GitCheckpointCommitPlan {
  const issues: GitCheckpointCommitIssue[] = [];
  const messageValidation = validateCommitMessage(
    input.commit_message,
    input.policy,
  );

  if (state.detached) {
    issues.push({
      code: "DETACHED_HEAD",
      message: "A checkpoint cannot be committed from detached HEAD",
    });
  }

  if (state.unborn) {
    issues.push({
      code: "UNBORN_HEAD",
      message:
        "A checkpoint cannot be committed before the repository has an initial commit",
    });
  }

  if (state.latest_commit === null) {
    issues.push({
      code: "HEAD_UNAVAILABLE",
      message: "The current HEAD commit could not be determined",
    });
  }

  if (state.branch === input.policy.base_branch) {
    issues.push({
      code: "ON_PROTECTED_BASE_BRANCH",
      message: `A checkpoint cannot be committed directly to the effective base branch ${JSON.stringify(input.policy.base_branch)}`,
    });
  } else if (state.branch === null) {
    issues.push({
      code: "CURRENT_BRANCH_INVALID",
      message: "The current working branch could not be determined",
    });
  } else {
    const branchValidation = validateWorkingBranchName(
      state.branch,
      input.policy,
    );

    if (!branchValidation.valid) {
      issues.push({
        code: "CURRENT_BRANCH_INVALID",
        message: branchValidation.issues
          .map((issue) => issue.message)
          .join("; "),
      });
    }
  }

  if (state.clean === null) {
    issues.push({
      code: "WORKTREE_STATE_UNAVAILABLE",
      message: "Working-tree state could not be determined",
    });
  }

  if (state.conflicts.length > 0) {
    issues.push({
      code: "UNRESOLVED_CONFLICTS",
      message:
        "Unresolved conflicts must be resolved before committing a checkpoint",
    });
  }

  const stagedChanges = state.changes.filter(isStaged);

  if (stagedChanges.length === 0) {
    issues.push({
      code: "NO_STAGED_CHANGES",
      message: "There are no staged changes to commit",
    });
  }

  if (!messageValidation.valid) {
    issues.push({
      code: "INVALID_COMMIT_MESSAGE",
      message: messageValidation.issues
        .map((issue) => issue.message)
        .join("; "),
      validation_issues: messageValidation.issues,
    });
  }

  return {
    eligible: issues.length === 0,
    repository_root: state.root,
    base_branch: input.policy.base_branch,
    current_branch: state.branch,
    head_sha: state.latest_commit?.sha ?? null,
    staged_changes: stagedChanges,
    remaining_changes: state.changes.filter(hasRemainingWorktreeChange),
    commit_message: input.commit_message,
    message_validation: messageValidation,
    issues,
  };
}

export function validateGitCheckpointCommitPlan(
  input: GitCheckpointCommitPlanInput,
): GitCheckpointCommitPlan {
  if (!input.state.available) {
    return unavailableCommitPlan(input, {
      code: "GIT_UNAVAILABLE",
      message: `Git inspection failed: ${input.state.error}`,
    });
  }

  if (!input.state.repository) {
    return unavailableCommitPlan(input, {
      code: "NOT_GIT_REPOSITORY",
      message: "The current workspace is not inside a Git repository",
    });
  }

  return repositoryCommitPlan(input, input.state);
}

export async function runGitCheckpointCommitPreflight(
  input: GitCheckpointCommitPreflightInput,
): Promise<GitCheckpointCommitPreflight> {
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

  let commitPlan = validateGitCheckpointCommitPlan({
    state,
    policy: policyResolution.effective_policy,
    commit_message: input.commit_message,
  });

  try {
    const operationState = await inspectGitCheckpointOperationState(state.root);

    if (operationState.repository_root !== state.root) {
      return {
        ok: false,
        stage: "operation",
        state,
        policy_resolution: policyResolution,
        error: {
          code: "OPERATION_STATE_INSPECTION_FAILED",
          message:
            "Git operation-state repository root does not match the inspected repository",
        },
      };
    }

    if (operationState.active_operations.length > 0) {
      commitPlan = {
        ...commitPlan,
        eligible: false,
        issues: [
          ...commitPlan.issues,
          {
            code: "ACTIVE_GIT_OPERATION",
            message: `A checkpoint cannot be committed during an active Git operation: ${operationState.active_operations.join(", ")}`,
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

  if (!commitPlan.eligible) {
    return {
      ok: true,
      state,
      policy_resolution: policyResolution,
      commit_plan: commitPlan,
      diff: null,
    };
  }

  try {
    const diff = await inspectGitCheckpointCommitDiff(state.root);

    if (diff.repository_root !== state.root) {
      return {
        ok: false,
        stage: "diff",
        state,
        policy_resolution: policyResolution,
        commit_plan: commitPlan,
        error: {
          code: "DIFF_INSPECTION_FAILED",
          message:
            "Commit diff repository root does not match the inspected repository",
        },
      };
    }

    return {
      ok: true,
      state,
      policy_resolution: policyResolution,
      commit_plan: commitPlan,
      diff,
    };
  } catch (error) {
    if (error instanceof GitCheckpointCommitDiffError) {
      return {
        ok: false,
        stage: "diff",
        state,
        policy_resolution: policyResolution,
        commit_plan: commitPlan,
        error: {
          code: error.code,
          message: error.message,
        },
      };
    }

    throw error;
  }
}
