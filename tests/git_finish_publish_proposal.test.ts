import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { GitPolicy } from "../lib/git_policy";
import type { GitFinishPublishPreflight } from "../lib/git_finish_publish";
import type { GitFinishUpdatePreflight } from "../lib/git_finish_update";
import { buildGitFinishUpdateProposal } from "../lib/git_finish_update_proposal";
import {
  buildGitFinishPublishProposal,
  buildGitFinishPublishReview,
  gitFinishPublishProposalIntegrity,
} from "../lib/git_finish_publish_proposal";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  loadGitFinishPublishAppliedProposal,
  loadGitFinishPublishProposal,
  persistGitFinishPublishProposal,
} from "../lib/git_finish_publish_proposal_storage";

const root = "/workspace/project";
const branch = "feature/finish-publish";
const previousHead = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const resultingHead = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const baseCommit = "cccccccccccccccccccccccccccccccccccccccc";
const pushUrl = "https://token@example.com/project.git?credential=secret";

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

function policyResolution(projectRoot = root) {
  return {
    project_root: projectRoot,
    sources: {
      global: {
        path: "/config/policies/git-defaults.toml",
      },
      project: {
        present: false as const,
        path: join(projectRoot, ".opencode", "git-policy.toml"),
      },
    },
    effective_policy: structuredClone(policy),
  };
}

function appliedUpdate(projectRoot = root) {
  const preflight: GitFinishUpdatePreflight = {
    ok: true,
    state: {
      version: 1,
      available: true,
      repository: true,
      root: projectRoot,
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
        sha: previousHead,
        short_sha: "aaaaaaa",
        subject: "Complete feature work",
        committed_at: "2026-08-16T16:00:00Z",
      },
      warnings: [],
    },
    policy_resolution: policyResolution(projectRoot),
    operation_state: {
      repository_root: projectRoot,
      active_operations: [],
    },
    eligibility: {
      eligible: true,
      repository_root: projectRoot,
      base_branch: "main",
      current_branch: branch,
      head_sha: previousHead,
      remote: "origin",
      issues: [],
    },
    remote_inspection: {
      repository_root: projectRoot,
      remote: "origin",
      fetch_urls: [pushUrl],
      selected_fetch_url: pushUrl,
      base_branch: "main",
      base_ref: "refs/heads/main",
      base_commit_sha: baseCommit,
    },
    update_plan: {
      repository_root: projectRoot,
      base_branch: "main",
      current_branch: branch,
      local_head_sha: previousHead,
      remote: "origin",
      selected_fetch_url: pushUrl,
      remote_base_ref: "refs/heads/main",
      remote_base_commit_sha: baseCommit,
      action: "fetch-and-rebase",
    },
  };

  const record = buildGitFinishUpdateProposal(preflight, {
    id: "git-finish-update-publish-proposal-test",
    created_at: "2026-08-16T16:00:00Z",
  });

  record.state = {
    status: "applied",
    applied_at: "2026-08-16T16:05:00Z",
    result: {
      previous_head_sha: previousHead,
      resulting_head_sha: resultingHead,
      base_commit_sha: baseCommit,
      rebased: true,
    },
  };

  return record;
}

function eligiblePreflight(
  disposition:
    | "create"
    | "up-to-date"
    | "fast-forward"
    | "force-with-lease" = "force-with-lease",
  projectRoot = root,
): GitFinishPublishPreflight {
  const update = appliedUpdate(projectRoot);

  const remoteCommit =
    disposition === "create"
      ? null
      : disposition === "up-to-date"
        ? resultingHead
        : disposition === "force-with-lease"
          ? previousHead
          : "dddddddddddddddddddddddddddddddddddddddd";

  return {
    ok: true,
    state: {
      version: 1,
      available: true,
      repository: true,
      root: projectRoot,
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
        sha: resultingHead,
        short_sha: "bbbbbbb",
        subject: "Complete Publish work",
        committed_at: "2026-08-16T16:10:00Z",
      },
      warnings: [],
    },
    policy_resolution: policyResolution(projectRoot),
    operation_state: {
      repository_root: projectRoot,
      active_operations: [],
    },
    update_record: update,
    eligibility: {
      eligible: true,
      repository_root: projectRoot,
      base_branch: "main",
      current_branch: branch,
      local_head_sha: resultingHead,
      remote: "origin",
      update_proposal_id: update.proposal.id,
      previous_head_sha: previousHead,
      update_rebased: true,
      issues: [],
    },
    remote_inspection: {
      repository_root: projectRoot,
      remote: "origin",
      fetch_urls: [pushUrl],
      push_urls: [pushUrl],
      selected_push_url: pushUrl,
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
    publish_plan: {
      eligible: true,
      repository_root: projectRoot,
      base_branch: "main",
      current_branch: branch,
      local_head_sha: resultingHead,
      remote: "origin",
      push_url: pushUrl,
      destination_branch: branch,
      destination_ref: `refs/heads/${branch}`,
      remote_commit_sha: remoteCommit,
      disposition,
      force_with_lease_expected_sha:
        disposition === "force-with-lease" ? previousHead : null,
      update_proposal_id: update.proposal.id,
      issues: [],
    },
  };
}

async function withTemporaryStorage(
  run: (fixture: { projectRoot: string; storageRoot: string }) => Promise<void>,
): Promise<void> {
  const sandbox = await mkdtemp(join(tmpdir(), "git-finish-publish-proposal-"));
  const projectDirectory = join(sandbox, "project");
  const storageRoot = join(sandbox, "storage");

  await mkdir(projectDirectory, {
    mode: 0o700,
  });

  const projectRoot = await realpath(projectDirectory);

  try {
    await run({
      projectRoot,
      storageRoot,
    });
  } finally {
    await rm(sandbox, {
      recursive: true,
      force: true,
    });
  }
}

async function overwriteProposalRecord(
  recordPath: string,
  record: unknown,
): Promise<void> {
  await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

describe("Git Finish Publish proposal", () => {
  test("builds an immutable force-with-lease proposal", () => {
    const record = buildGitFinishPublishProposal(eligiblePreflight(), {
      id: "git-finish-publish-test",
      created_at: "2026-08-16T16:15:00Z",
    });

    expect(record.integrity.proposal_sha256).toBe(
      gitFinishPublishProposalIntegrity(record.proposal),
    );

    expect(record.proposal.operation).toMatchObject({
      kind: "finish-publish",
      disposition: "force-with-lease",
      force_with_lease_expected_sha: previousHead,
    });

    expect(record.proposal.update).toMatchObject({
      previous_head_sha: previousHead,
      resulting_head_sha: resultingHead,
      rebased: true,
    });

    expect(record.state).toEqual({
      status: "pending",
      applied_at: null,
      result: null,
    });
  });

  test("builds all eligible dispositions", () => {
    for (const disposition of [
      "create",
      "up-to-date",
      "fast-forward",
      "force-with-lease",
    ] as const) {
      expect(
        buildGitFinishPublishProposal(eligiblePreflight(disposition)).proposal
          .operation.disposition,
      ).toBe(disposition);
    }
  });

  test("builds a redacted human review", () => {
    const record = buildGitFinishPublishProposal(eligiblePreflight());

    expect(buildGitFinishPublishReview(record)).toMatchObject({
      operation: "finish-publish",
      push_url_display: "https://***@example.com/project.git",
      disposition: "force-with-lease",
      force_with_lease_expected_sha: previousHead,
    });
  });

  test("does not retain mutable preflight references", () => {
    const preflight = eligiblePreflight();
    const record = buildGitFinishPublishProposal(preflight);

    if (!preflight.ok || preflight.publish_plan === null) {
      throw new Error("Expected eligible Publish preflight");
    }

    preflight.publish_plan.remote = "tampered";
    preflight.update_record.state.result.resulting_head_sha =
      "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

    expect(record.proposal.operation.remote).toBe("origin");
    expect(record.proposal.update.resulting_head_sha).toBe(resultingHead);
  });

  test("rejects inconsistent force-with-lease state", () => {
    const preflight = eligiblePreflight();

    if (!preflight.ok || preflight.publish_plan === null) {
      throw new Error("Expected eligible Publish preflight");
    }

    preflight.publish_plan.force_with_lease_expected_sha =
      "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

    expect(() => buildGitFinishPublishProposal(preflight)).toThrow(
      "Force-with-lease Publish lacks exact approved Update provenance",
    );
  });

  test("rejects proposal tampering before review", () => {
    const record = buildGitFinishPublishProposal(eligiblePreflight());

    record.proposal.operation.remote = "tampered";

    expect(() => buildGitFinishPublishReview(record)).toThrow(
      "Finish Publish proposal integrity validation failed",
    );
  });

  test("rejects mutated Update provenance", () => {
    const preflight = eligiblePreflight();

    if (!preflight.ok) {
      throw new Error("Expected eligible Publish preflight");
    }

    preflight.update_record.proposal.operation.remote = "tampered";

    expect(() => buildGitFinishPublishProposal(preflight)).toThrow(
      "Eligible Finish Publish preflight contains inconsistent immutable state",
    );
  });
  test("persists and reloads a pending Publish proposal", async () => {
    await withTemporaryStorage(async ({ projectRoot, storageRoot }) => {
      const record = buildGitFinishPublishProposal(
        eligiblePreflight("force-with-lease", projectRoot),
        {
          id: "git-finish-publish-storage-test",
          created_at: "2026-08-16T16:15:00Z",
        },
      );

      const recordPath = await persistGitFinishPublishProposal(
        record,
        storageRoot,
      );

      const loaded = await loadGitFinishPublishProposal(
        projectRoot,
        record.proposal.id,
        storageRoot,
      );

      expect(loaded.record_path).toBe(recordPath);
      expect(loaded.record).toEqual(record);

      await expect(
        loadGitFinishPublishAppliedProposal(
          projectRoot,
          record.proposal.id,
          storageRoot,
        ),
      ).rejects.toMatchObject({
        code: "PROPOSAL_NOT_APPLIED",
      });
    });
  });

  test("rejects a tampered persisted Publish proposal", async () => {
    await withTemporaryStorage(async ({ projectRoot, storageRoot }) => {
      const record = buildGitFinishPublishProposal(
        eligiblePreflight("force-with-lease", projectRoot),
        {
          id: "git-finish-publish-tamper-test",
        },
      );

      const recordPath = await persistGitFinishPublishProposal(
        record,
        storageRoot,
      );

      record.proposal.operation.remote = "tampered";

      await overwriteProposalRecord(recordPath, record);

      await expect(
        loadGitFinishPublishProposal(
          projectRoot,
          record.proposal.id,
          storageRoot,
        ),
      ).rejects.toMatchObject({
        code: "PROPOSAL_INTEGRITY_FAILED",
      });
    });
  });

  test("loads valid applied Publish provenance", async () => {
    await withTemporaryStorage(async ({ projectRoot, storageRoot }) => {
      const record = buildGitFinishPublishProposal(
        eligiblePreflight("force-with-lease", projectRoot),
        {
          id: "git-finish-publish-applied-test",
        },
      );

      const recordPath = await persistGitFinishPublishProposal(
        record,
        storageRoot,
      );

      record.state = {
        status: "applied",
        applied_at: "2026-08-16T16:20:00Z",
        result: {
          published_commit_sha: resultingHead,
          remote_commit_sha: resultingHead,
          remote_updated: true,
        },
      };

      await overwriteProposalRecord(recordPath, record);

      const loaded = await loadGitFinishPublishAppliedProposal(
        projectRoot,
        record.proposal.id,
        storageRoot,
      );

      expect(loaded.record.state).toEqual(record.state);

      await expect(
        loadGitFinishPublishProposal(
          projectRoot,
          record.proposal.id,
          storageRoot,
        ),
      ).rejects.toMatchObject({
        code: "PROPOSAL_ALREADY_APPLIED",
      });
    });
  });

  test("rejects inconsistent applied Publish results", async () => {
    await withTemporaryStorage(async ({ projectRoot, storageRoot }) => {
      const record = buildGitFinishPublishProposal(
        eligiblePreflight("force-with-lease", projectRoot),
        {
          id: "git-finish-publish-invalid-result-test",
        },
      );

      const recordPath = await persistGitFinishPublishProposal(
        record,
        storageRoot,
      );

      record.state = {
        status: "applied",
        applied_at: "2026-08-16T16:20:00Z",
        result: {
          published_commit_sha: resultingHead,
          remote_commit_sha: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
          remote_updated: true,
        },
      };

      await overwriteProposalRecord(recordPath, record);

      await expect(
        loadGitFinishPublishAppliedProposal(
          projectRoot,
          record.proposal.id,
          storageRoot,
        ),
      ).rejects.toMatchObject({
        code: "INVALID_PROPOSAL",
      });
    });
  });

  test("rejects an incorrect remote-updated result", async () => {
    await withTemporaryStorage(async ({ projectRoot, storageRoot }) => {
      const record = buildGitFinishPublishProposal(
        eligiblePreflight("force-with-lease", projectRoot),
        {
          id: "git-finish-publish-invalid-update-flag-test",
        },
      );

      const recordPath = await persistGitFinishPublishProposal(
        record,
        storageRoot,
      );

      record.state = {
        status: "applied",
        applied_at: "2026-08-16T16:20:00Z",
        result: {
          published_commit_sha: resultingHead,
          remote_commit_sha: resultingHead,
          remote_updated: false,
        },
      };

      await overwriteProposalRecord(recordPath, record);

      await expect(
        loadGitFinishPublishAppliedProposal(
          projectRoot,
          record.proposal.id,
          storageRoot,
        ),
      ).rejects.toMatchObject({
        code: "INVALID_PROPOSAL",
      });
    });
  });
});
