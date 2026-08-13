import type { GitPolicy } from "./git_policy";
import type { GitRepositoryState, GitState } from "./git_state";
import { validateWorkingBranchName } from "./git_validation";
import type { EffectiveGitPolicyResolution } from "./git_policy";
import { resolveEffectiveGitPolicy } from "./git_policy";
import { inspectGitState, inspectLocalBranch } from "./git_state";

export type GitStartIssue = {
  code:
    | "GIT_UNAVAILABLE"
    | "NOT_GIT_REPOSITORY"
    | "DETACHED_HEAD"
    | "UNBORN_HEAD"
    | "HEAD_UNAVAILABLE"
    | "NOT_ON_BASE_BRANCH"
    | "WORKTREE_STATE_UNAVAILABLE"
    | "WORKTREE_NOT_CLEAN"
    | "UNRESOLVED_CONFLICTS"
    | "TARGET_IS_BASE_BRANCH"
    | "TARGET_BRANCH_INVALID"
    | "TARGET_BRANCH_EXISTS";
  message: string;
};

export type GitStartEligibility = {
  eligible: boolean;
  repository_root: string | null;
  base_branch: string;
  current_branch: string | null;
  head_sha: string | null;
  target_branch: string;
  issues: GitStartIssue[];
};

export type GitStartEligibilityInput = {
  state: GitState;
  policy: GitPolicy;
  target_branch: string;
  target_branch_exists: boolean;
};

export type GitStartPreflight =
  | {
      ok: true;
      state: GitRepositoryState;
      policy_resolution:
        EffectiveGitPolicyResolution;
      target_branch_exists: boolean;
      eligibility: GitStartEligibility;
    }
  | {
      ok: false;
      stage: "repository";
      state: GitState;
      error: {
        code:
          | "GIT_UNAVAILABLE"
          | "NOT_GIT_REPOSITORY";
        message: string;
      };
    }
  | {
      ok: false;
      stage: "target-branch";
      state: GitRepositoryState;
      policy_resolution:
        EffectiveGitPolicyResolution;
      error: {
        code:
          "TARGET_BRANCH_STATE_UNAVAILABLE";
        message: string;
      };
    };

export type GitStartPreflightInput = {
  directory: string;
  configuration_root: string;
  target_branch: string;
};

function unavailableResult(
  input: GitStartEligibilityInput,
  issue: GitStartIssue,
): GitStartEligibility {
  return {
    eligible: false,
    repository_root: null,
    base_branch: input.policy.base_branch,
    current_branch: null,
    head_sha: null,
    target_branch: input.target_branch,
    issues: [issue],
  };
}

function repositoryResult(
  input: GitStartEligibilityInput,
  state: GitRepositoryState,
  issues: GitStartIssue[],
): GitStartEligibility {
  return {
    eligible: issues.length === 0,
    repository_root: state.root,
    base_branch: input.policy.base_branch,
    current_branch: state.branch,
    head_sha: state.latest_commit?.sha ?? null,
    target_branch: input.target_branch,
    issues,
  };
}

export function validateGitStartEligibility(
  input: GitStartEligibilityInput,
): GitStartEligibility {
  const { state, policy, target_branch } = input;

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

  const issues: GitStartIssue[] = [];

  if (state.detached) {
    issues.push({
      code: "DETACHED_HEAD",
      message: "A working branch cannot be started from detached HEAD",
    });
  }

  if (state.unborn) {
    issues.push({
      code: "UNBORN_HEAD",
      message:
        "A working branch cannot be started before the repository has an initial commit",
    });
  }

  if (state.latest_commit === null) {
    issues.push({
      code: "HEAD_UNAVAILABLE",
      message: "The current HEAD commit could not be determined",
    });
  }

  if (state.branch !== policy.base_branch) {
    issues.push({
      code: "NOT_ON_BASE_BRANCH",
      message: `Current branch must be the effective base branch ${JSON.stringify(policy.base_branch)}`,
    });
  }

  if (state.conflicts.length > 0) {
    issues.push({
      code: "UNRESOLVED_CONFLICTS",
      message:
        "Unresolved conflicts must be resolved before starting a working branch",
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
        "The working tree must be clean before starting a working branch",
    });
  }

  if (target_branch === policy.base_branch) {
    issues.push({
      code: "TARGET_IS_BASE_BRANCH",
      message:
        "The target working branch must not be the effective base branch",
    });
  }

  const branchValidation = validateWorkingBranchName(target_branch, policy);

  if (!branchValidation.valid) {
    issues.push({
      code: "TARGET_BRANCH_INVALID",
      message: branchValidation.issues.map((issue) => issue.message).join("; "),
    });
  }

  if (input.target_branch_exists) {
    issues.push({
      code: "TARGET_BRANCH_EXISTS",
      message: `Branch ${JSON.stringify(target_branch)} already exists`,
    });
  }

  return repositoryResult(input, state, issues);
}

export async function runGitStartPreflight(
  input: GitStartPreflightInput,
): Promise<GitStartPreflight> {
  const state = await inspectGitState(
    input.directory,
  );

  if (!state.available) {
    return {
      ok: false,
      stage: "repository",
      state,
      error: {
        code: "GIT_UNAVAILABLE",
        message:
          `Git inspection failed: ${state.error}`,
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
        message:
          "The current workspace is not inside a Git repository",
      },
    };
  }

  const policyResolution =
    await resolveEffectiveGitPolicy(
      state.root,
      input.configuration_root,
    );

  const targetBranchInspection =
    await inspectLocalBranch(
      state.root,
      input.target_branch,
    );

  if (!targetBranchInspection.available) {
    return {
      ok: false,
      stage: "target-branch",
      state,
      policy_resolution:
        policyResolution,
      error: {
        code:
          "TARGET_BRANCH_STATE_UNAVAILABLE",
        message:
          `Could not determine whether branch ${JSON.stringify(input.target_branch)} exists: ${targetBranchInspection.error}`,
      },
    };
  }

  const eligibility =
    validateGitStartEligibility({
      state,
      policy:
        policyResolution.effective_policy,
      target_branch:
        input.target_branch,
      target_branch_exists:
        targetBranchInspection.exists,
    });

  return {
    ok: true,
    state,
    policy_resolution:
      policyResolution,
    target_branch_exists:
      targetBranchInspection.exists,
    eligibility,
  };
}
