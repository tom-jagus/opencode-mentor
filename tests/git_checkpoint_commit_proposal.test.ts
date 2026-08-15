import { describe, expect, test } from "bun:test";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitCheckpointCommitPreflight } from "../lib/git_checkpoint_commit";
import {
  buildGitCheckpointCommitProposal,
  buildGitCheckpointCommitReview,
  gitCheckpointCommitProposalIntegrity,
  loadGitCheckpointCommitProposal,
  persistGitCheckpointCommitProposal,
} from "../lib/git_checkpoint_commit_proposal";
import type { GitPolicy } from "../lib/git_policy";
import { sha256 } from "../lib/git_lifecycle_proposal";

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

function eligiblePreflight(
  projectRoot = "/workspace/project",
): GitCheckpointCommitPreflight {
  const patch = [
    "diff --git a/file.ts b/file.ts",
    "index 1111111..2222222 100644",
    "--- a/file.ts",
    "+++ b/file.ts",
    "@@ -1 +1 @@",
    "-before",
    "+after",
    "",
  ].join("\n");

  const changes = [
    {
      path: "file.ts",
      index_status: "M",
      worktree_status: " ",
    },
    {
      path: "remaining.ts",
      index_status: " ",
      worktree_status: "M",
    },
  ];

  return {
    ok: true,
    state: {
      version: 1,
      available: true,
      repository: true,
      root: projectRoot,
      branch: "feature/add-commit-preview",
      detached: false,
      unborn: false,
      upstream: null,
      ahead: null,
      behind: null,
      clean: false,
      staged: ["file.ts"],
      unstaged: ["remaining.ts"],
      untracked: [],
      conflicts: [],
      changes,
      latest_commit: {
        sha: "0123456789abcdef0123456789abcdef01234567",
        short_sha: "0123456",
        subject: "Complete checkpoint Stage",
        committed_at: "2026-08-14T09:00:00Z",
      },
      warnings: [],
    },
    policy_resolution: {
      project_root: projectRoot,
      sources: {
        global: {
          path: "/config/policies/git-defaults.toml",
        },
        project: {
          present: false,
          path: join(projectRoot, ".opencode", "git-policy.toml"),
        },
      },
      effective_policy: structuredClone(policy),
    },
    commit_plan: {
      eligible: true,
      repository_root: projectRoot,
      base_branch: "main",
      current_branch: "feature/add-commit-preview",
      head_sha: "0123456789abcdef0123456789abcdef01234567",
      staged_changes: [structuredClone(changes[0]!)],
      remaining_changes: [structuredClone(changes[1]!)],
      commit_message: "Implement checkpoint Commit Preview",
      message_validation: {
        valid: true,
        issues: [],
        subject: "Implement checkpoint Commit Preview",
        body_present: false,
        semantic_review: [
          "Confirm that the subject clearly describes the actual coherent change",
          "Confirm that the subject is descriptive rather than generic",
        ],
      },
      issues: [],
    },
    diff: {
      repository_root: projectRoot,
      patch,
      patch_bytes: Buffer.byteLength(patch, "utf8"),
      patch_sha256: sha256(patch),
    },
  };
}

describe("Git checkpoint Commit proposal", () => {
  test("builds an immutable review candidate", () => {
    const preflight = eligiblePreflight();

    const record = buildGitCheckpointCommitProposal(preflight, {
      id: "git-checkpoint-commit-test",
      created_at: "2026-08-14T10:00:00Z",
    });

    expect(record.integrity.proposal_sha256).toBe(
      gitCheckpointCommitProposalIntegrity(record.proposal),
    );

    if (!preflight.ok || preflight.diff === null) {
      throw new Error("Expected eligible Commit preflight");
    }

    expect(
      buildGitCheckpointCommitReview(record, preflight.diff),
    ).toMatchObject({
      operation: "commit-staged-diff",
      current_branch: "feature/add-commit-preview",
      commit_message: "Implement checkpoint Commit Preview",
      staged_changes: [{ path: "file.ts" }],
      remaining_changes: [{ path: "remaining.ts" }],
      staged_diff: expect.stringContaining("diff --git a/file.ts b/file.ts"),
      project_policy_present: false,
    });
  });

  test("rejects an ineligible preflight", () => {
    const preflight = eligiblePreflight();

    if (!preflight.ok) {
      throw new Error("Expected successful preflight");
    }

    preflight.commit_plan.eligible = false;

    expect(() => buildGitCheckpointCommitProposal(preflight)).toThrow(
      "Git checkpoint Commit preflight is not eligible for Preview",
    );
  });

  test("does not retain mutable input references", () => {
    const preflight = eligiblePreflight();
    const record = buildGitCheckpointCommitProposal(preflight);

    if (!preflight.ok) {
      throw new Error("Expected successful preflight");
    }

    preflight.state.changes[0]!.path = "tampered.ts";
    preflight.policy_resolution.effective_policy.base_branch = "tampered";

    expect(record.proposal.repository.changes[0]?.path).toBe("file.ts");
    expect(record.proposal.policy.effective_policy.base_branch).toBe("main");
  });

  test("persists and loads a private project-bound proposal", async () => {
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "opencode-mentor-commit-proposal-"),
    );

    try {
      const projectRoot = join(temporaryRoot, "project");
      const storageRoot = join(temporaryRoot, "proposals");

      await mkdir(projectRoot, {
        mode: 0o700,
      });

      const record = buildGitCheckpointCommitProposal(
        eligiblePreflight(projectRoot),
        {
          id: "git-checkpoint-commit-load-test",
          created_at: "2026-08-14T10:00:00Z",
        },
      );

      const recordPath = await persistGitCheckpointCommitProposal(
        record,
        storageRoot,
      );

      const status = await lstat(recordPath);

      expect(status.isFile()).toBe(true);
      expect(status.mode & 0o777).toBe(0o600);
      expect(JSON.parse(await readFile(recordPath, "utf8"))).toEqual(record);

      const loaded = await loadGitCheckpointCommitProposal(
        projectRoot,
        record.proposal.id,
        storageRoot,
      );

      expect(loaded.record).toEqual(record);
      expect(loaded.record_path).toBe(recordPath);
    } finally {
      await rm(temporaryRoot, {
        recursive: true,
        force: true,
      });
    }
  });

  test("rejects tampered persisted content", async () => {
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "opencode-mentor-commit-tamper-"),
    );

    try {
      const projectRoot = join(temporaryRoot, "project");
      const storageRoot = join(temporaryRoot, "proposals");

      await mkdir(projectRoot, {
        mode: 0o700,
      });

      const record = buildGitCheckpointCommitProposal(
        eligiblePreflight(projectRoot),
        {
          id: "git-checkpoint-commit-tamper-test",
        },
      );

      const recordPath = await persistGitCheckpointCommitProposal(
        record,
        storageRoot,
      );

      const stored = JSON.parse(await readFile(recordPath, "utf8"));

      stored.proposal.created_at = "2026-08-14T11:00:00Z";

      await writeFile(recordPath, `${JSON.stringify(stored, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });

      await expect(
        loadGitCheckpointCommitProposal(
          projectRoot,
          record.proposal.id,
          storageRoot,
        ),
      ).rejects.toMatchObject({
        code: "PROPOSAL_INTEGRITY_FAILED",
      });
    } finally {
      await rm(temporaryRoot, {
        recursive: true,
        force: true,
      });
    }
  });

  test("rejects malformed proposal identifiers", async () => {
    await expect(
      loadGitCheckpointCommitProposal(
        "/workspace/project",
        "../proposal",
        "/tmp/proposals",
      ),
    ).rejects.toMatchObject({
      code: "INVALID_PROPOSAL_ID",
    });
  });

  test("rejects malformed identifiers before persistence", async () => {
    const record = buildGitCheckpointCommitProposal(eligiblePreflight(), {
      id: "wrong-proposal-type",
    });

    await expect(
      persistGitCheckpointCommitProposal(
        record,
        "/tmp/opencode-mentor-commit-invalid-id",
      ),
    ).rejects.toMatchObject({
      code: "INVALID_PROPOSAL",
    });
  });
});
