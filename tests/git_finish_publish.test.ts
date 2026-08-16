import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { GitPolicy } from "../lib/git_policy";
import type { GitRepositoryState } from "../lib/git_state";
import type { GitFinishUpdatePreflight } from "../lib/git_finish_update";
import { buildGitFinishUpdateProposal } from "../lib/git_finish_update_proposal";
import {
  buildGitFinishPublishPlan,
  validateGitFinishPublishEligibility,
} from "../lib/git_finish_publish";
import type { GitCheckpointPushRemoteInspection } from "../lib/git_checkpoint_push_remote";

const previousHead = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const resultingHead = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const baseCommit = "cccccccccccccccccccccccccccccccccccccccc";
const root = "/workspace/project";
const branch = "feature/finish-publish";

const policy: GitPolicy = {
  schema_version: 1,
  base_branch: "main",
  branch: {
    allowed_types: ["feature"],
    format: "<type>/<kebab-case-summary>",
  },
  commit_message: {
    style: "descriptive",
    subject_case: "sentence",
    trailing_period: false,
    forbidden_prefix_patterns: ["^feat:\\s*"],
  },
  merge: {
    strategy: "squash",
    delete_branch: true,
  },
  branch_update: {
    strategy: "rebase",
    require_before_finalization: true,
    force_push: "force-with-lease",
  },
  validation: {
    profile: "standard",
  },
  pull_request: {
    draft: false,
    generated_body: true,
  },
  release: {
    enabled: true,
    versioning: "semantic",
    tag_prefix: "v",
    notes: "generated-reviewable",
  },
};

const state: GitRepositoryState = {
  version: 1,
  available: true,
  repository: true,
  root,
  branch,
  detached: false,
  unborn: false,
  upstream: null,
  ahead: null,
  behind: null,
  clean: true,
  staged: [],
  unstaged: [],
  untracked: [],
  conflicts: [],
  changes: [],
  latest_commit: {
    sha: resultingHead,
    short_sha: "bbbbbbb",
    subject: "Complete Publish work",
    committed_at: "2026-08-16T15:00:00Z",
  },
  warnings: [],
};

function appliedUpdate() {
  const fetchUrl = "https://example.com/project.git";

  const preflight: GitFinishUpdatePreflight = {
    ok: true,
    state: {
      ...state,
      latest_commit: {
        ...state.latest_commit!,
        sha: previousHead,
      },
    },
    policy_resolution: {
      project_root: root,
      sources: {
        global: {
          path: "/config/policies/git-defaults.toml",
        },
        project: {
          present: false,
          path: join(root, ".opencode", "git-policy.toml"),
        },
      },
      effective_policy: structuredClone(policy),
    },
    operation_state: {
      repository_root: root,
      active_operations: [],
    },
    eligibility: {
      eligible: true,
      repository_root: root,
      base_branch: "main",
      current_branch: branch,
      head_sha: previousHead,
      remote: "origin",
      issues: [],
    },
    remote_inspection: {
      repository_root: root,
      remote: "origin",
      fetch_urls: [fetchUrl],
      selected_fetch_url: fetchUrl,
      base_branch: "main",
      base_ref: "refs/heads/main",
      base_commit_sha: baseCommit,
    },
    update_plan: {
      repository_root: root,
      base_branch: "main",
      current_branch: branch,
      local_head_sha: previousHead,
      remote: "origin",
      selected_fetch_url: fetchUrl,
      remote_base_ref: "refs/heads/main",
      remote_base_commit_sha: baseCommit,
      action: "fetch-and-rebase",
    },
  };

  const record = buildGitFinishUpdateProposal(preflight, {
    id: "git-finish-update-publish-test",
    created_at: "2026-08-16T15:00:00Z",
  });

  record.state = {
    status: "applied",
    applied_at: "2026-08-16T15:05:00Z",
    result: {
      previous_head_sha: previousHead,
      resulting_head_sha: resultingHead,
      base_commit_sha: baseCommit,
      rebased: true,
    },
  };

  return record;
}

function validate(
  overrides: {
    state?: Partial<GitRepositoryState>;
    remote?: string;
    active_operations?: string[];
  } = {},
) {
  return validateGitFinishPublishEligibility({
    state: {
      ...state,
      ...overrides.state,
    },
    policy_resolution: {
      project_root: root,
      sources: {
        global: {
          path: "/config/policies/git-defaults.toml",
        },
        project: {
          present: false,
          path: join(root, ".opencode", "git-policy.toml"),
        },
      },
      effective_policy: structuredClone(policy),
    },
    remote: overrides.remote ?? "origin",
    active_operations: overrides.active_operations ?? [],
    update_record: appliedUpdate(),
  });
}

function remoteInspection(
  commitSha: string | null,
): GitCheckpointPushRemoteInspection {
  return {
    repository_root: root,
    remote: "origin",
    fetch_urls: ["https://example.com/project.git"],
    push_urls: ["https://example.com/project.git"],
    selected_push_url: "https://example.com/project.git",
    destination_branch: branch,
    destination_ref: `refs/heads/${branch}`,
    destination:
      commitSha === null
        ? {
            exists: false,
            commit_sha: null,
          }
        : {
            exists: true,
            commit_sha: commitSha,
          },
  };
}

function publishPlan(
  remoteCommit: string | null,
  ancestry: "fast-forward" | "non-fast-forward" | "unavailable" | null,
) {
  return buildGitFinishPublishPlan({
    eligibility: validate(),
    update_record: appliedUpdate(),
    remote_inspection: remoteInspection(remoteCommit),
    ancestry,
  });
}

describe("validateGitFinishPublishEligibility", () => {
  test("accepts the exact applied Update result", () => {
    expect(validate()).toMatchObject({
      eligible: true,
      repository_root: root,
      base_branch: "main",
      current_branch: branch,
      local_head_sha: resultingHead,
      remote: "origin",
      update_proposal_id: "git-finish-update-publish-test",
      previous_head_sha: previousHead,
      update_rebased: true,
      issues: [],
    });
  });

  test("rejects a changed local HEAD", () => {
    const result = validate({
      state: {
        latest_commit: {
          ...state.latest_commit!,
          sha: "dddddddddddddddddddddddddddddddddddddddd",
        },
      },
    });

    expect(
      result.issues.some((issue) => issue.code === "UPDATE_HEAD_MISMATCH"),
    ).toBe(true);
  });

  test("rejects a different explicit remote", () => {
    const result = validate({
      remote: "review",
    });

    expect(
      result.issues.some((issue) => issue.code === "UPDATE_REMOTE_MISMATCH"),
    ).toBe(true);
  });

  test("rejects dirty or active-operation state", () => {
    const result = validate({
      state: {
        clean: false,
        unstaged: ["dirty.txt"],
      },
      active_operations: ["rebase"],
    });

    expect(
      result.issues.some((issue) => issue.code === "WORKTREE_NOT_CLEAN"),
    ).toBe(true);
    expect(
      result.issues.some((issue) => issue.code === "ACTIVE_GIT_OPERATION"),
    ).toBe(true);
  });

  test("rejects a pending Update proposal", () => {
    const record = appliedUpdate();

    record.state = {
      status: "pending",
      applied_at: null,
      result: null,
    };

    const result = validateGitFinishPublishEligibility({
      state,
      policy_resolution: {
        project_root: root,
        sources: {
          global: {
            path: "/config/policies/git-defaults.toml",
          },
          project: {
            present: false,
            path: join(root, ".opencode", "git-policy.toml"),
          },
        },
        effective_policy: structuredClone(policy),
      },
      remote: "origin",
      active_operations: [],
      update_record: record,
    });

    expect(
      result.issues.some(
        (issue) => issue.code === "UPDATE_PROPOSAL_NOT_APPLIED",
      ),
    ).toBe(true);
  });

  test("plans creation of an absent same-name remote branch", () => {
    expect(publishPlan(null, null)).toMatchObject({
      eligible: true,
      disposition: "create",
      remote_commit_sha: null,
      force_with_lease_expected_sha: null,
    });
  });

  test("recognizes an already published branch", () => {
    expect(publishPlan(resultingHead, null)).toMatchObject({
      eligible: true,
      disposition: "up-to-date",
      remote_commit_sha: resultingHead,
      force_with_lease_expected_sha: null,
    });
  });

  test("plans a normal fast-forward publish", () => {
    const remoteCommit = "dddddddddddddddddddddddddddddddddddddddd";

    expect(publishPlan(remoteCommit, "fast-forward")).toMatchObject({
      eligible: true,
      disposition: "fast-forward",
      remote_commit_sha: remoteCommit,
      force_with_lease_expected_sha: null,
    });
  });

  test("allows force-with-lease only against the exact pre-rebase commit", () => {
    expect(publishPlan(previousHead, "non-fast-forward")).toMatchObject({
      eligible: true,
      disposition: "force-with-lease",
      remote_commit_sha: previousHead,
      force_with_lease_expected_sha: previousHead,
    });
  });

  test("rejects an unrelated non-fast-forward remote commit", () => {
    const result = publishPlan(
      "dddddddddddddddddddddddddddddddddddddddd",
      "non-fast-forward",
    );

    expect(result.eligible).toBe(false);
    expect(result.disposition).toBe("non-fast-forward");
    expect(
      result.issues.some(
        (issue) => issue.code === "NON_FAST_FORWARD_UNAUTHORIZED",
      ),
    ).toBe(true);
  });

  test("rejects unavailable remote ancestry", () => {
    const result = publishPlan(
      "dddddddddddddddddddddddddddddddddddddddd",
      "unavailable",
    );

    expect(result.eligible).toBe(false);
    expect(result.disposition).toBe("unavailable");
    expect(
      result.issues.some((issue) => issue.code === "ANCESTRY_UNAVAILABLE"),
    ).toBe(true);
  });
});
