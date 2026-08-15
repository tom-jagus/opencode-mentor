import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { GitCheckpointPushPreflight } from "../lib/git_checkpoint_push";
import {
  buildGitCheckpointPushProposal,
  buildGitCheckpointPushReview,
  gitCheckpointPushProposalIntegrity,
  loadGitCheckpointPushProposal,
  persistGitCheckpointPushProposal,
} from "../lib/git_checkpoint_push_proposal";
import type { GitPolicy } from "../lib/git_policy";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

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
  disposition: "create" | "up-to-date" | "fast-forward" = "create",
): GitCheckpointPushPreflight {
  const root = "/workspace/project";
  const branch = "feature/push-preview";
  const localCommit = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const remoteCommit =
    disposition === "create"
      ? null
      : disposition === "up-to-date"
        ? localCommit
        : "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  return {
    ok: true,
    state: {
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
        sha: localCommit,
        short_sha: "aaaaaaa",
        subject: "Create reviewed checkpoint",
        committed_at: "2026-08-15T10:00:00Z",
      },
      warnings: [],
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
    push_plan: {
      eligible: true,
      repository_root: root,
      base_branch: "main",
      current_branch: branch,
      local_commit_sha: localCommit,
      remote: "review",
      remote_push_url:
        "https://token@example.com/project.git?credential=secret",
      destination_branch: branch,
      destination_ref: `refs/heads/${branch}`,
      remote_commit_sha: remoteCommit,
      disposition,
      issues: [],
    },
    remote_inspection: {
      repository_root: root,
      remote: "review",
      fetch_urls: ["https://example.com/project.git"],
      push_urls: ["https://token@example.com/project.git?credential=secret"],
      selected_push_url:
        "https://token@example.com/project.git?credential=secret",
      destination_branch: branch,
      destination_ref: `refs/heads/${branch}`,
      destination:
        remoteCommit === null
          ? {
              exists: false,
              commit_sha: null,
            }
          : {
              exists: true,
              commit_sha: remoteCommit,
            },
    },
  };
}

describe("Git checkpoint Push proposal", () => {
  test("builds an immutable creation proposal", () => {
    const record = buildGitCheckpointPushProposal(eligiblePreflight(), {
      id: "git-checkpoint-push-test",
      created_at: "2026-08-15T11:00:00Z",
    });

    expect(record.integrity.proposal_sha256).toBe(
      gitCheckpointPushProposalIntegrity(record.proposal),
    );

    expect(buildGitCheckpointPushReview(record)).toMatchObject({
      operation: "push-commit",
      remote: "review",
      push_url_display: "https://***@example.com/project.git",
      destination_branch: "feature/push-preview",
      expected_remote_commit_sha: null,
      disposition: "create",
    });
  });

  test("builds up-to-date and fast-forward proposals", () => {
    for (const disposition of ["up-to-date", "fast-forward"] as const) {
      const record = buildGitCheckpointPushProposal(
        eligiblePreflight(disposition),
      );

      expect(record.proposal.operation.disposition).toBe(disposition);
    }
  });

  test("does not retain mutable preflight references", () => {
    const preflight = eligiblePreflight();
    const record = buildGitCheckpointPushProposal(preflight);

    if (!preflight.ok) {
      throw new Error("Expected eligible Push preflight");
    }

    preflight.push_plan.remote = "tampered";
    preflight.policy_resolution.effective_policy.base_branch = "tampered";

    expect(record.proposal.operation.remote).toBe("review");
    expect(record.proposal.policy.effective_policy.base_branch).toBe("main");
  });

  test("rejects an ineligible preflight", () => {
    const preflight = eligiblePreflight();

    if (!preflight.ok) {
      throw new Error("Expected eligible Push preflight");
    }

    preflight.push_plan.eligible = false;

    expect(() => buildGitCheckpointPushProposal(preflight)).toThrow(
      "Git checkpoint Push preflight is not eligible for Preview",
    );
  });

  test("rejects an inconsistent remote destination", () => {
    const preflight = eligiblePreflight("create");

    if (!preflight.ok || preflight.remote_inspection === null) {
      throw new Error("Expected eligible Push preflight");
    }

    preflight.remote_inspection.destination = {
      exists: true,
      commit_sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    };

    expect(() => buildGitCheckpointPushProposal(preflight)).toThrow(
      "Eligible Push preflight contains inconsistent immutable state",
    );
  });

  test("persists and loads a private project-bound proposal", async () => {
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "opencode-mentor-push-proposal-"),
    );

    try {
      const projectRoot = join(temporaryRoot, "project");
      const storageRoot = join(temporaryRoot, "proposals");

      await mkdir(projectRoot, {
        mode: 0o700,
      });

      const preflight = eligiblePreflight();

      if (!preflight.ok) {
        throw new Error("Expected eligible Push preflight");
      }

      preflight.state.root = projectRoot;
      preflight.push_plan.repository_root = projectRoot;
      preflight.policy_resolution.project_root = projectRoot;
      preflight.policy_resolution.sources.project.path = join(
        projectRoot,
        ".opencode",
        "git-policy.toml",
      );
      preflight.remote_inspection!.repository_root = projectRoot;

      const record = buildGitCheckpointPushProposal(preflight, {
        id: "git-checkpoint-push-load-test",
        created_at: "2026-08-15T12:00:00Z",
      });

      const recordPath = await persistGitCheckpointPushProposal(
        record,
        storageRoot,
      );

      expect(JSON.parse(await readFile(recordPath, "utf8"))).toEqual(record);

      const loaded = await loadGitCheckpointPushProposal(
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
      join(tmpdir(), "opencode-mentor-push-tamper-"),
    );

    try {
      const projectRoot = join(temporaryRoot, "project");
      const storageRoot = join(temporaryRoot, "proposals");

      await mkdir(projectRoot);

      const preflight = eligiblePreflight();

      if (!preflight.ok) {
        throw new Error("Expected eligible Push preflight");
      }

      preflight.state.root = projectRoot;
      preflight.push_plan.repository_root = projectRoot;
      preflight.policy_resolution.project_root = projectRoot;
      preflight.policy_resolution.sources.project.path = join(
        projectRoot,
        ".opencode",
        "git-policy.toml",
      );
      preflight.remote_inspection!.repository_root = projectRoot;

      const record = buildGitCheckpointPushProposal(preflight, {
        id: "git-checkpoint-push-tamper-test",
      });

      const recordPath = await persistGitCheckpointPushProposal(
        record,
        storageRoot,
      );

      const stored = JSON.parse(await readFile(recordPath, "utf8"));

      stored.proposal.created_at = "2026-08-15T13:00:00Z";

      await writeFile(recordPath, `${JSON.stringify(stored, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });

      await expect(
        loadGitCheckpointPushProposal(
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

  test("rejects malformed identifiers before persistence", async () => {
    const record = buildGitCheckpointPushProposal(eligiblePreflight(), {
      id: "wrong-proposal-type",
    });

    await expect(
      persistGitCheckpointPushProposal(
        record,
        "/tmp/opencode-mentor-push-invalid-id",
      ),
    ).rejects.toMatchObject({
      code: "INVALID_PROPOSAL",
    });
  });

  test("rejects malformed identifiers before loading", async () => {
    await expect(
      loadGitCheckpointPushProposal(
        "/workspace/project",
        "../proposal",
        "/tmp/proposals",
      ),
    ).rejects.toMatchObject({
      code: "INVALID_PROPOSAL_ID",
    });
  });
});
