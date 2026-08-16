import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runGitFinishUpdatePreflight } from "../lib/git_finish_update";
import { applyGitFinishUpdateProposal } from "../lib/git_finish_update_apply";
import { buildGitFinishUpdateProposal } from "../lib/git_finish_update_proposal";
import { persistGitFinishUpdateProposal } from "../lib/git_finish_update_proposal_storage";

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
      GIT_AUTHOR_NAME: "OpenCode Mentor Test",
      GIT_AUTHOR_EMAIL: "test@example.invalid",
      GIT_COMMITTER_NAME: "OpenCode Mentor Test",
      GIT_COMMITTER_EMAIL: "test@example.invalid",
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

  return { stdout, stderr, exitCode };
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

describe("Git Finish Update Apply execution", () => {
  const configurationRoot = fileURLToPath(
    new URL("..", import.meta.url),
  ).replace(/\/$/, "");

  let temporaryRoot: string;
  let repositoryRoot: string;
  let remoteRoot: string;
  let storageRoot: string;
  let proposalId: string;
  let originalHead: string;
  let remoteBaseCommit: string;

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(
      join(tmpdir(), "opencode-mentor-finish-update-execution-"),
    );
    repositoryRoot = join(temporaryRoot, "project");
    remoteRoot = join(temporaryRoot, "remote.git");
    storageRoot = join(temporaryRoot, "proposals");

    await mkdir(repositoryRoot);
    await mkdir(remoteRoot);

    await requireGit(remoteRoot, ["init", "--bare"]);
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

    await writeFile(join(repositoryRoot, "README.md"), "# Test\n");
    await requireGit(repositoryRoot, ["add", "--", "README.md"]);
    await requireGit(repositoryRoot, [
      "commit",
      "-m",
      "Establish test repository",
    ]);
    await requireGit(repositoryRoot, ["remote", "add", "review", remoteRoot]);
    await requireGit(repositoryRoot, [
      "push",
      "review",
      "main:refs/heads/main",
    ]);
    await requireGit(repositoryRoot, [
      "switch",
      "-c",
      "feature/finish-update-execution",
    ]);

    await writeFile(join(repositoryRoot, "feature.txt"), "feature\n");
    await requireGit(repositoryRoot, ["add", "--", "feature.txt"]);
    await requireGit(repositoryRoot, ["commit", "-m", "Add feature work"]);

    originalHead = (
      await requireGit(repositoryRoot, ["rev-parse", "HEAD"])
    ).stdout.trim();

    const updaterRoot = join(temporaryRoot, "updater");

    await requireGit(temporaryRoot, ["clone", remoteRoot, updaterRoot]);
    await requireGit(updaterRoot, ["switch", "main"]);
    await writeFile(join(updaterRoot, "base.txt"), "base update\n");
    await requireGit(updaterRoot, ["add", "--", "base.txt"]);
    await requireGit(updaterRoot, ["commit", "-m", "Advance base branch"]);
    await requireGit(updaterRoot, ["push", "origin", "main:refs/heads/main"]);

    remoteBaseCommit = (
      await requireGit(updaterRoot, ["rev-parse", "HEAD"])
    ).stdout.trim();

    const preflight = await runGitFinishUpdatePreflight({
      directory: repositoryRoot,
      configuration_root: configurationRoot,
      remote: "review",
    });

    const record = buildGitFinishUpdateProposal(preflight, {
      id: "git-finish-update-execution-test",
      created_at: "2026-08-16T14:00:00Z",
    });

    proposalId = record.proposal.id;

    await persistGitFinishUpdateProposal(record, storageRoot);
  });

  afterEach(async () => {
    await rm(temporaryRoot, {
      recursive: true,
      force: true,
    });
  });

  test("applies and records an exact reviewed rebase", async () => {
    const result = await applyGitFinishUpdateProposal({
      directory: repositoryRoot,
      configuration_root: configurationRoot,
      proposal_id: proposalId,
      storage_root: storageRoot,
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.previous_head_sha).toBe(originalHead);
    expect(result.resulting_head_sha).not.toBe(originalHead);
    expect(result.base_commit_sha).toBe(remoteBaseCommit);
    expect(result.rebased).toBe(true);

    const ancestry = await git(repositoryRoot, [
      "merge-base",
      "--is-ancestor",
      remoteBaseCommit,
      result.resulting_head_sha,
    ]);

    expect(ancestry.exitCode).toBe(0);
  });

  test("rolls back when applied-state persistence fails", async () => {
    const result = await applyGitFinishUpdateProposal(
      {
        directory: repositoryRoot,
        configuration_root: configurationRoot,
        proposal_id: proposalId,
        storage_root: storageRoot,
      },
      {
        persist: async () => {
          throw new Error("simulated persistence failure");
        },
      },
    );

    expect(result.ok).toBe(false);

    if (result.ok) {
      throw new Error("Expected Apply failure");
    }

    expect(result.rollback).toEqual({
      attempted: true,
      succeeded: true,
      errors: [],
    });

    expect(
      (await requireGit(repositoryRoot, ["rev-parse", "HEAD"])).stdout.trim(),
    ).toBe(originalHead);
  });

  test("rejects proposal reuse", async () => {
    const first = await applyGitFinishUpdateProposal({
      directory: repositoryRoot,
      configuration_root: configurationRoot,
      proposal_id: proposalId,
      storage_root: storageRoot,
    });

    expect(first.ok).toBe(true);

    const second = await applyGitFinishUpdateProposal({
      directory: repositoryRoot,
      configuration_root: configurationRoot,
      proposal_id: proposalId,
      storage_root: storageRoot,
    });

    expect(second).toMatchObject({
      ok: false,
      error: {
        code: "PROPOSAL_ALREADY_APPLIED",
      },
    });
  });
});
