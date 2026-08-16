import type { EffectiveGitPolicyResolution } from "./git_policy";
import { resolveEffectiveGitPolicy } from "./git_policy";
import type { GitRepositoryState, GitState } from "./git_state";
import { inspectGitState } from "./git_state";
import {
  validateGitFinishUpdateEligibility,
  type GitFinishUpdateIssue,
  type GitFinishUpdateIssueCode,
} from "./git_finish_update";
import type { GitFinishUpdateProposalRecord } from "./git_finish_update_proposal";
import { policyResolutionChecksum } from "./git_lifecycle_proposal";
import {
  GitCheckpointPushRemoteError,
  inspectGitCheckpointPushRemote,
  type GitCheckpointPushRemoteErrorCode,
  type GitCheckpointPushRemoteInspection,
} from "./git_checkpoint_push_remote";
import {
  GitCheckpointOperationStateError,
  inspectGitCheckpointOperationState,
  type GitCheckpointOperationState,
} from "./git_checkpoint_operation_state";
import { loadGitFinishUpdateAppliedProposal } from "./git_finish_update_proposal_storage";

export type GitFinishPublishIssueCode =
  | GitFinishUpdateIssueCode
  | "UPDATE_PROPOSAL_NOT_APPLIED"
  | "UPDATE_PROJECT_MISMATCH"
  | "UPDATE_POLICY_MISMATCH"
  | "UPDATE_BASE_BRANCH_MISMATCH"
  | "UPDATE_BRANCH_MISMATCH"
  | "UPDATE_REMOTE_MISMATCH"
  | "UPDATE_HEAD_MISMATCH"
  | "UPDATE_RESULT_INVALID"
  | "REMOTE_STATE_INCONSISTENT"
  | "NON_FAST_FORWARD_UNAUTHORIZED"
  | "ANCESTRY_UNAVAILABLE";

export type GitFinishPublishIssue = {
  code: GitFinishPublishIssueCode;
  message: string;
};

export type GitFinishPublishEligibility = {
  eligible: boolean;
  repository_root: string | null;
  base_branch: string;
  current_branch: string | null;
  local_head_sha: string | null;
  remote: string;
  update_proposal_id: string;
  previous_head_sha: string | null;
  update_rebased: boolean | null;
  issues: GitFinishPublishIssue[];
};

export type GitFinishPublishEligibilityInput = {
  state: GitState;
  policy_resolution: EffectiveGitPolicyResolution;
  remote: string;
  active_operations: string[];
  update_record: GitFinishUpdateProposalRecord;
};

function updateIssue(
  code: GitFinishPublishIssueCode,
  message: string,
): GitFinishPublishIssue {
  return {
    code,
    message,
  };
}

function localIssues(
  input: GitFinishPublishEligibilityInput,
): GitFinishUpdateIssue[] {
  return validateGitFinishUpdateEligibility({
    state: input.state,
    policy: input.policy_resolution.effective_policy,
    remote: input.remote,
    active_operations: input.active_operations,
  }).issues;
}

function repositoryRoot(state: GitState): string | null {
  return state.available && state.repository ? state.root : null;
}

function repositoryState(state: GitState): GitRepositoryState | null {
  return state.available && state.repository ? state : null;
}

export function validateGitFinishPublishEligibility(
  input: GitFinishPublishEligibilityInput,
): GitFinishPublishEligibility {
  const issues: GitFinishPublishIssue[] = [...localIssues(input)];

  const state = repositoryState(input.state);
  const update = input.update_record;
  const operation = update.proposal.operation;

  let previousHeadSha: string | null = null;
  let updateRebased: boolean | null = null;

  if (update.state.status !== "applied") {
    issues.push(
      updateIssue(
        "UPDATE_PROPOSAL_NOT_APPLIED",
        "Finish Publish requires a successfully applied Update proposal",
      ),
    );
  } else {
    previousHeadSha = update.state.result.previous_head_sha;
    updateRebased = update.state.result.rebased;

    if (
      update.state.result.previous_head_sha !== operation.local_head_sha ||
      update.state.result.base_commit_sha !==
        update.proposal.remote.base_commit_sha ||
      update.state.result.rebased !==
        (update.state.result.resulting_head_sha !==
          update.state.result.previous_head_sha)
    ) {
      issues.push(
        updateIssue(
          "UPDATE_RESULT_INVALID",
          "Applied Update provenance is internally inconsistent",
        ),
      );
    }
  }

  if (state !== null && update.proposal.project.root !== state.root) {
    issues.push(
      updateIssue(
        "UPDATE_PROJECT_MISMATCH",
        "Applied Update belongs to a different repository",
      ),
    );
  }

  if (
    policyResolutionChecksum(input.policy_resolution) !==
    update.proposal.policy.resolution_sha256
  ) {
    issues.push(
      updateIssue(
        "UPDATE_POLICY_MISMATCH",
        "Effective Git policy changed after Update",
      ),
    );
  }

  if (
    operation.base_branch !==
    input.policy_resolution.effective_policy.base_branch
  ) {
    issues.push(
      updateIssue(
        "UPDATE_BASE_BRANCH_MISMATCH",
        "Effective base branch differs from the applied Update",
      ),
    );
  }

  if (state !== null && state.branch !== operation.current_branch) {
    issues.push(
      updateIssue(
        "UPDATE_BRANCH_MISMATCH",
        "Current branch differs from the applied Update branch",
      ),
    );
  }

  if (input.remote !== operation.remote) {
    issues.push(
      updateIssue(
        "UPDATE_REMOTE_MISMATCH",
        "Explicit Publish remote differs from the applied Update remote",
      ),
    );
  }

  if (
    state !== null &&
    update.state.status === "applied" &&
    state.latest_commit?.sha !== update.state.result.resulting_head_sha
  ) {
    issues.push(
      updateIssue(
        "UPDATE_HEAD_MISMATCH",
        "Current HEAD differs from the verified Update result",
      ),
    );
  }

  return {
    eligible: issues.length === 0,
    repository_root: repositoryRoot(input.state),
    base_branch: input.policy_resolution.effective_policy.base_branch,
    current_branch: state?.branch ?? null,
    local_head_sha: state?.latest_commit?.sha ?? null,
    remote: input.remote,
    update_proposal_id: update.proposal.id,
    previous_head_sha: previousHeadSha,
    update_rebased: updateRebased,
    issues,
  };
}

export type GitFinishPublishDisposition =
  | "create"
  | "up-to-date"
  | "fast-forward"
  | "force-with-lease"
  | "non-fast-forward"
  | "unavailable";

export type GitFinishPublishAncestry =
  "fast-forward" | "non-fast-forward" | "unavailable";

export type GitFinishPublishPlan = {
  eligible: boolean;
  repository_root: string;
  base_branch: string;
  current_branch: string;
  local_head_sha: string;
  remote: string;
  push_url: string;
  destination_branch: string;
  destination_ref: string;
  remote_commit_sha: string | null;
  disposition: GitFinishPublishDisposition;
  force_with_lease_expected_sha: string | null;
  update_proposal_id: string;
  issues: GitFinishPublishIssue[];
};

export function buildGitFinishPublishPlan(input: {
  eligibility: GitFinishPublishEligibility;
  update_record: GitFinishUpdateProposalRecord;
  remote_inspection: GitCheckpointPushRemoteInspection;
  ancestry: GitFinishPublishAncestry | null;
}): GitFinishPublishPlan {
  const {
    eligibility,
    update_record: update,
    remote_inspection: remoteInspection,
  } = input;

  const issues = [...eligibility.issues];

  if (
    !eligibility.eligible ||
    eligibility.repository_root === null ||
    eligibility.current_branch === null ||
    eligibility.local_head_sha === null ||
    update.state.status !== "applied"
  ) {
    throw new Error(
      "Finish Publish planning requires eligible local state and applied Update provenance",
    );
  }

  const branch = eligibility.current_branch;
  const localHead = eligibility.local_head_sha;
  const destination = remoteInspection.destination;

  if (
    remoteInspection.repository_root !== eligibility.repository_root ||
    remoteInspection.remote !== eligibility.remote ||
    remoteInspection.destination_branch !== branch ||
    remoteInspection.destination_ref !== `refs/heads/${branch}` ||
    remoteInspection.selected_push_url.length === 0
  ) {
    issues.push({
      code: "REMOTE_STATE_INCONSISTENT",
      message:
        "Remote inspection does not match the eligible Publish destination",
    });
  }

  let disposition: GitFinishPublishDisposition = "unavailable";
  let forceWithLeaseExpectedSha: string | null = null;

  if (!destination.exists) {
    disposition = "create";
  } else if (destination.commit_sha === localHead) {
    disposition = "up-to-date";
  } else if (input.ancestry === "fast-forward") {
    disposition = "fast-forward";
  } else if (input.ancestry === "non-fast-forward") {
    if (
      update.state.result.rebased &&
      destination.commit_sha === update.state.result.previous_head_sha
    ) {
      disposition = "force-with-lease";
      forceWithLeaseExpectedSha = destination.commit_sha;
    } else {
      disposition = "non-fast-forward";
      issues.push({
        code: "NON_FAST_FORWARD_UNAUTHORIZED",
        message:
          "Non-fast-forward Publish is allowed only when the remote branch still identifies the exact pre-rebase Update commit",
      });
    }
  } else {
    disposition = "unavailable";
    issues.push({
      code: "ANCESTRY_UNAVAILABLE",
      message:
        "Remote branch ancestry could not be verified from available local objects",
    });
  }

  return {
    eligible:
      issues.length === 0 &&
      disposition !== "non-fast-forward" &&
      disposition !== "unavailable",
    repository_root: eligibility.repository_root,
    base_branch: eligibility.base_branch,
    current_branch: branch,
    local_head_sha: localHead,
    remote: eligibility.remote,
    push_url: remoteInspection.selected_push_url,
    destination_branch: branch,
    destination_ref: remoteInspection.destination_ref,
    remote_commit_sha: destination.commit_sha,
    disposition,
    force_with_lease_expected_sha: forceWithLeaseExpectedSha,
    update_proposal_id: update.proposal.id,
    issues,
  };
}

type GitCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type GitFinishPublishPreflightInput = {
  directory: string;
  configuration_root: string;
  remote: string;
  update_proposal_id: string;
  update_storage_root?: string;
};

export type GitFinishPublishPreflight =
  | {
      ok: true;
      state: GitRepositoryState;
      policy_resolution: EffectiveGitPolicyResolution;
      operation_state: GitCheckpointOperationState;
      update_record: GitFinishUpdateProposalRecord;
      eligibility: GitFinishPublishEligibility;
      remote_inspection: GitCheckpointPushRemoteInspection | null;
      publish_plan: GitFinishPublishPlan | null;
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
      update_record: GitFinishUpdateProposalRecord;
      eligibility: GitFinishPublishEligibility;
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

async function classifyPublishAncestry(
  repositoryRoot: string,
  remoteCommitSha: string,
  localCommitSha: string,
): Promise<GitFinishPublishAncestry> {
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

export async function runGitFinishPublishPreflight(
  input: GitFinishPublishPreflightInput,
): Promise<GitFinishPublishPreflight> {
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

  const loadedUpdate = await loadGitFinishUpdateAppliedProposal(
    state.root,
    input.update_proposal_id,
    input.update_storage_root,
  );

  const eligibility = validateGitFinishPublishEligibility({
    state,
    policy_resolution: policyResolution,
    remote: input.remote,
    active_operations: operationState.active_operations,
    update_record: loadedUpdate.record,
  });

  if (!eligibility.eligible) {
    return {
      ok: true,
      state,
      policy_resolution: policyResolution,
      operation_state: operationState,
      update_record: loadedUpdate.record,
      eligibility,
      remote_inspection: null,
      publish_plan: null,
    };
  }

  if (
    eligibility.current_branch === null ||
    eligibility.local_head_sha === null
  ) {
    throw new Error(
      "Finish Publish eligibility succeeded without a branch and HEAD",
    );
  }

  let remoteInspection: GitCheckpointPushRemoteInspection;

  try {
    remoteInspection = await inspectGitCheckpointPushRemote({
      repository_root: state.root,
      remote: input.remote,
      destination_branch: eligibility.current_branch,
    });
  } catch (error) {
    if (error instanceof GitCheckpointPushRemoteError) {
      return {
        ok: false,
        stage: "remote",
        state,
        policy_resolution: policyResolution,
        operation_state: operationState,
        update_record: loadedUpdate.record,
        eligibility,
        error: {
          code: error.code,
          message: error.message,
        },
      };
    }

    throw error;
  }

  let ancestry: GitFinishPublishAncestry | null = null;

  if (
    remoteInspection.destination.exists &&
    remoteInspection.destination.commit_sha !== eligibility.local_head_sha
  ) {
    ancestry = await classifyPublishAncestry(
      state.root,
      remoteInspection.destination.commit_sha,
      eligibility.local_head_sha,
    );
  }

  const publishPlan = buildGitFinishPublishPlan({
    eligibility,
    update_record: loadedUpdate.record,
    remote_inspection: remoteInspection,
    ancestry,
  });

  return {
    ok: true,
    state,
    policy_resolution: policyResolution,
    operation_state: operationState,
    update_record: loadedUpdate.record,
    eligibility,
    remote_inspection: remoteInspection,
    publish_plan: publishPlan,
  };
}
