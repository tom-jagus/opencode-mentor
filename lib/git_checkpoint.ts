import type { EffectiveGitPolicyResolution, GitPolicy } from "./git_policy";
import { resolveEffectiveGitPolicy } from "./git_policy";
import type { FileChange, GitRepositoryState, GitState } from "./git_state";
import { inspectGitState } from "./git_state";
import { validateWorkingBranchName } from "./git_validation";
import type { GitCheckpointStageSnapshot } from "./git_checkpoint_stage_snapshot";
import {
  GitCheckpointStageSnapshotError,
  inspectGitCheckpointStageSnapshot,
} from "./git_checkpoint_stage_snapshot";

export type GitCheckpointIssueCode =
  | "GIT_UNAVAILABLE"
  | "NOT_GIT_REPOSITORY"
  | "DETACHED_HEAD"
  | "UNBORN_HEAD"
  | "HEAD_UNAVAILABLE"
  | "ON_PROTECTED_BASE_BRANCH"
  | "CURRENT_BRANCH_INVALID"
  | "WORKTREE_STATE_UNAVAILABLE"
  | "NO_CHANGES"
  | "UNRESOLVED_CONFLICTS"
  | "EMPTY_STAGING_SELECTION"
  | "DUPLICATE_STAGING_SELECTION"
  | "SELECTED_PATH_NOT_CHANGED"
  | "STAGED_PATH_NOT_SELECTED";

export type GitCheckpointIssue = {
  code: GitCheckpointIssueCode;
  message: string;
};

export type GitCheckpointStagePlanInput = {
  state: GitState;
  policy: GitPolicy;
  selected_paths: string[];
};

export type GitCheckpointStagePlan = {
  eligible: boolean;
  repository_root: string | null;
  base_branch: string;
  current_branch: string | null;
  head_sha: string | null;
  selected_changes: FileChange[];
  unselected_changes: FileChange[];
  staging_pathspecs: string[];
  issues: GitCheckpointIssue[];
};

export type GitCheckpointStagePreflightInput = {
  directory: string;
  configuration_root: string;
  selected_paths: string[];
};

export type GitCheckpointStagePreflight =
  | {
      ok: true;
      state: GitRepositoryState;
      policy_resolution: EffectiveGitPolicyResolution;
      stage_plan: GitCheckpointStagePlan;
      snapshot: GitCheckpointStageSnapshot | null;
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
      stage: "snapshot";
      state: GitRepositoryState;
      policy_resolution: EffectiveGitPolicyResolution;
      error: {
        code:
          "INVALID_SNAPSHOT_PATH" | "UNSUPPORTED_PATH_TYPE" | "SNAPSHOT_FAILED";
        message: string;
      };
    };

function unavailableStagePlan(
  input: GitCheckpointStagePlanInput,
  issue: GitCheckpointIssue,
): GitCheckpointStagePlan {
  return {
    eligible: false,
    repository_root: null,
    base_branch: input.policy.base_branch,
    current_branch: null,
    head_sha: null,
    selected_changes: [],
    unselected_changes: [],
    staging_pathspecs: [],
    issues: [issue],
  };
}

function isStaged(change: FileChange): boolean {
  return (
    change.index_status !== " " &&
    change.index_status !== "?" &&
    change.index_status !== "!"
  );
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values)];
}

function stagingPathspecs(changes: FileChange[]): string[] {
  const pathspecs: string[] = [];

  for (const change of changes) {
    if (change.original_path) {
      pathspecs.push(change.original_path);
    }

    pathspecs.push(change.path);
  }

  return uniqueValues(pathspecs);
}

function repositoryStagePlan(
  input: GitCheckpointStagePlanInput,
  state: GitRepositoryState,
): GitCheckpointStagePlan {
  const issues: GitCheckpointIssue[] = [];
  const selectedPathSet = new Set(input.selected_paths);

  if (state.detached) {
    issues.push({
      code: "DETACHED_HEAD",
      message: "A checkpoint cannot be created from detached HEAD",
    });
  }

  if (state.unborn) {
    issues.push({
      code: "UNBORN_HEAD",
      message:
        "A checkpoint cannot be created before the repository has an initial commit",
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

  if (state.changes.length === 0) {
    issues.push({
      code: "NO_CHANGES",
      message: "There are no repository changes to checkpoint",
    });
  }

  if (state.conflicts.length > 0) {
    issues.push({
      code: "UNRESOLVED_CONFLICTS",
      message:
        "Unresolved conflicts must be resolved before creating a checkpoint",
    });
  }

  if (input.selected_paths.length === 0) {
    issues.push({
      code: "EMPTY_STAGING_SELECTION",
      message: "At least one changed path must be selected explicitly",
    });
  }

  if (selectedPathSet.size !== input.selected_paths.length) {
    issues.push({
      code: "DUPLICATE_STAGING_SELECTION",
      message: "The staging selection must not contain duplicate paths",
    });
  }

  const changedPaths = new Set(state.changes.map((change) => change.path));

  for (const path of input.selected_paths) {
    if (!changedPaths.has(path)) {
      issues.push({
        code: "SELECTED_PATH_NOT_CHANGED",
        message: `Selected path ${JSON.stringify(path)} is not present in the inspected repository changes`,
      });
    }
  }

  const stagedButUnselected = state.changes.filter(
    (change) => isStaged(change) && !selectedPathSet.has(change.path),
  );

  if (stagedButUnselected.length > 0) {
    issues.push({
      code: "STAGED_PATH_NOT_SELECTED",
      message: `Already-staged paths must be included in the explicit selection: ${stagedButUnselected
        .map((change) => JSON.stringify(change.path))
        .join(", ")}`,
    });
  }

  const selectedChanges = state.changes.filter((change) =>
    selectedPathSet.has(change.path),
  );
  const unselectedChanges = state.changes.filter(
    (change) => !selectedPathSet.has(change.path),
  );

  return {
    eligible: issues.length === 0,
    repository_root: state.root,
    base_branch: input.policy.base_branch,
    current_branch: state.branch,
    head_sha: state.latest_commit?.sha ?? null,
    selected_changes: selectedChanges,
    unselected_changes: unselectedChanges,
    staging_pathspecs: stagingPathspecs(selectedChanges),
    issues,
  };
}

export function validateGitCheckpointStagePlan(
  input: GitCheckpointStagePlanInput,
): GitCheckpointStagePlan {
  if (!input.state.available) {
    return unavailableStagePlan(input, {
      code: "GIT_UNAVAILABLE",
      message: `Git inspection failed: ${input.state.error}`,
    });
  }

  if (!input.state.repository) {
    return unavailableStagePlan(input, {
      code: "NOT_GIT_REPOSITORY",
      message: "The current workspace is not inside a Git repository",
    });
  }

  return repositoryStagePlan(input, input.state);
}

export async function runGitCheckpointStagePreflight(
  input: GitCheckpointStagePreflightInput,
): Promise<GitCheckpointStagePreflight> {
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

  const stagePlan = validateGitCheckpointStagePlan({
    state,
    policy: policyResolution.effective_policy,
    selected_paths: input.selected_paths,
  });

  if (!stagePlan.eligible) {
    return {
      ok: true,
      state,
      policy_resolution: policyResolution,
      stage_plan: stagePlan,
      snapshot: null,
    };
  }

  let snapshot: GitCheckpointStageSnapshot;

  try {
    snapshot = await inspectGitCheckpointStageSnapshot(
      state.root,
      stagePlan.staging_pathspecs,
    );
  } catch (error) {
    if (error instanceof GitCheckpointStageSnapshotError) {
      return {
        ok: false,
        stage: "snapshot",
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

  if (snapshot.repository_root !== state.root) {
    return {
      ok: false,
      stage: "snapshot",
      state,
      policy_resolution: policyResolution,
      error: {
        code: "SNAPSHOT_FAILED",
        message:
          "Stage snapshot repository root does not match the inspected repository",
      },
    };
  }

  return {
    ok: true,
    state,
    policy_resolution: policyResolution,
    stage_plan: stagePlan,
    snapshot,
  };
}
