import { describe, expect, test } from "bun:test";
import type { GitCheckpointStagePreflight } from "../lib/git_checkpoint";
import {
  buildGitCheckpointStageProposal,
  buildGitCheckpointStageReview,
  gitCheckpointStageProposalIntegrity,
  loadGitCheckpointStageProposal,
  persistGitCheckpointStageProposal,
} from "../lib/git_checkpoint_stage_proposal";
import type { GitPolicy } from "../lib/git_policy";
import type { GitRepositoryState } from "../lib/git_state";
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
import { canonicalJson, sha256 } from "../lib/git_lifecycle_proposal";
import { validateGitCheckpointStageApplyFreshness } from "../lib/git_checkpoint_stage_apply";

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
  branch: "feature/add-checkpoint-stage",
  detached: false,
  unborn: false,
  upstream: null,
  ahead: null,
  behind: null,
  clean: false,
  staged: [],
  unstaged: ["lib/selected.ts"],
  untracked: ["notes.txt"],
  conflicts: [],
  changes: [
    {
      path: "lib/selected.ts",
      index_status: " ",
      worktree_status: "M",
    },
    {
      path: "notes.txt",
      index_status: "?",
      worktree_status: "?",
    },
  ],
  latest_commit: {
    sha: "0123456789abcdef0123456789abcdef01234567",
    short_sha: "0123456",
    subject: "Establish baseline",
    committed_at: "2026-08-14T08:00:00Z",
  },
  warnings: [],
};

function eligiblePreflight(
  projectRoot = state.root,
): GitCheckpointStagePreflight {
  const projectState = structuredClone(state);

  projectState.root = projectRoot;

  return {
    ok: true,
    state: projectState,
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
    stage_plan: {
      eligible: true,
      repository_root: projectRoot,
      base_branch: "main",
      current_branch: "feature/add-checkpoint-stage",
      head_sha: "0123456789abcdef0123456789abcdef01234567",
      selected_changes: [structuredClone(projectState.changes[0]!)],
      unselected_changes: [structuredClone(projectState.changes[1]!)],
      staging_pathspecs: ["lib/selected.ts"],
      issues: [],
    },
    snapshot: (() => {
      const paths = [
        {
          path: "lib/selected.ts",
          kind: "file" as const,
          sha256:
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          size: 17,
          executable: false,
        },
      ];

      return {
        repository_root: projectRoot,
        paths,
        snapshot_sha256: sha256(canonicalJson(paths)),
      };
    })(),
  };
}

describe("Git checkpoint Stage proposal", () => {
  test("builds an immutable review candidate", () => {
    const preflight = eligiblePreflight();

    const record = buildGitCheckpointStageProposal(preflight, {
      id: "git-checkpoint-stage-test",
      created_at: "2026-08-14T09:00:00Z",
    });

    expect(record.integrity.proposal_sha256).toBe(
      gitCheckpointStageProposalIntegrity(record.proposal),
    );

    expect(buildGitCheckpointStageReview(record)).toMatchObject({
      operation: "stage-selected-paths",
      repository_root: "/workspace/project",
      base_branch: "main",
      current_branch: "feature/add-checkpoint-stage",
      selected_changes: [
        {
          path: "lib/selected.ts",
        },
      ],
      unselected_changes: [
        {
          path: "notes.txt",
        },
      ],
      staging_pathspecs: ["lib/selected.ts"],
      project_policy_present: false,
      path_snapshots: [
        {
          path: "lib/selected.ts",
          kind: "file",
          size: 17,
          executable: false,
        },
      ],
      snapshot_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  test("rejects an ineligible preflight", () => {
    const preflight = eligiblePreflight();

    if (!preflight.ok) {
      throw new Error("Expected successful preflight");
    }

    preflight.stage_plan.eligible = false;
    preflight.stage_plan.issues = [
      {
        code: "EMPTY_STAGING_SELECTION",
        message: "At least one path is required",
      },
    ];

    expect(() => buildGitCheckpointStageProposal(preflight)).toThrow(
      "Git checkpoint Stage preflight is not eligible for Preview",
    );
  });

  test("rejects an inconsistent staging plan", () => {
    const preflight = eligiblePreflight();

    if (!preflight.ok) {
      throw new Error("Expected successful preflight");
    }

    preflight.stage_plan.staging_pathspecs = ["notes.txt"];

    expect(() => buildGitCheckpointStageProposal(preflight)).toThrow(
      "Eligible Stage preflight contains an inconsistent staging plan",
    );
  });

  test("does not retain mutable input references", () => {
    const preflight = eligiblePreflight();

    const record = buildGitCheckpointStageProposal(preflight, {
      id: "git-checkpoint-stage-clone-test",
    });

    if (!preflight.ok) {
      throw new Error("Expected successful preflight");
    }

    preflight.state.changes[0]!.path = "tampered.ts";
    preflight.policy_resolution.effective_policy.base_branch = "tampered";

    expect(record.proposal.repository.changes[0]?.path).toBe("lib/selected.ts");
    expect(record.proposal.policy.effective_policy.base_branch).toBe("main");
    expect(record.integrity.proposal_sha256).toBe(
      gitCheckpointStageProposalIntegrity(record.proposal),
    );
  });
  test("persists a private project-bound Stage proposal", async () => {
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "opencode-mentor-stage-proposal-"),
    );

    try {
      const storageRoot = join(temporaryRoot, "proposals");

      const record = buildGitCheckpointStageProposal(eligiblePreflight(), {
        id: "git-checkpoint-stage-persist-test",
        created_at: "2026-08-14T09:00:00Z",
      });

      const recordPath = await persistGitCheckpointStageProposal(
        record,
        storageRoot,
      );

      const status = await lstat(recordPath);

      expect(status.isFile()).toBe(true);
      expect(status.mode & 0o777).toBe(0o600);

      const stored = JSON.parse(await readFile(recordPath, "utf8"));

      expect(stored).toEqual(record);
      expect(stored.proposal.project.root).toBe("/workspace/project");
    } finally {
      await rm(temporaryRoot, {
        recursive: true,
        force: true,
      });
    }
  });

  test("rejects a tampered record before persistence", async () => {
    const record = buildGitCheckpointStageProposal(eligiblePreflight(), {
      id: "git-checkpoint-stage-tampered-test",
    });

    record.proposal.operation.selected_paths = ["tampered.ts"];

    await expect(
      persistGitCheckpointStageProposal(
        record,
        "/tmp/opencode-mentor-stage-test",
      ),
    ).rejects.toMatchObject({
      code: "INVALID_PROPOSAL",
    });
  });
  test("loads an intact pending Stage proposal", async () => {
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "opencode-mentor-stage-load-"),
    );

    try {
      const projectRoot = join(temporaryRoot, "project");
      const storageRoot = join(temporaryRoot, "proposals");

      await mkdir(projectRoot, {
        mode: 0o700,
      });

      const record = buildGitCheckpointStageProposal(
        eligiblePreflight(projectRoot),
        {
          id: "git-checkpoint-stage-load-test",
          created_at: "2026-08-14T09:00:00Z",
        },
      );

      await persistGitCheckpointStageProposal(record, storageRoot);

      const loaded = await loadGitCheckpointStageProposal(
        projectRoot,
        record.proposal.id,
        storageRoot,
      );

      expect(loaded.record).toEqual(record);
      expect(loaded.record_path).toBe(
        join(
          storageRoot,
          record.proposal.project.key,
          `${record.proposal.id}.json`,
        ),
      );
    } finally {
      await rm(temporaryRoot, {
        recursive: true,
        force: true,
      });
    }
  });

  test("rejects tampered persisted Stage proposal content", async () => {
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "opencode-mentor-stage-tamper-"),
    );

    try {
      const projectRoot = join(temporaryRoot, "project");
      const storageRoot = join(temporaryRoot, "proposals");

      await mkdir(projectRoot, {
        mode: 0o700,
      });

      const record = buildGitCheckpointStageProposal(
        eligiblePreflight(projectRoot),
        {
          id: "git-checkpoint-stage-tamper-test",
          created_at: "2026-08-14T09:00:00Z",
        },
      );

      const recordPath = await persistGitCheckpointStageProposal(
        record,
        storageRoot,
      );

      const stored = JSON.parse(await readFile(recordPath, "utf8"));

      // Keep the schema valid so the
      // integrity check is what fails.
      stored.proposal.created_at = "2026-08-14T10:00:00Z";

      await writeFile(recordPath, `${JSON.stringify(stored, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });

      await expect(
        loadGitCheckpointStageProposal(
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

  test("rejects malformed Stage proposal identifiers", async () => {
    await expect(
      loadGitCheckpointStageProposal(
        "/workspace/project",
        "../proposal",
        "/tmp/proposals",
      ),
    ).rejects.toMatchObject({
      code: "INVALID_PROPOSAL_ID",
    });

    await expect(
      loadGitCheckpointStageProposal(
        "/workspace/project",
        "git-start-proposal",
        "/tmp/proposals",
      ),
    ).rejects.toMatchObject({
      code: "INVALID_PROPOSAL_ID",
    });
  });

  test("does not load a Stage proposal through another project root", async () => {
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "opencode-mentor-stage-binding-"),
    );

    try {
      const firstProject = join(temporaryRoot, "first-project");
      const secondProject = join(temporaryRoot, "second-project");
      const storageRoot = join(temporaryRoot, "proposals");

      await Promise.all([
        mkdir(firstProject, {
          mode: 0o700,
        }),
        mkdir(secondProject, {
          mode: 0o700,
        }),
      ]);

      const record = buildGitCheckpointStageProposal(
        eligiblePreflight(firstProject),
        {
          id: "git-checkpoint-stage-binding-test",
        },
      );

      await persistGitCheckpointStageProposal(record, storageRoot);

      await expect(
        loadGitCheckpointStageProposal(
          secondProject,
          record.proposal.id,
          storageRoot,
        ),
      ).rejects.toMatchObject({
        code: "PROPOSAL_NOT_FOUND",
      });
    } finally {
      await rm(temporaryRoot, {
        recursive: true,
        force: true,
      });
    }
  });
  test("rejects an inconsistent selected-content snapshot", () => {
    const preflight = eligiblePreflight();

    if (!preflight.ok) {
      throw new Error("Expected successful preflight");
    }

    if (preflight.snapshot === null) {
      throw new Error("Expected Stage snapshot");
    }

    preflight.snapshot.paths[0]!.sha256 =
      "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

    expect(() => buildGitCheckpointStageProposal(preflight)).toThrow(
      "Eligible Stage preflight contains an inconsistent staging plan",
    );
  });
  test("accepts unchanged Stage Apply freshness state", () => {
    const preflight = eligiblePreflight();

    const record = buildGitCheckpointStageProposal(preflight, {
      id: "git-checkpoint-stage-fresh-test",
    });

    expect(
      validateGitCheckpointStageApplyFreshness(record, preflight),
    ).toMatchObject({
      record,
      preflight,
    });
  });

  test("rejects changed selected path content", () => {
    const preflight = eligiblePreflight();

    const record = buildGitCheckpointStageProposal(preflight, {
      id: "git-checkpoint-stage-stale-content",
    });

    if (!preflight.ok || preflight.snapshot === null) {
      throw new Error("Expected eligible Stage preflight");
    }

    preflight.snapshot.paths[0]!.sha256 =
      "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
    preflight.snapshot.snapshot_sha256 = sha256(
      canonicalJson(preflight.snapshot.paths),
    );

    expect(() =>
      validateGitCheckpointStageApplyFreshness(record, preflight),
    ).toThrow("selected path content changed");
  });

  test("rejects changed HEAD", () => {
    const preflight = eligiblePreflight();

    const record = buildGitCheckpointStageProposal(preflight, {
      id: "git-checkpoint-stage-stale-head",
    });

    if (!preflight.ok) {
      throw new Error("Expected eligible Stage preflight");
    }

    preflight.state.latest_commit = {
      ...preflight.state.latest_commit!,
      sha: "ffffffffffffffffffffffffffffffffffffffff",
    };

    expect(() =>
      validateGitCheckpointStageApplyFreshness(record, preflight),
    ).toThrow("HEAD changed");
  });

  test("rejects changed repository status", () => {
    const preflight = eligiblePreflight();

    const record = buildGitCheckpointStageProposal(preflight, {
      id: "git-checkpoint-stage-stale-status",
    });

    if (!preflight.ok) {
      throw new Error("Expected eligible Stage preflight");
    }

    preflight.state.changes[0]!.worktree_status = " ";

    expect(() =>
      validateGitCheckpointStageApplyFreshness(record, preflight),
    ).toThrow("inspected repository changes changed");
  });
});
