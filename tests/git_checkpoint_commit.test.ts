import { describe, expect, test } from "bun:test";
import type { GitPolicy } from "../lib/git_policy";
import type { FileChange, GitRepositoryState } from "../lib/git_state";
import { validateGitCheckpointCommitPlan } from "../lib/git_checkpoint_commit";

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
    path: "staged.ts",
    index_status: "M",
    worktree_status: " ",
  },
  {
    path: "partially-staged.ts",
    index_status: "M",
    worktree_status: "M",
  },
  {
    path: "unstaged.ts",
    index_status: " ",
    worktree_status: "M",
  },
];

const state: GitRepositoryState = {
  version: 1,
  available: true,
  repository: true,
  root: "/workspace/project",
  branch: "feature/add-commit-transaction",
  detached: false,
  unborn: false,
  upstream: null,
  ahead: null,
  behind: null,
  clean: false,
  staged: ["staged.ts", "partially-staged.ts"],
  unstaged: ["partially-staged.ts", "unstaged.ts"],
  untracked: [],
  conflicts: [],
  changes,
  latest_commit: {
    sha: "0123456789abcdef0123456789abcdef01234567",
    short_sha: "0123456",
    subject: "Complete the checkpoint Stage transaction",
    committed_at: "2026-08-14T14:28:32+02:00",
  },
  warnings: [],
};

function validate(
  overrides: Partial<GitRepositoryState> = {},
  commitMessage = "Implement the checkpoint Commit preflight",
) {
  return validateGitCheckpointCommitPlan({
    state: {
      ...state,
      ...overrides,
    },
    policy,
    commit_message: commitMessage,
  });
}

describe("validateGitCheckpointCommitPlan", () => {
  test("accepts a valid staged checkpoint", () => {
    const result = validate();

    expect(result.eligible).toBe(true);
    expect(result.staged_changes.map((change) => change.path)).toEqual([
      "staged.ts",
      "partially-staged.ts",
    ]);
    expect(result.remaining_changes.map((change) => change.path)).toEqual([
      "partially-staged.ts",
      "unstaged.ts",
    ]);
    expect(result.message_validation.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  test("rejects a commit without staged changes", () => {
    const result = validate({
      staged: [],
      changes: [
        {
          path: "unstaged.ts",
          index_status: " ",
          worktree_status: "M",
        },
      ],
    });

    expect(result.issues).toContainEqual({
      code: "NO_STAGED_CHANGES",
      message: "There are no staged changes to commit",
    });
  });

  test("rejects the protected base branch", () => {
    const result = validate({
      branch: "main",
    });

    expect(result.issues).toContainEqual({
      code: "ON_PROTECTED_BASE_BRANCH",
      message:
        'A checkpoint cannot be committed directly to the effective base branch "main"',
    });
  });

  test("rejects unresolved conflicts", () => {
    const result = validate({
      conflicts: ["conflicted.ts"],
    });

    expect(
      result.issues.some((issue) => issue.code === "UNRESOLVED_CONFLICTS"),
    ).toBe(true);
  });

  test("rejects a mechanically invalid message", () => {
    const result = validate({}, "feat: add Commit support");

    expect(
      result.issues.some((issue) => issue.code === "INVALID_COMMIT_MESSAGE"),
    ).toBe(true);

    expect(result.message_validation.issues).toContainEqual({
      code: "FORBIDDEN_COMMIT_PREFIX",
      message: "Commit subject uses a prohibited categorical prefix",
    });
  });

  test("rejects non-canonical message input", () => {
    const result = validate({}, "Implement the checkpoint Commit preflight\n");

    expect(result.message_validation.issues).toContainEqual({
      code: "NON_CANONICAL_COMMIT_MESSAGE",
      message:
        "Commit message must use LF line separators, contain no NUL bytes, and omit a trailing newline",
    });
  });
});
