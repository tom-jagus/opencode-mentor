import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runGitFinishUpdatePreflight } from "../lib/git_finish_update";
import { applyGitFinishUpdateProposal } from "../lib/git_finish_update_apply";
import { buildGitFinishUpdateProposal } from "../lib/git_finish_update_proposal";
import { persistGitFinishUpdateProposal } from "../lib/git_finish_update_proposal_storage";
import { runGitFinishPublishPreflight } from "../lib/git_finish_publish";

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

describe("Git Finish Publish preflight", () => {
  const configurationRoot = fileURLToPath(
    new URL("..", import.meta.url),
  ).replace(/\/$/, "");

  let temporaryRoot: string;
  let repositoryRoot: string;
  let remoteRoot: string;
  let updateStorageRoot: string;
  let updateProposalId: string;
  let previousHead: string;

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(
      join(tmpdir(), "opencode-mentor-finish-publish-preflight-"),
    );
    repositoryRoot = join(temporaryRoot, "project");
    remoteRoot = join(temporaryRoot, "remote.git");
    updateStorageRoot = join(temporaryRoot, "update-proposals");

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
      "feature/finish-publish-preflight",
    ]);

    await writeFile(join(repositoryRoot, "feature.txt"), "feature\n");
    await requireGit(repositoryRoot, ["add", "--", "feature.txt"]);
    await requireGit(repositoryRoot, ["commit", "-m", "Add feature work"]);

    previousHead = (
      await requireGit(repositoryRoot, ["rev-parse", "HEAD"])
    ).stdout.trim();

    await requireGit(repositoryRoot, [
      "push",
      "review",
      "HEAD:refs/heads/feature/finish-publish-preflight",
    ]);

    const updaterRoot = join(temporaryRoot, "updater");

    await requireGit(temporaryRoot, ["clone", remoteRoot, updaterRoot]);
    await requireGit(updaterRoot, ["switch", "main"]);
    await writeFile(join(updaterRoot, "base.txt"), "base update\n");
    await requireGit(updaterRoot, ["add", "--", "base.txt"]);
    await requireGit(updaterRoot, ["commit", "-m", "Advance base branch"]);
    await requireGit(updaterRoot, ["push", "origin", "main:refs/heads/main"]);

    const updatePreflight = await runGitFinishUpdatePreflight({
      directory: repositoryRoot,
      configuration_root: configurationRoot,
      remote: "review",
    });

    const updateRecord = buildGitFinishUpdateProposal(updatePreflight, {
      id: "git-finish-update-for-publish-test",
      created_at: "2026-08-16T16:00:00Z",
    });

    updateProposalId = updateRecord.proposal.id;

    await persistGitFinishUpdateProposal(updateRecord, updateStorageRoot);

    const updateResult = await applyGitFinishUpdateProposal({
      directory: repositoryRoot,
      configuration_root: configurationRoot,
      proposal_id: updateProposalId,
      storage_root: updateStorageRoot,
    });

    if (!updateResult.ok) {
      throw new Error(updateResult.error.message);
    }
  });

  afterEach(async () => {
    await rm(temporaryRoot, {
      recursive: true,
      force: true,
    });
  });

  test("authorizes force-with-lease against the exact pre-rebase remote tip", async () => {
    const result = await runGitFinishPublishPreflight({
      directory: repositoryRoot,
      configuration_root: configurationRoot,
      remote: "review",
      update_proposal_id: updateProposalId,
      update_storage_root: updateStorageRoot,
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(`Preflight failed at ${result.stage}`);
    }

    expect(result.eligibility.eligible).toBe(true);
    expect(result.publish_plan).toMatchObject({
      eligible: true,
      disposition: "force-with-lease",
      remote_commit_sha: previousHead,
      force_with_lease_expected_sha: previousHead,
      destination_branch: "feature/finish-publish-preflight",
    });
  });

  test("recognizes the exact branch as up to date", async () => {
    const resultingHead = (
      await requireGit(repositoryRoot, ["rev-parse", "HEAD"])
    ).stdout.trim();

    await requireGit(repositoryRoot, [
      "push",
      "--force-with-lease",
      "review",
      `HEAD:refs/heads/feature/finish-publish-preflight`,
    ]);

    const result = await runGitFinishPublishPreflight({
      directory: repositoryRoot,
      configuration_root: configurationRoot,
      remote: "review",
      update_proposal_id: updateProposalId,
      update_storage_root: updateStorageRoot,
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(`Preflight failed at ${result.stage}`);
    }

    expect(result.publish_plan).toMatchObject({
      eligible: true,
      disposition: "up-to-date",
      remote_commit_sha: resultingHead,
    });
  });

  test("rejects a different explicit remote before remote inspection", async () => {
    const result = await runGitFinishPublishPreflight({
      directory: repositoryRoot,
      configuration_root: configurationRoot,
      remote: "origin",
      update_proposal_id: updateProposalId,
      update_storage_root: updateStorageRoot,
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(`Preflight failed at ${result.stage}`);
    }

    expect(result.eligibility.eligible).toBe(false);
    expect(result.remote_inspection).toBeNull();
    expect(result.publish_plan).toBeNull();
  });
});
