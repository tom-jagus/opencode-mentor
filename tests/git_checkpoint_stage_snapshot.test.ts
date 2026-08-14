import { describe, expect, test } from "bun:test";
import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectGitCheckpointStageSnapshot } from "../lib/git_checkpoint_stage_snapshot";

describe("Git checkpoint Stage snapshot", () => {
  test("snapshots selected files, links, and missing paths", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "opencode-mentor-stage-snapshot-"),
    );

    try {
      await writeFile(join(root, "selected.txt"), "selected content\n");
      await chmod(join(root, "selected.txt"), 0o700);
      await symlink("selected.txt", join(root, "selected-link"));

      const snapshot = await inspectGitCheckpointStageSnapshot(root, [
        "selected.txt",
        "selected-link",
        "deleted.txt",
      ]);

      expect(snapshot.paths).toEqual([
        {
          path: "selected.txt",
          kind: "file",
          sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
          size: 17,
          executable: true,
        },
        {
          path: "selected-link",
          kind: "symlink",
          sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
          size: 12,
          executable: null,
        },
        {
          path: "deleted.txt",
          kind: "missing",
          sha256: null,
          size: null,
          executable: null,
        },
      ]);

      expect(snapshot.snapshot_sha256).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      await rm(root, {
        recursive: true,
        force: true,
      });
    }
  });

  test("changes fingerprint when selected content changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-mentor-stage-change-"));

    try {
      const path = join(root, "selected.txt");

      await writeFile(path, "before\n");

      const before = await inspectGitCheckpointStageSnapshot(root, [
        "selected.txt",
      ]);

      await writeFile(path, "after\n");

      const after = await inspectGitCheckpointStageSnapshot(root, [
        "selected.txt",
      ]);

      expect(after.snapshot_sha256).not.toBe(before.snapshot_sha256);
    } finally {
      await rm(root, {
        recursive: true,
        force: true,
      });
    }
  });

  test("changes fingerprint when executable state changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-mentor-stage-mode-"));

    try {
      const path = join(root, "selected.txt");

      await writeFile(path, "content\n");
      await chmod(path, 0o600);

      const before = await inspectGitCheckpointStageSnapshot(root, [
        "selected.txt",
      ]);

      await chmod(path, 0o700);

      const after = await inspectGitCheckpointStageSnapshot(root, [
        "selected.txt",
      ]);

      expect(after.snapshot_sha256).not.toBe(before.snapshot_sha256);
    } finally {
      await rm(root, {
        recursive: true,
        force: true,
      });
    }
  });

  test("rejects paths outside the repository", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-mentor-stage-escape-"));

    try {
      await expect(
        inspectGitCheckpointStageSnapshot(root, ["../outside.txt"]),
      ).rejects.toMatchObject({
        code: "INVALID_SNAPSHOT_PATH",
      });
    } finally {
      await rm(root, {
        recursive: true,
        force: true,
      });
    }
  });

  test("rejects directories", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "opencode-mentor-stage-directory-"),
    );

    try {
      await mkdir(join(root, "directory"));

      await expect(
        inspectGitCheckpointStageSnapshot(root, ["directory"]),
      ).rejects.toMatchObject({
        code: "UNSUPPORTED_PATH_TYPE",
      });
    } finally {
      await rm(root, {
        recursive: true,
        force: true,
      });
    }
  });
});
