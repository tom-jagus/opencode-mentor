import { describe, expect, test } from "bun:test";
import { chmod, lstat, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  persistPrivateJsonRecord,
  readPrivateJsonRecord,
} from "../lib/git_lifecycle_storage";

describe("Git lifecycle proposal storage", () => {
  test("persists and loads a private record", async () => {
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "opencode-mentor-git-storage-"),
    );

    try {
      const storageRoot = join(temporaryRoot, "proposals");
      const record = {
        schema_version: 1,
        value: "reviewed",
      };

      const recordPath = await persistPrivateJsonRecord({
        storage_root: storageRoot,
        project_key: "project-0123456789ab",
        proposal_id: "git-checkpoint-stage-test",
        record,
      });

      const status = await lstat(recordPath);

      expect(status.isFile()).toBe(true);
      expect(status.mode & 0o777).toBe(0o600);

      const loaded = await readPrivateJsonRecord({
        storage_root: storageRoot,
        project_key: "project-0123456789ab",
        proposal_id: "git-checkpoint-stage-test",
      });

      expect(loaded.value).toEqual(record);
      expect(loaded.record_path).toBe(recordPath);
    } finally {
      await rm(temporaryRoot, {
        recursive: true,
        force: true,
      });
    }
  });

  test("does not overwrite an existing proposal", async () => {
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "opencode-mentor-git-duplicate-"),
    );

    try {
      const input = {
        storage_root: join(temporaryRoot, "proposals"),
        project_key: "project-0123456789ab",
        proposal_id: "git-checkpoint-stage-test",
        record: {
          schema_version: 1,
        },
      };

      await persistPrivateJsonRecord(input);

      await expect(persistPrivateJsonRecord(input)).rejects.toMatchObject({
        code: "STORAGE_FAILED",
      });
    } finally {
      await rm(temporaryRoot, {
        recursive: true,
        force: true,
      });
    }
  });

  test("rejects unsafe storage components", async () => {
    await expect(
      persistPrivateJsonRecord({
        storage_root: "/tmp/proposals",
        project_key: "../project",
        proposal_id: "proposal",
        record: {},
      }),
    ).rejects.toMatchObject({
      code: "INVALID_STORAGE_COMPONENT",
    });

    await expect(
      readPrivateJsonRecord({
        storage_root: "/tmp/proposals",
        project_key: "project",
        proposal_id: "../proposal",
      }),
    ).rejects.toMatchObject({
      code: "INVALID_STORAGE_COMPONENT",
    });
  });

  test("rejects symbolic-link path components", async () => {
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "opencode-mentor-git-symlink-"),
    );

    try {
      const realRoot = join(temporaryRoot, "real");
      const storageRoot = join(temporaryRoot, "proposals");

      await mkdir(realRoot, {
        mode: 0o700,
      });
      await symlink(realRoot, storageRoot);

      await expect(
        persistPrivateJsonRecord({
          storage_root: storageRoot,
          project_key: "project-0123456789ab",
          proposal_id: "git-checkpoint-stage-test",
          record: {},
        }),
      ).rejects.toMatchObject({
        code: "INVALID_RECORD_STORAGE",
      });
    } finally {
      await rm(temporaryRoot, {
        recursive: true,
        force: true,
      });
    }
  });

  test("rejects non-private storage permissions", async () => {
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "opencode-mentor-git-mode-"),
    );

    try {
      const storageRoot = join(temporaryRoot, "proposals");

      await mkdir(storageRoot, {
        mode: 0o700,
      });
      await chmod(storageRoot, 0o755);

      await expect(
        persistPrivateJsonRecord({
          storage_root: storageRoot,
          project_key: "project-0123456789ab",
          proposal_id: "git-checkpoint-stage-test",
          record: {},
        }),
      ).rejects.toMatchObject({
        code: "INVALID_RECORD_STORAGE",
      });
    } finally {
      await rm(temporaryRoot, {
        recursive: true,
        force: true,
      });
    }
  });

  test("reports missing records", async () => {
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "opencode-mentor-git-missing-"),
    );

    try {
      await expect(
        readPrivateJsonRecord({
          storage_root: join(temporaryRoot, "proposals"),
          project_key: "project-0123456789ab",
          proposal_id: "git-checkpoint-stage-missing",
        }),
      ).rejects.toMatchObject({
        code: "RECORD_NOT_FOUND",
      });
    } finally {
      await rm(temporaryRoot, {
        recursive: true,
        force: true,
      });
    }
  });
});
