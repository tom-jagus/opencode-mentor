import { describe, expect, test } from "bun:test";
import { lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitStartPreflight } from "../lib/git_start";
import {
  buildGitStartProposal,
  buildGitStartReview,
  gitStartProposalIntegrity,
  persistGitStartProposal,
} from "../lib/git_start_proposal";
import type { GitPolicy } from "../lib/git_policy";
import type { GitRepositoryState } from "../lib/git_state";
import { PolicyError, policyFailure } from "../lib/git_policy";

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

function eligiblePreflight(): GitStartPreflight {
  return {
    ok: true,
    state,
    policy_resolution: {
      project_root: "/workspace/project",
      sources: {
        global: {
          path: "/config/policies/git-defaults.toml",
        },
        project: {
          present: false,
          path: "/workspace/project/.opencode/git-policy.toml",
        },
      },
      effective_policy: policy,
    },
    target_branch_exists: false,
    eligibility: {
      eligible: true,
      repository_root: "/workspace/project",
      base_branch: "main",
      current_branch: "main",
      head_sha: "0123456789abcdef",
      target_branch: "feature/add-start-preview",
      issues: [],
    },
  };
}

describe("Git start proposal", () => {
  test("builds an immutable review candidate", () => {
    const record = buildGitStartProposal(eligiblePreflight(), {
      id: "git-start-test-proposal",
      created_at: "2026-08-13T20:30:00Z",
    });

    expect(record.integrity.proposal_sha256).toBe(
      gitStartProposalIntegrity(record.proposal),
    );

    expect(buildGitStartReview(record)).toMatchObject({
      operation: "create-and-switch-local-branch",
      current_branch: "main",
      base_branch: "main",
      target_branch: "feature/add-start-preview",
      head_sha: "0123456789abcdef",
      working_tree: "clean",
      project_policy_present: false,
    });
  });

  test("rejects an ineligible preflight", () => {
    const preflight = eligiblePreflight();

    if (!preflight.ok) {
      throw new Error("Expected successful preflight");
    }

    preflight.eligibility = {
      ...preflight.eligibility,
      eligible: false,
      issues: [
        {
          code: "WORKTREE_NOT_CLEAN",
          message: "Working tree is not clean",
        },
      ],
    };

    expect(() => buildGitStartProposal(preflight)).toThrow(
      "Git start preflight is not eligible for Preview",
    );
  });

  test("persists a private project-bound proposal", async () => {
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "opencode-mentor-git-start-"),
    );

    try {
      const storageRoot = join(temporaryRoot, "proposals");

      const record = buildGitStartProposal(eligiblePreflight(), {
        id: "git-start-persist-test",
        created_at: "2026-08-13T20:30:00Z",
      });

      await persistGitStartProposal(record, storageRoot);

      const proposalPath = join(
        storageRoot,
        record.proposal.project.key,
        `${record.proposal.id}.json`,
      );

      const status = await lstat(proposalPath);

      expect(status.isFile()).toBe(true);
      expect(status.mode & 0o777).toBe(0o600);

      const stored = JSON.parse(await readFile(proposalPath, "utf8"));

      expect(stored).toEqual(record);
      expect(stored.proposal.project.root).toBe("/workspace/project");
    } finally {
      await rm(temporaryRoot, {
        recursive: true,
        force: true,
      });
    }
  });
  test("preserves strict policy failure details", () => {
    const error = new PolicyError(
      "UNSUPPORTED_SCHEMA_VERSION",
      "project policy schema_version must be 1",
      "project policy",
    );

    expect(policyFailure(error)).toEqual({
      version: 1,
      ok: false,
      error: {
        code: "UNSUPPORTED_SCHEMA_VERSION",
        message: "project policy schema_version must be 1",
        source: "project policy",
      },
    });
  });
});
