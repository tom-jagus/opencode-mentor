import { describe, expect, test } from "bun:test";
import type { GitPolicy } from "../lib/git_policy";
import type { GitRepositoryState, GitState } from "../lib/git_state";
import {
  type GitFinishUpdateIssueCode,
  validateGitFinishUpdateEligibility,
} from "../lib/git_finish_update";

const policy: GitPolicy = {
  schema_version: 1,
  base_branch: "main",
  branch: {
    allowed_types: ["feature", "fix", "docs", "refactor", "test", "chore"],
    format: "<type>/<kebab-case-summary>",
  },
  commit_message: {
    style: "descriptive",
    subject_case: "sentence",
    trailing_period: false,
    forbidden_prefix_patterns: [
      "^(?:feat|feature|fix|docs|refactor|test|chore)(?:\\([^\\r\\n()]+\\))?:\\s*",
    ],
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

const cleanWorkingState: GitRepositoryState = {
  version: 1,
  available: true,
  repository: true,
  root: "/workspace/project",
  branch: "feature/add-finish-workflow",
  detached: false,
  unborn: false,
  upstream: "origin/feature/add-finish-workflow",
  ahead: 0,
  behind: 0,
  clean: true,
  staged: [],
  unstaged: [],
  untracked: [],
  conflicts: [],
  changes: [],
  latest_commit: {
    sha: "0123456789abcdef0123456789abcdef01234567",
    short_sha: "0123456",
    subject: "Implement finish eligibility",
    committed_at: "2026-08-16T09:00:00Z",
  },
  warnings: [],
};

function validate(
  stateOverrides: Partial<GitRepositoryState> = {},
  activeOperations: string[] = [],
  remote = "origin",
) {
  return validateGitFinishUpdateEligibility({
    state: {
      ...cleanWorkingState,
      ...stateOverrides,
    },
    policy,
    remote,
    active_operations: activeOperations,
  });
}

function issueCodes(
  result: ReturnType<typeof validateGitFinishUpdateEligibility>,
): GitFinishUpdateIssueCode[] {
  return result.issues.map((issue) => issue.code);
}

describe("validateGitFinishUpdateEligibility", () => {
  test("accepts a clean valid working branch with an explicit remote", () => {
    expect(validate()).toEqual({
      eligible: true,
      repository_root: "/workspace/project",
      base_branch: "main",
      current_branch: "feature/add-finish-workflow",
      head_sha: "0123456789abcdef0123456789abcdef01234567",
      remote: "origin",
      issues: [],
    });
  });

  test("rejects unavailable Git inspection", () => {
    const state: GitState = {
      version: 1,
      available: false,
      repository: null,
      directory: "/workspace/project",
      reason: "git-unavailable",
      error: "git executable is unavailable",
    };

    const result = validateGitFinishUpdateEligibility({
      state,
      policy,
      remote: "origin",
      active_operations: [],
    });

    expect(result.issues).toEqual([
      {
        code: "GIT_UNAVAILABLE",
        message: "Git inspection failed: git executable is unavailable",
      },
    ]);
  });

  test("rejects a non-repository workspace", () => {
    const state: GitState = {
      version: 1,
      available: true,
      repository: false,
      directory: "/workspace/project",
      reason: "not-inside-git-worktree",
    };

    const result = validateGitFinishUpdateEligibility({
      state,
      policy,
      remote: "origin",
      active_operations: [],
    });

    expect(issueCodes(result)).toEqual(["NOT_GIT_REPOSITORY"]);
  });

  test("rejects the protected base branch", () => {
    expect(issueCodes(validate({ branch: "main" }))).toContain(
      "ON_PROTECTED_BASE_BRANCH",
    );
  });

  test("rejects detached, unborn, and unavailable HEAD states", () => {
    const result = validate({
      branch: null,
      detached: true,
      unborn: true,
      latest_commit: null,
    });

    expect(issueCodes(result)).toEqual(
      expect.arrayContaining([
        "DETACHED_HEAD",
        "UNBORN_HEAD",
        "HEAD_UNAVAILABLE",
        "CURRENT_BRANCH_INVALID",
      ]),
    );
  });

  test("rejects an invalid working branch name", () => {
    expect(issueCodes(validate({ branch: "hotfix/Repair_Release" }))).toContain(
      "CURRENT_BRANCH_INVALID",
    );
  });

  test("rejects a dirty working tree and unresolved conflicts", () => {
    const result = validate({
      clean: false,
      unstaged: ["src/example.ts"],
      conflicts: ["src/example.ts"],
    });

    expect(issueCodes(result)).toEqual(
      expect.arrayContaining(["WORKTREE_NOT_CLEAN", "UNRESOLVED_CONFLICTS"]),
    );
  });

  test("rejects unavailable working-tree state", () => {
    expect(issueCodes(validate({ clean: null }))).toContain(
      "WORKTREE_STATE_UNAVAILABLE",
    );
  });

  test("rejects active Git operations", () => {
    const result = validate({}, ["rebase", "sequencer"]);

    expect(result.issues).toContainEqual({
      code: "ACTIVE_GIT_OPERATION",
      message:
        "A working branch cannot be finalised during an active Git operation: rebase, sequencer",
    });
  });

  test("requires an explicit remote", () => {
    expect(issueCodes(validate({}, [], "  "))).toContain("REMOTE_REQUIRED");
  });
});
