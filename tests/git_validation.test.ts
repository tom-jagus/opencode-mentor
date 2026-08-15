import { describe, expect, test } from "bun:test";
import type { GitPolicy } from "../lib/git_policy";
import {
  validateCommitMessage,
  validateWorkingBranchName,
} from "../lib/git_validation";

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

describe("validateWorkingBranchName", () => {
  test("accepts an approved branch name", () => {
    expect(
      validateWorkingBranchName("feature/add-policy-validation", policy),
    ).toEqual({
      valid: true,
      issues: [],
    });
  });

  test("rejects an unconfigured branch type", () => {
    const validation = validateWorkingBranchName(
      "hotfix/repair-release",
      policy,
    );

    expect(validation.valid).toBe(false);
    expect(validation.issues).toContainEqual({
      code: "DISALLOWED_BRANCH_TYPE",
      message: 'Branch type "hotfix" is not allowed',
    });
  });

  test("rejects a non-kebab-case summary", () => {
    const validation = validateWorkingBranchName(
      "feature/Add_Validation",
      policy,
    );

    expect(validation.valid).toBe(false);
    expect(validation.issues).toContainEqual({
      code: "INVALID_BRANCH_SUMMARY",
      message: "Branch summary must use lowercase kebab case",
    });
  });

  test("rejects additional path segments", () => {
    const validation = validateWorkingBranchName(
      "feature/policy/validation",
      policy,
    );

    expect(validation.issues[0]?.code).toBe("INVALID_BRANCH_GRAMMAR");
  });

  test("uses project-overridden branch types", () => {
    const overriddenPolicy: GitPolicy = {
      ...policy,
      branch: {
        ...policy.branch,
        allowed_types: ["fix", "docs"],
      },
    };

    expect(
      validateWorkingBranchName("feature/add-validation", overriddenPolicy)
        .valid,
    ).toBe(false);

    expect(
      validateWorkingBranchName("docs/explain-validation", overriddenPolicy)
        .valid,
    ).toBe(true);
  });
});

describe("validateCommitMessage", () => {
  test("accepts a descriptive natural-language subject", () => {
    const validation = validateCommitMessage(
      "Implement deterministic Git validation",
      policy,
    );

    expect(validation.valid).toBe(true);
    expect(validation.subject).toBe("Implement deterministic Git validation");
    expect(validation.body_present).toBe(false);
    expect(validation.semantic_review).not.toHaveLength(0);
  });

  test("rejects Conventional Commit prefixes", () => {
    for (const subject of [
      "feat: add validation",
      "fix(policy): reject invalid branch",
      "docs: explain policy",
    ]) {
      const validation = validateCommitMessage(subject, policy);

      expect(
        validation.issues.some(
          (issue) => issue.code === "FORBIDDEN_COMMIT_PREFIX",
        ),
      ).toBe(true);
    }
  });

  test("rejects a lowercase subject", () => {
    const validation = validateCommitMessage(
      "implement deterministic validation",
      policy,
    );

    expect(validation.issues).toContainEqual({
      code: "SUBJECT_CASE",
      message: "Commit subject must begin with an uppercase letter",
    });
  });

  test("rejects a trailing period", () => {
    const validation = validateCommitMessage(
      "Implement deterministic validation.",
      policy,
    );

    expect(validation.issues).toContainEqual({
      code: "SUBJECT_TRAILING_PERIOD",
      message: "Commit subject must not end with a period",
    });
  });

  test("reports a body for semantic review", () => {
    const validation = validateCommitMessage(
      [
        "Implement deterministic Git validation",
        "",
        "Validate branch names and commit subjects.",
      ].join("\n"),
      policy,
    );

    expect(validation.valid).toBe(true);
    expect(validation.body_present).toBe(true);
    expect(validation.semantic_review).toContain(
      "Confirm that the body adds material information rather than repeating the subject",
    );
  });

  test("rejects an empty message", () => {
    const validation = validateCommitMessage("", policy);

    expect(validation.valid).toBe(false);
    expect(validation.issues[0]?.code).toBe("EMPTY_COMMIT_MESSAGE");
  });

  test("rejects non-canonical commit message bytes", () => {
    for (const message of [
      "Implement validation\n",
      "Implement validation\r\n\r\nExplain the change",
      "Implement\0 validation",
    ]) {
      const validation = validateCommitMessage(message, policy);

      expect(validation.issues).toContainEqual({
        code: "NON_CANONICAL_COMMIT_MESSAGE",
        message:
          "Commit message must use LF line separators, contain no NUL bytes, and omit a trailing newline",
      });
    }
  });
});
