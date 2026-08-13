import { describe, expect, test } from "bun:test";
import { resolvePolicyDocuments } from "./git_policy";

const globalPolicy = `
schema_version = 1
base_branch = "main"

[branch]
allowed_types = ["feature", "fix", "docs", "refactor", "test", "chore"]
format = "<type>/<kebab-case-summary>"

[commit_message]
style = "descriptive"
subject_case = "sentence"
trailing_period = false
forbidden_prefix_patterns = ["^(?:feat|fix)(?:\\\\([^\\\\r\\\\n()]+\\\\))?:\\\\s*"]

[merge]
strategy = "squash"
delete_branch = true

[branch_update]
strategy = "rebase"
require_before_finalization = true
force_push = "force-with-lease"

[validation]
profile = "standard"

[pull_request]
draft = false
generated_body = true

[release]
enabled = true
versioning = "semantic"
tag_prefix = "v"
notes = "generated-reviewable"
`;

function expectPolicyError(action: () => unknown, code: string): void {
  try {
    action();
  } catch (error) {
    expect(error).toMatchObject({ code });
    return;
  }

  throw new Error(`Expected policy error ${code}`);
}

describe("resolvePolicyDocuments", () => {
  test("resolves the complete global policy without an override", () => {
    const policy = resolvePolicyDocuments(globalPolicy);

    expect(policy.base_branch).toBe("main");
    expect(policy.branch.allowed_types).toEqual([
      "feature",
      "fix",
      "docs",
      "refactor",
      "test",
      "chore",
    ]);
    expect(policy.release.enabled).toBe(true);
  });

  test("recursively merges sparse tables and replaces scalars", () => {
    const policy = resolvePolicyDocuments(
      globalPolicy,
      `
schema_version = 1

[pull_request]
draft = true

[release]
enabled = false
`,
    );

    expect(policy.pull_request).toEqual({
      draft: true,
      generated_body: true,
    });
    expect(policy.release).toEqual({
      enabled: false,
      versioning: "semantic",
      tag_prefix: "v",
      notes: "generated-reviewable",
    });
  });

  test("replaces arrays rather than appending", () => {
    const policy = resolvePolicyDocuments(
      globalPolicy,
      `
schema_version = 1

[branch]
allowed_types = ["fix", "docs"]
`,
    );

    expect(policy.branch.allowed_types).toEqual(["fix", "docs"]);
  });

  test("treats malformed TOML as a hard failure", () => {
    expectPolicyError(
      () => resolvePolicyDocuments(globalPolicy, "release = ="),
      "POLICY_PARSE_FAILED",
    );
  });

  test("rejects unsupported schema versions", () => {
    expectPolicyError(
      () => resolvePolicyDocuments(globalPolicy, "schema_version = 2"),
      "UNSUPPORTED_SCHEMA_VERSION",
    );
  });

  test("rejects unknown top-level keys", () => {
    expectPolicyError(
      () =>
        resolvePolicyDocuments(
          globalPolicy,
          `
schema_version = 1
shell_validation = true
`,
        ),
      "UNKNOWN_POLICY_KEY",
    );
  });

  test("rejects unknown nested keys", () => {
    expectPolicyError(
      () =>
        resolvePolicyDocuments(
          globalPolicy,
          `
schema_version = 1

[release]
publish_automatically = true
`,
        ),
      "UNKNOWN_POLICY_KEY",
    );
  });

  test("rejects unapproved branch types", () => {
    expectPolicyError(
      () =>
        resolvePolicyDocuments(
          globalPolicy,
          `
schema_version = 1

[branch]
allowed_types = ["feature", "hotfix"]
`,
        ),
      "INVALID_POLICY_VALUE",
    );
  });

  test("validates the merged effective result", () => {
    expectPolicyError(
      () =>
        resolvePolicyDocuments(
          globalPolicy,
          `
schema_version = 1

[branch]
allowed_types = []
`,
        ),
      "INVALID_POLICY_VALUE",
    );
  });

  test("resolves the repository global policy", async () => {
    const policyText = await Bun.file(
      new URL("../policies/git-defaults.toml", import.meta.url),
    ).text();

    const policy = resolvePolicyDocuments(policyText);

    expect(policy.schema_version).toBe(1);
    expect(policy.base_branch).toBe("main");
    expect(policy.merge.strategy).toBe("squash");
    expect(policy.release.enabled).toBe(true);
  });
});
