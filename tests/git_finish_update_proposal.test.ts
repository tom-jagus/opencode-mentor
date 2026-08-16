import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { GitFinishUpdatePreflight } from "../lib/git_finish_update";
import type { GitPolicy } from "../lib/git_policy";
import {
  buildGitFinishUpdateProposal,
  buildGitFinishUpdateReview,
  gitFinishUpdateProposalIntegrity,
} from "../lib/git_finish_update_proposal";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  loadGitFinishUpdateAppliedProposal,
  loadGitFinishUpdateProposal,
  persistGitFinishUpdateProposal,
} from "../lib/git_finish_update_proposal_storage";

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
  root = "/workspace/project",
): GitFinishUpdatePreflight {
  const branch = "feature/finish-update";
  const localHead = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const baseCommit = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const fetchUrl = "https://token@example.com/project.git?credential=secret";

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
        sha: localHead,
        short_sha: "aaaaaaa",
        subject: "Complete feature work",
        committed_at: "2026-08-16T10:00:00Z",
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
    operation_state: {
      repository_root: root,
      active_operations: [],
    },
    eligibility: {
      eligible: true,
      repository_root: root,
      base_branch: "main",
      current_branch: branch,
      head_sha: localHead,
      remote: "review",
      issues: [],
    },
    remote_inspection: {
      repository_root: root,
      remote: "review",
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
      local_head_sha: localHead,
      remote: "review",
      selected_fetch_url: fetchUrl,
      remote_base_ref: "refs/heads/main",
      remote_base_commit_sha: baseCommit,
      action: "fetch-and-rebase",
    },
  };
}

describe("Git Finish Update proposal", () => {
  test("builds an immutable checksummed proposal", () => {
    const record = buildGitFinishUpdateProposal(eligiblePreflight(), {
      id: "git-finish-update-test",
      created_at: "2026-08-16T11:00:00Z",
    });

    expect(record.integrity.proposal_sha256).toBe(
      gitFinishUpdateProposalIntegrity(record.proposal),
    );

    expect(record).toMatchObject({
      schema_version: 1,
      proposal: {
        id: "git-finish-update-test",
        operation: {
          kind: "finish-update",
          base_branch: "main",
          current_branch: "feature/finish-update",
          remote: "review",
          action: "fetch-and-rebase",
        },
        remote: {
          base_ref: "refs/heads/main",
          base_commit_sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
      },
      state: {
        status: "pending",
        applied_at: null,
        result: null,
      },
    });
  });

  test("builds a redacted human review", () => {
    const record = buildGitFinishUpdateProposal(eligiblePreflight());

    expect(buildGitFinishUpdateReview(record)).toMatchObject({
      operation: "finish-update",
      remote: "review",
      fetch_url_display: "https://***@example.com/project.git",
      remote_base_ref: "refs/heads/main",
      action: "fetch-and-rebase",
      project_policy_present: false,
    });
  });

  test("does not retain mutable preflight references", () => {
    const preflight = eligiblePreflight();
    const record = buildGitFinishUpdateProposal(preflight);

    if (!preflight.ok || preflight.update_plan === null) {
      throw new Error("Expected eligible Finish Update preflight");
    }

    preflight.update_plan.remote = "tampered";
    preflight.policy_resolution.effective_policy.base_branch = "tampered";

    expect(record.proposal.operation.remote).toBe("review");
    expect(record.proposal.policy.effective_policy.base_branch).toBe("main");
  });

  test("rejects an ineligible preflight", () => {
    const preflight = eligiblePreflight();

    if (!preflight.ok) {
      throw new Error("Expected eligible Finish Update preflight");
    }

    preflight.eligibility.eligible = false;

    expect(() => buildGitFinishUpdateProposal(preflight)).toThrow(
      "Git Finish Update preflight is not eligible for Preview",
    );
  });

  test("rejects inconsistent immutable remote state", () => {
    const preflight = eligiblePreflight();

    if (!preflight.ok || preflight.remote_inspection === null) {
      throw new Error("Expected eligible Finish Update preflight");
    }

    preflight.remote_inspection.base_commit_sha =
      "cccccccccccccccccccccccccccccccccccccccc";

    expect(() => buildGitFinishUpdateProposal(preflight)).toThrow(
      "Eligible Finish Update preflight contains inconsistent immutable state",
    );
  });

  test("rejects proposal tampering before review", () => {
    const record = buildGitFinishUpdateProposal(eligiblePreflight());

    record.proposal.operation.remote = "tampered";

    expect(() => buildGitFinishUpdateReview(record)).toThrow(
      "Finish Update proposal integrity validation failed",
    );
  });

  test("persists and loads a private project-bound proposal", async () => {
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "opencode-mentor-finish-update-proposal-"),
    );

    try {
      const projectRoot = join(temporaryRoot, "project");
      const storageRoot = join(temporaryRoot, "proposals");

      await mkdir(projectRoot, {
        mode: 0o700,
      });

      const record = buildGitFinishUpdateProposal(
        eligiblePreflight(projectRoot),
        {
          id: "git-finish-update-load-test",
          created_at: "2026-08-16T12:00:00Z",
        },
      );

      const recordPath = await persistGitFinishUpdateProposal(
        record,
        storageRoot,
      );

      expect(JSON.parse(await readFile(recordPath, "utf8"))).toEqual(record);

      const loaded = await loadGitFinishUpdateProposal(
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

  test("rejects tampered persisted proposal content", async () => {
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "opencode-mentor-finish-update-tamper-"),
    );

    try {
      const projectRoot = join(temporaryRoot, "project");
      const storageRoot = join(temporaryRoot, "proposals");

      await mkdir(projectRoot);

      const record = buildGitFinishUpdateProposal(
        eligiblePreflight(projectRoot),
        {
          id: "git-finish-update-tamper-test",
        },
      );

      const recordPath = await persistGitFinishUpdateProposal(
        record,
        storageRoot,
      );

      const stored = JSON.parse(await readFile(recordPath, "utf8"));
      stored.proposal.created_at = "2026-08-16T13:00:00Z";

      await writeFile(recordPath, `${JSON.stringify(stored, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });

      await expect(
        loadGitFinishUpdateProposal(
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
    const record = buildGitFinishUpdateProposal(eligiblePreflight(), {
      id: "wrong-proposal-type",
    });

    await expect(
      persistGitFinishUpdateProposal(
        record,
        "/tmp/opencode-mentor-finish-update-invalid-id",
      ),
    ).rejects.toMatchObject({
      code: "INVALID_PROPOSAL",
    });
  });

  test("rejects malformed identifiers before loading", async () => {
    await expect(
      loadGitFinishUpdateProposal(
        "/workspace/project",
        "../proposal",
        "/tmp/proposals",
      ),
    ).rejects.toMatchObject({
      code: "INVALID_PROPOSAL_ID",
    });
  });

  test("rejects pending state as applied provenance", async () => {
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "opencode-mentor-finish-update-pending-"),
    );

    try {
      const projectRoot = join(temporaryRoot, "project");
      const storageRoot = join(temporaryRoot, "proposals");

      await mkdir(projectRoot);

      const record = buildGitFinishUpdateProposal(
        eligiblePreflight(projectRoot),
        {
          id: "git-finish-update-pending-test",
        },
      );

      await persistGitFinishUpdateProposal(record, storageRoot);

      await expect(
        loadGitFinishUpdateAppliedProposal(
          projectRoot,
          record.proposal.id,
          storageRoot,
        ),
      ).rejects.toMatchObject({
        code: "PROPOSAL_NOT_APPLIED",
      });
    } finally {
      await rm(temporaryRoot, {
        recursive: true,
        force: true,
      });
    }
  });
});
