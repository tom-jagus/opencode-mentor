import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  discardGitCheckpointStageBackup,
  rollbackGitCheckpointStage,
  stageGitCheckpointPaths,
} from "../lib/git_checkpoint_stage_mutation";

type GitResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

async function runGit(
  repositoryRoot: string,
  args: string[],
): Promise<GitResult> {
  const process = Bun.spawn(
    [
      "git",
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.hooksPath=/dev/null",
      ...args,
    ],
    {
      cwd: repositoryRoot,
      env: {
        ...Bun.env,
        GIT_TERMINAL_PROMPT: "0",
        LANG: "C",
        LC_ALL: "C",
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);

  return {
    stdout,
    stderr,
    exitCode,
  };
}

async function requireGit(
  repositoryRoot: string,
  args: string[],
): Promise<GitResult> {
  const result = await runGit(repositoryRoot, args);

  if (result.exitCode !== 0) {
    throw new Error(
      result.stderr.trim() ||
        `git ${args.join(" ")} exited with code ${result.exitCode}`,
    );
  }

  return result;
}

function changedPaths(output: string): string[] {
  const value = output.trim();

  if (value.length === 0) {
    return [];
  }

  return value
    .split("\n")
    .filter((path) => path.length > 0)
    .sort();
}

async function stagedPaths(repositoryRoot: string): Promise<string[]> {
  const result = await requireGit(repositoryRoot, [
    "diff",
    "--cached",
    "--name-only",
  ]);

  return changedPaths(result.stdout);
}

async function createRepository(repositoryRoot: string): Promise<void> {
  await mkdir(repositoryRoot);

  await requireGit(repositoryRoot, ["init", "-b", "main"]);
  await requireGit(repositoryRoot, [
    "config",
    "user.name",
    "OpenCode Mentor Test",
  ]);
  await requireGit(repositoryRoot, [
    "config",
    "user.email",
    "test@example.invalid",
  ]);

  await Promise.all([
    writeFile(
      join(repositoryRoot, "selected.txt"),
      "selected baseline\n",
      "utf8",
    ),
    writeFile(
      join(repositoryRoot, "unselected.txt"),
      "unselected baseline\n",
      "utf8",
    ),
    writeFile(
      join(repositoryRoot, "preexisting.txt"),
      "preexisting baseline\n",
      "utf8",
    ),
  ]);

  await requireGit(repositoryRoot, ["add", "-A", "--", "."]);
  await requireGit(repositoryRoot, [
    "commit",
    "-m",
    "Establish test repository",
  ]);
  await requireGit(repositoryRoot, [
    "switch",
    "-c",
    "feature/stage-mutation-test",
  ]);

  await Promise.all([
    writeFile(
      join(repositoryRoot, "selected.txt"),
      "selected changed\n",
      "utf8",
    ),
    writeFile(
      join(repositoryRoot, "unselected.txt"),
      "unselected changed\n",
      "utf8",
    ),
  ]);
}

describe("Git checkpoint Stage mutation", () => {
  let temporaryRoot: string;
  let repositoryRoot: string;

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(
      join(tmpdir(), "opencode-mentor-stage-mutation-"),
    );
    repositoryRoot = join(temporaryRoot, "project");

    await createRepository(repositoryRoot);
  });

  afterEach(async () => {
    await rm(temporaryRoot, {
      recursive: true,
      force: true,
    });
  });

  test("stages only explicitly selected paths", async () => {
    const backup = await stageGitCheckpointPaths(repositoryRoot, [
      "selected.txt",
    ]);

    expect(await stagedPaths(repositoryRoot)).toEqual(["selected.txt"]);

    const status = await requireGit(repositoryRoot, [
      "status",
      "--porcelain=v1",
    ]);

    expect(status.stdout).toContain("M  selected.txt");
    expect(status.stdout).toContain(" M unselected.txt");

    await discardGitCheckpointStageBackup(backup);
  });

  test("rollback restores an initially clean index", async () => {
    const backup = await stageGitCheckpointPaths(repositoryRoot, [
      "selected.txt",
    ]);

    expect(await stagedPaths(repositoryRoot)).toEqual(["selected.txt"]);

    await rollbackGitCheckpointStage(backup);

    expect(await stagedPaths(repositoryRoot)).toEqual([]);

    const status = await requireGit(repositoryRoot, [
      "status",
      "--porcelain=v1",
    ]);

    expect(status.stdout).toContain(" M selected.txt");
    expect(status.stdout).toContain(" M unselected.txt");
  });

  test("rollback preserves content staged before the operation", async () => {
    await writeFile(
      join(repositoryRoot, "preexisting.txt"),
      "preexisting staged change\n",
      "utf8",
    );

    await requireGit(repositoryRoot, ["add", "--", "preexisting.txt"]);

    expect(await stagedPaths(repositoryRoot)).toEqual(["preexisting.txt"]);

    const backup = await stageGitCheckpointPaths(repositoryRoot, [
      "selected.txt",
    ]);

    expect(await stagedPaths(repositoryRoot)).toEqual([
      "preexisting.txt",
      "selected.txt",
    ]);

    await rollbackGitCheckpointStage(backup);

    expect(await stagedPaths(repositoryRoot)).toEqual(["preexisting.txt"]);

    const status = await requireGit(repositoryRoot, [
      "status",
      "--porcelain=v1",
    ]);

    expect(status.stdout).toContain("M  preexisting.txt");
    expect(status.stdout).toContain(" M selected.txt");
  });

  test("discarding the backup keeps the staged index", async () => {
    const backup = await stageGitCheckpointPaths(repositoryRoot, [
      "selected.txt",
    ]);

    await discardGitCheckpointStageBackup(backup);

    expect(await stagedPaths(repositoryRoot)).toEqual(["selected.txt"]);
  });

  test("rejects empty and duplicate pathspecs", async () => {
    await expect(
      stageGitCheckpointPaths(repositoryRoot, []),
    ).rejects.toMatchObject({
      code: "INVALID_STAGING_PATHS",
    });

    await expect(
      stageGitCheckpointPaths(repositoryRoot, ["selected.txt", "selected.txt"]),
    ).rejects.toMatchObject({
      code: "INVALID_STAGING_PATHS",
    });

    expect(await stagedPaths(repositoryRoot)).toEqual([]);
  });
});
