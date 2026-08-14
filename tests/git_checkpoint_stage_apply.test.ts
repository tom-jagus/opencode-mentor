import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runGitCheckpointStagePreflight } from "../lib/git_checkpoint";
import { prepareGitCheckpointStageApply } from "../lib/git_checkpoint_stage_apply";
import {
  buildGitCheckpointStageProposal,
  persistGitCheckpointStageProposal,
} from "../lib/git_checkpoint_stage_proposal";

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
        GIT_OPTIONAL_LOCKS: "0",
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

  await writeFile(
    join(repositoryRoot, "README.md"),
    "# Test repository\n",
    "utf8",
  );

  await requireGit(repositoryRoot, ["add", "--", "README.md"]);
  await requireGit(repositoryRoot, [
    "commit",
    "-m",
    "Establish test repository",
  ]);
  await requireGit(repositoryRoot, [
    "switch",
    "-c",
    "feature/stage-apply-test",
  ]);

  await writeFile(
    join(repositoryRoot, "README.md"),
    "# Changed repository\n",
    "utf8",
  );
}

describe("prepareGitCheckpointStageApply", () => {
  let temporaryRoot: string;
  let repositoryRoot: string;
  let storageRoot: string;

  const configurationRoot = fileURLToPath(
    new URL("..", import.meta.url),
  ).replace(/\/$/, "");

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(
      join(tmpdir(), "opencode-mentor-stage-apply-"),
    );
    repositoryRoot = join(temporaryRoot, "project");
    storageRoot = join(temporaryRoot, "proposals");

    await createRepository(repositoryRoot);
  });

  afterEach(async () => {
    await rm(temporaryRoot, {
      recursive: true,
      force: true,
    });
  });

  async function persistEligibleProposal() {
    const preflight = await runGitCheckpointStagePreflight({
      directory: repositoryRoot,
      configuration_root: configurationRoot,
      selected_paths: ["README.md"],
    });

    expect(preflight.ok).toBe(true);

    if (!preflight.ok) {
      throw new Error(`Preflight failed at ${preflight.stage}`);
    }

    expect(preflight.stage_plan.eligible).toBe(true);
    expect(preflight.snapshot).not.toBeNull();

    const record = buildGitCheckpointStageProposal(preflight);

    await persistGitCheckpointStageProposal(record, storageRoot);

    return record;
  }

  test("prepares an unchanged eligible Stage proposal", async () => {
    const record = await persistEligibleProposal();

    const prepared = await prepareGitCheckpointStageApply({
      directory: repositoryRoot,
      configuration_root: configurationRoot,
      proposal_id: record.proposal.id,
      storage_root: storageRoot,
    });

    expect(prepared.record.proposal.id).toBe(record.proposal.id);
    expect(prepared.preflight.stage_plan.eligible).toBe(true);
    expect(prepared.preflight.snapshot?.snapshot_sha256).toBe(
      record.proposal.repository.snapshot.snapshot_sha256,
    );
  });

  test("rejects changed selected content", async () => {
    const record = await persistEligibleProposal();

    await writeFile(
      join(repositoryRoot, "README.md"),
      "# Changed again\n",
      "utf8",
    );

    await expect(
      prepareGitCheckpointStageApply({
        directory: repositoryRoot,
        configuration_root: configurationRoot,
        proposal_id: record.proposal.id,
        storage_root: storageRoot,
      }),
    ).rejects.toThrow("selected path content changed");
  });

  test("rejects changed HEAD", async () => {
    const record = await persistEligibleProposal();

    await requireGit(repositoryRoot, [
      "commit",
      "--allow-empty",
      "-m",
      "Advance test HEAD",
    ]);

    await expect(
      prepareGitCheckpointStageApply({
        directory: repositoryRoot,
        configuration_root: configurationRoot,
        proposal_id: record.proposal.id,
        storage_root: storageRoot,
      }),
    ).rejects.toThrow("HEAD changed");
  });
});
