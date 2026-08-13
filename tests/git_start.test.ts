import { describe, expect, test } from "bun:test";
import type { GitPolicy } from "../lib/git_policy";
import type { GitRepositoryState, GitState } from "../lib/git_state";
import { fileURLToPath } from "node:url";
import {
  runGitStartPreflight,
  validateGitStartEligibility,
} from "../lib/git_start";

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

const cleanBaseState: GitRepositoryState = {
  version: 1,
  available: true,
  repository: true,
  root: "/workspace/project",
  branch: "main",
  detached: false,
  unborn: false,
  upstream: "origin/main",
  ahead: 0,
  behind: 0,
  clean: true,
  staged: [],
  unstaged: [],
  untracked: [],
  conflicts: [],
  changes: [],
  latest_commit: {
    sha: "0123456789abcdef",
    short_sha: "0123456",
    subject: "Establish project baseline",
    committed_at: "2026-08-13T20:00:00Z",
  },
  warnings: [],
};

function validate(
  overrides: Partial<GitRepositoryState> = {},
  targetBranch = "feature/add-start-workflow",
  targetBranchExists = false,
) {
  return validateGitStartEligibility({
    state: {
      ...cleanBaseState,
      ...overrides,
    },
    policy,
    target_branch: targetBranch,
    target_branch_exists: targetBranchExists,
  });
}

describe("validateGitStartEligibility", () => {
  test("accepts a valid start from a clean base branch", () => {
    const result = validate();

    expect(result).toEqual({
      eligible: true,
      repository_root: "/workspace/project",
      base_branch: "main",
      current_branch: "main",
      head_sha: "0123456789abcdef",
      target_branch: "feature/add-start-workflow",
      issues: [],
    });
  });

  test("rejects a non-base current branch", () => {
    const result = validate({
      branch: "feature/existing-work",
    });

    expect(result.issues).toContainEqual({
      code: "NOT_ON_BASE_BRANCH",
      message: 'Current branch must be the effective base branch "main"',
    });
  });

  test("rejects detached and unborn HEAD states", () => {
    const detached = validate({
      branch: null,
      detached: true,
    });

    expect(
      detached.issues.some((issue) => issue.code === "DETACHED_HEAD"),
    ).toBe(true);

    const unborn = validate({
      unborn: true,
      latest_commit: null,
    });

    expect(unborn.issues.some((issue) => issue.code === "UNBORN_HEAD")).toBe(
      true,
    );
    expect(
      unborn.issues.some((issue) => issue.code === "HEAD_UNAVAILABLE"),
    ).toBe(true);
  });

  test("rejects a dirty working tree", () => {
    const result = validate({
      clean: false,
      unstaged: ["src/example.ts"],
    });

    expect(result.issues).toContainEqual({
      code: "WORKTREE_NOT_CLEAN",
      message:
        "The working tree must be clean before starting a working branch",
    });
  });

  test("rejects unresolved conflicts", () => {
    const result = validate({
      clean: false,
      conflicts: ["src/example.ts"],
    });

    expect(
      result.issues.some((issue) => issue.code === "UNRESOLVED_CONFLICTS"),
    ).toBe(true);
  });

  test("rejects invalid or existing target branches", () => {
    const invalid = validate({}, "hotfix/Repair_Release");

    expect(
      invalid.issues.some((issue) => issue.code === "TARGET_BRANCH_INVALID"),
    ).toBe(true);

    const existing = validate({}, "feature/existing-work", true);

    expect(
      existing.issues.some((issue) => issue.code === "TARGET_BRANCH_EXISTS"),
    ).toBe(true);
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

    const result = validateGitStartEligibility({
      state,
      policy,
      target_branch: "feature/add-start-workflow",
      target_branch_exists: false,
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

    const result = validateGitStartEligibility({
      state,
      policy,
      target_branch: "feature/add-start-workflow",
      target_branch_exists: false,
    });

    expect(result.issues[0]?.code).toBe("NOT_GIT_REPOSITORY");
  });

  test("runs read-only preflight against the repository", async () => {
    const configurationRoot = fileURLToPath(
      new URL("..", import.meta.url),
    ).replace(/\/$/, "");

    const result = await runGitStartPreflight({
      directory: configurationRoot,
      configuration_root: configurationRoot,
      target_branch: "feature/opencode-mentor-preflight-test",
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(`Preflight failed at ${result.stage}`);
    }

    expect(result.state.root).toBe(configurationRoot);
    expect(result.policy_resolution.effective_policy.base_branch).toBe("main");
    expect(result.target_branch_exists).toBe(false);

    // This repository is currently on its milestone
    // branch rather than the effective base branch.
    expect(result.eligibility.eligible).toBe(false);
    expect(
      result.eligibility.issues.some(
        (issue) => issue.code === "NOT_ON_BASE_BRANCH",
      ),
    ).toBe(true);
  });
});
