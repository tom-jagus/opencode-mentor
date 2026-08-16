import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runGitFinishUpdatePreflight } from "../lib/git_finish_update";
import { prepareGitFinishUpdateApply } from "../lib/git_finish_update_apply";
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

describe("Git Finish Update Apply preparation", () => {
  const configurationRoot = fileURLToPath(
    new URL("..", import.meta.url),
  ).replace(/\/$/, "");

  let temporaryRoot: string;
  let repositoryRoot: string;
  let remoteRoot: string;
  let storageRoot: string;
  let proposalId: string;

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(
      join(tmpdir(), "opencode-mentor-finish-update-apply-"),
    );
    repositoryRoot = join(temporaryRoot, "project");
    remoteRoot = join(temporaryRoot, "remote.git");
    storageRoot = join(temporaryRoot, "proposals");

    await mkdir(repositoryRoot);
    await mkdir(remoteRoot);

    await requireGit(remoteRoot, ["init", "--bare"]);
    await requireGit(repositoryRoot, ["init", "-b", "main"]);

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
      "feature/finish-update-apply",
    ]);

    await writeFile(join(repositoryRoot, "feature.txt"), "feature\n");
    await requireGit(repositoryRoot, ["add", "--", "feature.txt"]);
    await requireGit(repositoryRoot, ["commit", "-m", "Add feature work"]);

    const preflight = await runGitFinishUpdatePreflight({
      directory: repositoryRoot,
      configuration_root: configurationRoot,
      remote: "review",
    });

    const record = buildGitFinishUpdateProposal(preflight, {
      id: "git-finish-update-apply-test",
      created_at: "2026-08-16T13:00:00Z",
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

  test("loads and revalidates an unchanged proposal", async () => {
    const prepared = await prepareGitFinishUpdateApply({
      directory: repositoryRoot,
      configuration_root: configurationRoot,
      proposal_id: proposalId,
      storage_root: storageRoot,
    });

    expect(prepared.record.proposal.id).toBe(proposalId);
    expect(prepared.preflight.eligibility.eligible).toBe(true);
    expect(prepared.preflight.update_plan).not.toBeNull();
  });

  test("rejects a changed local HEAD", async () => {
    await writeFile(join(repositoryRoot, "later.txt"), "later\n");
    await requireGit(repositoryRoot, ["add", "--", "later.txt"]);
    await requireGit(repositoryRoot, ["commit", "-m", "Add later work"]);

    await expect(
      prepareGitFinishUpdateApply({
        directory: repositoryRoot,
        configuration_root: configurationRoot,
        proposal_id: proposalId,
        storage_root: storageRoot,
      }),
    ).rejects.toMatchObject({
      code: "STALE_PROPOSAL",
    });
  });

  test("rejects a changed remote base commit", async () => {
    const updaterRoot = join(temporaryRoot, "updater");

    await requireGit(temporaryRoot, ["clone", remoteRoot, updaterRoot]);
    await requireGit(updaterRoot, ["switch", "main"]);
    await writeFile(join(updaterRoot, "base.txt"), "base update\n");
    await requireGit(updaterRoot, ["add", "--", "base.txt"]);
    await requireGit(updaterRoot, ["commit", "-m", "Advance base branch"]);
    await requireGit(updaterRoot, ["push", "origin", "main:refs/heads/main"]);

    await expect(
      prepareGitFinishUpdateApply({
        directory: repositoryRoot,
        configuration_root: configurationRoot,
        proposal_id: proposalId,
        storage_root: storageRoot,
      }),
    ).rejects.toMatchObject({
      code: "STALE_PROPOSAL",
    });
  });
});
