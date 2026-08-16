import type { EffectiveGitPolicyResolution, GitPolicy } from "./git_policy";
import { resolveEffectiveGitPolicy } from "./git_policy";
import type { GitRepositoryState, GitState } from "./git_state";
import { inspectGitState } from "./git_state";
import {
  GitCheckpointOperationStateError,
  inspectGitCheckpointOperationState,
  type GitCheckpointOperationState,
} from "./git_checkpoint_operation_state";
import {
  GitFinishUpdateRemoteError,
  inspectGitFinishUpdateRemote,
  type GitFinishUpdateRemoteErrorCode,
  type GitFinishUpdateRemoteInspection,
} from "./git_finish_update_remote";
import { validateWorkingBranchName } from "./git_validation";

export type GitFinishUpdateIssueCode =
  | "GIT_UNAVAILABLE"
  | "NOT_GIT_REPOSITORY"
  | "DETACHED_HEAD"
  | "UNBORN_HEAD"
  | "HEAD_UNAVAILABLE"
  | "ON_PROTECTED_BASE_BRANCH"
  | "CURRENT_BRANCH_INVALID"
  | "WORKTREE_STATE_UNAVAILABLE"
  | "WORKTREE_NOT_CLEAN"
  | "UNRESOLVED_CONFLICTS"
  | "ACTIVE_GIT_OPERATION"
  | "REMOTE_REQUIRED";

export type GitFinishUpdateIssue = {
  code: GitFinishUpdateIssueCode;
  message: string;
};

export type GitFinishUpdateEligibility = {
  eligible: boolean;
  repository_root: string | null;
  base_branch: string;
  current_branch: string | null;
  head_sha: string | null;
  remote: string;
  issues: GitFinishUpdateIssue[];
};

export type GitFinishUpdateEligibilityInput = {
  state: GitState;
  policy: GitPolicy;
  remote: string;
  active_operations: string[];
};

export type GitFinishUpdateAction = "fetch-and-rebase" | "not-required";

export type GitFinishUpdatePlan = {
  repository_root: string;
  base_branch: string;
  current_branch: string;
  local_head_sha: string;
  remote: string;
  selected_fetch_url: string;
  remote_base_ref: string;
  remote_base_commit_sha: string;
  action: GitFinishUpdateAction;
};

export type GitFinishUpdatePreflightInput = {
  directory: string;
  configuration_root: string;
  remote: string;
};

export type GitFinishUpdatePreflight =
  | {
      ok: true;
      state: GitRepositoryState;
      policy_resolution: EffectiveGitPolicyResolution;
      operation_state: GitCheckpointOperationState;
      eligibility: GitFinishUpdateEligibility;
      remote_inspection: GitFinishUpdateRemoteInspection | null;
      update_plan: GitFinishUpdatePlan | null;
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
      operation_state: GitCheckpointOperationState;
      eligibility: GitFinishUpdateEligibility;
      error: {
        code: GitFinishUpdateRemoteErrorCode;
        message: string;
      };
    };

function unavailableResult(
  input: GitFinishUpdateEligibilityInput,
  issue: GitFinishUpdateIssue,
): GitFinishUpdateEligibility {
  return {
    eligible: false,
    repository_root: null,
    base_branch: input.policy.base_branch,
    current_branch: null,
    head_sha: null,
    remote: input.remote,
    issues: [issue],
  };
}

function repositoryResult(
  input: GitFinishUpdateEligibilityInput,
  state: GitRepositoryState,
  issues: GitFinishUpdateIssue[],
): GitFinishUpdateEligibility {
  return {
    eligible: issues.length === 0,
    repository_root: state.root,
    base_branch: input.policy.base_branch,
    current_branch: state.branch,
    head_sha: state.latest_commit?.sha ?? null,
    remote: input.remote,
    issues,
  };
}

export function validateGitFinishUpdateEligibility(
  input: GitFinishUpdateEligibilityInput,
): GitFinishUpdateEligibility {
  const { state, policy } = input;

  if (!state.available) {
    return unavailableResult(input, {
      code: "GIT_UNAVAILABLE",
      message: `Git inspection failed: ${state.error}`,
    });
  }

  if (!state.repository) {
    return unavailableResult(input, {
      code: "NOT_GIT_REPOSITORY",
      message: "The current workspace is not inside a Git repository",
    });
  }

  const issues: GitFinishUpdateIssue[] = [];

  if (state.detached) {
    issues.push({
      code: "DETACHED_HEAD",
      message: "A working branch cannot be finalised from detached HEAD",
    });
  }

  if (state.unborn) {
    issues.push({
      code: "UNBORN_HEAD",
      message:
        "A working branch cannot be finalised before the repository has an initial commit",
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
      message: `The effective base branch ${JSON.stringify(policy.base_branch)} cannot be finalised as a working branch`,
    });
  } else if (state.branch === null) {
    issues.push({
      code: "CURRENT_BRANCH_INVALID",
      message: "The current working branch could not be determined",
    });
  } else {
    const branchValidation = validateWorkingBranchName(state.branch, policy);

    if (!branchValidation.valid) {
      issues.push({
        code: "CURRENT_BRANCH_INVALID",
        message: branchValidation.issues
          .map((issue) => issue.message)
          .join("; "),
      });
    }
  }

  if (state.conflicts.length > 0) {
    issues.push({
      code: "UNRESOLVED_CONFLICTS",
      message:
        "Unresolved conflicts must be resolved before finalising the working branch",
    });
  }

  if (state.clean === null) {
    issues.push({
      code: "WORKTREE_STATE_UNAVAILABLE",
      message: "Working-tree state could not be determined",
    });
  } else if (!state.clean) {
    issues.push({
      code: "WORKTREE_NOT_CLEAN",
      message:
        "The working tree must be clean before finalising the working branch",
    });
  }

  if (input.active_operations.length > 0) {
    issues.push({
      code: "ACTIVE_GIT_OPERATION",
      message: `A working branch cannot be finalised during an active Git operation: ${input.active_operations.join(", ")}`,
    });
  }

  if (input.remote.trim().length === 0) {
    issues.push({
      code: "REMOTE_REQUIRED",
      message: "Finish Update requires an explicit configured remote",
    });
  }

  return repositoryResult(input, state, issues);
}

export async function runGitFinishUpdatePreflight(
  input: GitFinishUpdatePreflightInput,
): Promise<GitFinishUpdatePreflight> {
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

  let operationState: GitCheckpointOperationState;

  try {
    operationState = await inspectGitCheckpointOperationState(state.root);
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

  const eligibility = validateGitFinishUpdateEligibility({
    state,
    policy: policyResolution.effective_policy,
    remote: input.remote,
    active_operations: operationState.active_operations,
  });

  if (!eligibility.eligible) {
    return {
      ok: true,
      state,
      policy_resolution: policyResolution,
      operation_state: operationState,
      eligibility,
      remote_inspection: null,
      update_plan: null,
    };
  }

  let remoteInspection: GitFinishUpdateRemoteInspection;

  try {
    remoteInspection = await inspectGitFinishUpdateRemote({
      repository_root: state.root,
      remote: input.remote,
      base_branch: policyResolution.effective_policy.base_branch,
    });
  } catch (error) {
    if (error instanceof GitFinishUpdateRemoteError) {
      return {
        ok: false,
        stage: "remote",
        state,
        policy_resolution: policyResolution,
        operation_state: operationState,
        eligibility,
        error: {
          code: error.code,
          message: error.message,
        },
      };
    }

    throw error;
  }

  if (state.branch === null || state.latest_commit === null) {
    throw new Error(
      "Finish Update eligibility succeeded without a valid branch and HEAD",
    );
  }

  const updatePlan: GitFinishUpdatePlan = {
    repository_root: state.root,
    base_branch: policyResolution.effective_policy.base_branch,
    current_branch: state.branch,
    local_head_sha: state.latest_commit.sha,
    remote: input.remote,
    selected_fetch_url: remoteInspection.selected_fetch_url,
    remote_base_ref: remoteInspection.base_ref,
    remote_base_commit_sha: remoteInspection.base_commit_sha,
    action: policyResolution.effective_policy.branch_update
      .require_before_finalization
      ? "fetch-and-rebase"
      : "not-required",
  };

  return {
    ok: true,
    state,
    policy_resolution: policyResolution,
    operation_state: operationState,
    eligibility,
    remote_inspection: remoteInspection,
    update_plan: updatePlan,
  };
}
