import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runGitCheckpointCommitPreflight } from "../lib/git_checkpoint_commit";
import {
  applyGitCheckpointCommitProposal,
  prepareGitCheckpointCommitApply,
} from "../lib/git_checkpoint_commit_apply";
import {
  buildGitCheckpointCommitProposal,
  persistGitCheckpointCommitProposal,
} from "../lib/git_checkpoint_commit_proposal";

type GitResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

async function git(root: string, args: string[]): Promise<GitResult> {
  const subprocess = Bun.spawn(["git", ...args], {
    cwd: root,
    env: {
      ...Bun.env,
      GIT_TERMINAL_PROMPT: "0",
      LANG: "C",
      LC_ALL: "C",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
    subprocess.exited,
  ]);

  return {
    stdout,
    stderr,
    exitCode,
  };
}

async function requireGit(root: string, args: string[]): Promise<GitResult> {
  const result = await git(root, args);

  if (result.exitCode !== 0) {
    throw new Error(
      result.stderr.trim() ||
        `git ${args.join(" ")} exited with code ${result.exitCode}`,
    );
  }

  return result;
}

describe("Git checkpoint Commit Apply preparation", () => {
  let temporaryRoot: string;
  let repositoryRoot: string;
  let storageRoot: string;

  const configurationRoot = fileURLToPath(
    new URL("..", import.meta.url),
  ).replace(/\/$/, "");

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(
      join(tmpdir(), "opencode-mentor-commit-apply-"),
    );
    repositoryRoot = join(temporaryRoot, "project");
    storageRoot = join(temporaryRoot, "proposals");

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

    await writeFile(join(repositoryRoot, "selected.txt"), "baseline\n");
    await writeFile(join(repositoryRoot, "remaining.txt"), "baseline\n");
    await requireGit(repositoryRoot, ["add", "-A", "--", "."]);
    await requireGit(repositoryRoot, [
      "commit",
      "-m",
      "Establish test repository",
    ]);
    await requireGit(repositoryRoot, [
      "switch",
      "-c",
      "feature/commit-apply-test",
    ]);

    await writeFile(join(repositoryRoot, "selected.txt"), "staged\n");
    await writeFile(join(repositoryRoot, "remaining.txt"), "unstaged\n");
    await requireGit(repositoryRoot, ["add", "--", "selected.txt"]);
  });

  afterEach(async () => {
    await rm(temporaryRoot, {
      recursive: true,
      force: true,
    });
  });

  async function persistEligibleProposal() {
    const preflight = await runGitCheckpointCommitPreflight({
      directory: repositoryRoot,
      configuration_root: configurationRoot,
      commit_message: "Implement checkpoint Commit Apply",
    });

    expect(preflight.ok).toBe(true);

    if (!preflight.ok) {
      throw new Error(`Preflight failed at ${preflight.stage}`);
    }

    expect(preflight.commit_plan.eligible).toBe(true);

    const record = buildGitCheckpointCommitProposal(preflight);

    await persistGitCheckpointCommitProposal(record, storageRoot);

    return record;
  }

  test("prepares an unchanged proposal", async () => {
    const record = await persistEligibleProposal();

    const prepared = await prepareGitCheckpointCommitApply({
      directory: repositoryRoot,
      configuration_root: configurationRoot,
      proposal_id: record.proposal.id,
      storage_root: storageRoot,
    });

    expect(prepared.record).toEqual(record);
    expect(prepared.preflight.diff?.patch_sha256).toBe(
      record.proposal.repository.staged_diff.patch_sha256,
    );
  });

  test("rejects changed staged content", async () => {
    const record = await persistEligibleProposal();

    await writeFile(
      join(repositoryRoot, "selected.txt"),
      "different staged content\n",
    );
    await requireGit(repositoryRoot, ["add", "--", "selected.txt"]);

    await expect(
      prepareGitCheckpointCommitApply({
        directory: repositoryRoot,
        configuration_root: configurationRoot,
        proposal_id: record.proposal.id,
        storage_root: storageRoot,
      }),
    ).rejects.toMatchObject({
      code: "STALE_PROPOSAL",
      message: "Git checkpoint Commit proposal is stale: staged diff changed",
    });
  });

  test("rejects changed HEAD", async () => {
    const record = await persistEligibleProposal();

    await requireGit(repositoryRoot, [
      "commit",
      "-m",
      "Advance test repository",
    ]);

    await expect(
      prepareGitCheckpointCommitApply({
        directory: repositoryRoot,
        configuration_root: configurationRoot,
        proposal_id: record.proposal.id,
        storage_root: storageRoot,
      }),
    ).rejects.toMatchObject({
      code: "STALE_PROPOSAL",
    });
  });

  test("allows unrelated unstaged content to change", async () => {
    const record = await persistEligibleProposal();

    await writeFile(
      join(repositoryRoot, "remaining.txt"),
      "different unstaged content\n",
    );

    const prepared = await prepareGitCheckpointCommitApply({
      directory: repositoryRoot,
      configuration_root: configurationRoot,
      proposal_id: record.proposal.id,
      storage_root: storageRoot,
    });

    expect(prepared.preflight.diff?.patch_sha256).toBe(
      record.proposal.repository.staged_diff.patch_sha256,
    );
  });

  test("does not mutate repository state", async () => {
    const record = await persistEligibleProposal();

    const beforeHead = (await requireGit(repositoryRoot, ["rev-parse", "HEAD"]))
      .stdout;

    const beforeDiff = (
      await requireGit(repositoryRoot, ["diff", "--cached", "--binary"])
    ).stdout;

    await prepareGitCheckpointCommitApply({
      directory: repositoryRoot,
      configuration_root: configurationRoot,
      proposal_id: record.proposal.id,
      storage_root: storageRoot,
    });

    expect(
      (await requireGit(repositoryRoot, ["rev-parse", "HEAD"])).stdout,
    ).toBe(beforeHead);

    expect(
      (await requireGit(repositoryRoot, ["diff", "--cached", "--binary"]))
        .stdout,
    ).toBe(beforeDiff);
  });

  test("applies the exact reviewed Commit proposal", async () => {
    const record = await persistEligibleProposal();

    const result = await applyGitCheckpointCommitProposal({
      directory: repositoryRoot,
      configuration_root: configurationRoot,
      proposal_id: record.proposal.id,
      storage_root: storageRoot,
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.previous_head_sha).toBe(record.proposal.operation.head_sha);
    expect(result.committed_diff_sha256).toBe(
      record.proposal.repository.staged_diff.patch_sha256,
    );

    const status = await requireGit(repositoryRoot, [
      "status",
      "--porcelain=v1",
    ]);

    expect(status.stdout).toContain(" M remaining.txt");
    expect(status.stdout).not.toContain("selected.txt");

    await expect(
      prepareGitCheckpointCommitApply({
        directory: repositoryRoot,
        configuration_root: configurationRoot,
        proposal_id: record.proposal.id,
        storage_root: storageRoot,
      }),
    ).rejects.toMatchObject({
      code: "PROPOSAL_ALREADY_APPLIED",
    });
  });

  test("rolls back when applied-state persistence fails", async () => {
    const record = await persistEligibleProposal();

    const beforeHead = (
      await requireGit(repositoryRoot, ["rev-parse", "HEAD"])
    ).stdout.trim();

    const beforeDiff = (
      await requireGit(repositoryRoot, ["diff", "--cached", "--binary"])
    ).stdout;

    const result = await applyGitCheckpointCommitProposal(
      {
        directory: repositoryRoot,
        configuration_root: configurationRoot,
        proposal_id: record.proposal.id,
        storage_root: storageRoot,
      },
      {
        persist: async () => {
          throw new Error("Injected persistence failure");
        },
      },
    );

    expect(result).toMatchObject({
      ok: false,
      rollback: {
        succeeded: true,
        errors: [],
      },
    });

    expect(
      (await requireGit(repositoryRoot, ["rev-parse", "HEAD"])).stdout.trim(),
    ).toBe(beforeHead);

    expect(
      (await requireGit(repositoryRoot, ["diff", "--cached", "--binary"]))
        .stdout,
    ).toBe(beforeDiff);
  });
});
