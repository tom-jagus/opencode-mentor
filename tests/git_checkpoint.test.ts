import { describe, expect, test } from "bun:test";
import {
  runGitCheckpointStagePreflight,
  validateGitCheckpointStagePlan,
} from "../lib/git_checkpoint";
import type { GitPolicy } from "../lib/git_policy";
import type {
  FileChange,
  GitRepositoryState,
  GitState,
} from "../lib/git_state";
import { fileURLToPath } from "node:url";

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

const changes: FileChange[] = [
  {
    path: "lib/git_checkpoint.ts",
    index_status: " ",
    worktree_status: "M",
  },
  {
    path: "tests/git_checkpoint.test.ts",
    index_status: "?",
    worktree_status: "?",
  },
];

const workingState: GitRepositoryState = {
  version: 1,
  available: true,
  repository: true,
  root: "/workspace/project",
  branch: "feature/add-checkpoint-validation",
  detached: false,
  unborn: false,
  upstream: null,
  ahead: null,
  behind: null,
  clean: false,
  staged: [],
  unstaged: ["lib/git_checkpoint.ts"],
  untracked: ["tests/git_checkpoint.test.ts"],
  conflicts: [],
  changes,
  latest_commit: {
    sha: "0123456789abcdef",
    short_sha: "0123456",
    subject: "Add Git start workflow",
    committed_at: "2026-08-13T20:00:00Z",
  },
  warnings: [],
};

function validate(
  overrides: Partial<GitRepositoryState> = {},
  selectedPaths = ["tests/git_checkpoint.test.ts", "lib/git_checkpoint.ts"],
) {
  return validateGitCheckpointStagePlan({
    state: {
      ...workingState,
      ...overrides,
    },
    policy,
    selected_paths: selectedPaths,
  });
}

describe("validateGitCheckpointStagePlan", () => {
  test("accepts a valid explicit staging selection", () => {
    const result = validate();

    expect(result.eligible).toBe(true);
    expect(result.repository_root).toBe("/workspace/project");
    expect(result.current_branch).toBe("feature/add-checkpoint-validation");
    expect(result.selected_changes).toEqual(changes);
    expect(result.unselected_changes).toEqual([]);
    expect(result.staging_pathspecs).toEqual([
      "lib/git_checkpoint.ts",
      "tests/git_checkpoint.test.ts",
    ]);
    expect(result.issues).toEqual([]);
  });

  test("rejects the effective protected base branch", () => {
    const result = validate({
      branch: "main",
    });

    expect(result.issues).toContainEqual({
      code: "ON_PROTECTED_BASE_BRANCH",
      message:
        'A checkpoint cannot be committed directly to the effective base branch "main"',
    });
  });

  test("rejects detached, unborn, and unavailable HEAD states", () => {
    const result = validate({
      branch: null,
      detached: true,
      unborn: true,
      latest_commit: null,
    });

    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "DETACHED_HEAD",
        "UNBORN_HEAD",
        "HEAD_UNAVAILABLE",
        "CURRENT_BRANCH_INVALID",
      ]),
    );
  });

  test("rejects a branch that violates effective policy", () => {
    const result = validate({
      branch: "hotfix/Repair_Release",
    });

    expect(
      result.issues.some((issue) => issue.code === "CURRENT_BRANCH_INVALID"),
    ).toBe(true);
  });

  test("rejects unavailable worktree state and conflicts", () => {
    const result = validate({
      clean: null,
      conflicts: ["lib/git_checkpoint.ts"],
    });

    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "WORKTREE_STATE_UNAVAILABLE",
        "UNRESOLVED_CONFLICTS",
      ]),
    );
  });

  test("rejects empty, duplicate, and unknown selections", () => {
    const empty = validate({}, []);

    expect(
      empty.issues.some((issue) => issue.code === "EMPTY_STAGING_SELECTION"),
    ).toBe(true);

    const invalid = validate({}, [
      "lib/git_checkpoint.ts",
      "lib/git_checkpoint.ts",
      "missing.ts",
    ]);

    expect(invalid.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "DUPLICATE_STAGING_SELECTION",
        "SELECTED_PATH_NOT_CHANGED",
      ]),
    );
  });

  test("requires already-staged paths in the explicit selection", () => {
    const stagedChanges: FileChange[] = [
      {
        path: "already-staged.ts",
        index_status: "M",
        worktree_status: " ",
      },
      ...changes,
    ];

    const result = validate(
      {
        staged: ["already-staged.ts"],
        changes: stagedChanges,
      },
      ["lib/git_checkpoint.ts", "tests/git_checkpoint.test.ts"],
    );

    expect(
      result.issues.some((issue) => issue.code === "STAGED_PATH_NOT_SELECTED"),
    ).toBe(true);
  });

  test("preserves repository order independently of selection order", () => {
    const result = validate({}, [
      "tests/git_checkpoint.test.ts",
      "lib/git_checkpoint.ts",
    ]);

    expect(result.selected_changes.map((change) => change.path)).toEqual([
      "lib/git_checkpoint.ts",
      "tests/git_checkpoint.test.ts",
    ]);
  });

  test("includes both paths when staging a rename", () => {
    const renamedChange: FileChange = {
      path: "new-name.ts",
      original_path: "old-name.ts",
      index_status: "R",
      worktree_status: " ",
    };

    const result = validate(
      {
        staged: ["old-name.ts -> new-name.ts"],
        unstaged: [],
        untracked: [],
        changes: [renamedChange],
      },
      ["new-name.ts"],
    );

    expect(result.staging_pathspecs).toEqual(["old-name.ts", "new-name.ts"]);
  });

  test("does not mutate repository state or selection input", () => {
    const state = structuredClone(workingState);
    const selectedPaths = [
      "tests/git_checkpoint.test.ts",
      "lib/git_checkpoint.ts",
    ];
    const stateBefore = structuredClone(state);
    const selectionBefore = [...selectedPaths];

    validateGitCheckpointStagePlan({
      state,
      policy,
      selected_paths: selectedPaths,
    });

    expect(state).toEqual(stateBefore);
    expect(selectedPaths).toEqual(selectionBefore);
  });

  test("rejects unavailable Git and non-repository states", () => {
    const unavailable: GitState = {
      version: 1,
      available: false,
      repository: null,
      directory: "/workspace/project",
      reason: "git-unavailable",
      error: "git executable is unavailable",
    };

    const unavailableResult = validateGitCheckpointStagePlan({
      state: unavailable,
      policy,
      selected_paths: [],
    });

    expect(unavailableResult.issues[0]?.code).toBe("GIT_UNAVAILABLE");

    const notRepository: GitState = {
      version: 1,
      available: true,
      repository: false,
      directory: "/workspace/project",
      reason: "not-inside-git-worktree",
    };

    const notRepositoryResult = validateGitCheckpointStagePlan({
      state: notRepository,
      policy,
      selected_paths: [],
    });

    expect(notRepositoryResult.issues[0]?.code).toBe("NOT_GIT_REPOSITORY");
  });
  test("reports no changes when the inspected state is clean", () => {
    const result = validate(
      {
        clean: true,
        staged: [],
        unstaged: [],
        untracked: [],
        changes: [],
      },
      [],
    );

    expect(result.issues.some((issue) => issue.code === "NO_CHANGES")).toBe(
      true,
    );
  });

  test("separates selected and unselected changes", () => {
    const result = validate({}, ["lib/git_checkpoint.ts"]);

    expect(result.selected_changes.map((change) => change.path)).toEqual([
      "lib/git_checkpoint.ts",
    ]);

    expect(result.unselected_changes.map((change) => change.path)).toEqual([
      "tests/git_checkpoint.test.ts",
    ]);

    expect(result.staging_pathspecs).toEqual(["lib/git_checkpoint.ts"]);
  });

  test("accepts an already-staged path when explicitly selected", () => {
    const stagedChange: FileChange = {
      path: "lib/git_checkpoint.ts",
      index_status: "M",
      worktree_status: " ",
    };

    const result = validate(
      {
        staged: ["lib/git_checkpoint.ts"],
        unstaged: [],
        untracked: [],
        changes: [stagedChange],
      },
      ["lib/git_checkpoint.ts"],
    );

    expect(
      result.issues.some((issue) => issue.code === "STAGED_PATH_NOT_SELECTED"),
    ).toBe(false);
    expect(result.eligible).toBe(true);
  });

  test("runs read-only checkpoint preflight against the repository", async () => {
    const configurationRoot = fileURLToPath(
      new URL("..", import.meta.url),
    ).replace(/\/$/, "");

    const result = await runGitCheckpointStagePreflight({
      directory: configurationRoot,
      configuration_root: configurationRoot,
      selected_paths: [],
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(`Preflight failed at ${result.stage}`);
    }

    expect(result.state.root).toBe(configurationRoot);
    expect(result.policy_resolution.effective_policy.base_branch).toBe("main");
    expect(result.stage_plan.repository_root).toBe(configurationRoot);
    expect(result.stage_plan.base_branch).toBe("main");
    expect(result.snapshot).toBeNull();
  });
});
