import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runGitStartPreflight } from "../lib/git_start";
import { prepareGitStartApply } from "../lib/git_start_apply";
import {
  buildGitStartProposal,
  persistGitStartProposal,
} from "../lib/git_start_proposal";

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
}

describe("prepareGitStartApply", () => {
  let temporaryRoot: string;
  let repositoryRoot: string;
  let storageRoot: string;

  const configurationRoot = fileURLToPath(
    new URL("..", import.meta.url),
  ).replace(/\/$/, "");

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(
      join(tmpdir(), "opencode-mentor-git-start-apply-"),
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

  async function persistEligibleProposal(
    targetBranch = "feature/apply-preparation-test",
  ) {
    const preflight = await runGitStartPreflight({
      directory: repositoryRoot,
      configuration_root: configurationRoot,
      target_branch: targetBranch,
    });

    expect(preflight.ok).toBe(true);

    if (!preflight.ok) {
      throw new Error(`Preflight failed at ${preflight.stage}`);
    }

    expect(preflight.eligibility.eligible).toBe(true);

    const record = buildGitStartProposal(preflight);

    await persistGitStartProposal(record, storageRoot);

    return record;
  }

  test("prepares an unchanged eligible proposal", async () => {
    const record = await persistEligibleProposal();

    const prepared = await prepareGitStartApply({
      directory: repositoryRoot,
      configuration_root: configurationRoot,
      proposal_id: record.proposal.id,
      storage_root: storageRoot,
    });

    expect(prepared.record.proposal.id).toBe(record.proposal.id);
    expect(prepared.preflight.eligibility.eligible).toBe(true);
    expect(prepared.preflight.state.latest_commit?.sha).toBe(
      record.proposal.operation.head_sha,
    );
    expect(prepared.preflight.target_branch_exists).toBe(false);
  });

  test("rejects a proposal after HEAD changes", async () => {
    const record = await persistEligibleProposal();

    await requireGit(repositoryRoot, [
      "commit",
      "--allow-empty",
      "-m",
      "Advance test repository",
    ]);

    await expect(
      prepareGitStartApply({
        directory: repositoryRoot,
        configuration_root: configurationRoot,
        proposal_id: record.proposal.id,
        storage_root: storageRoot,
      }),
    ).rejects.toMatchObject({
      code: "STALE_PROPOSAL",
      message: "Git start proposal is stale: HEAD changed",
    });
  });

  test("rejects a proposal when the target branch appears", async () => {
    const targetBranch = "feature/appearing-branch";

    const record = await persistEligibleProposal(targetBranch);

    await requireGit(repositoryRoot, ["branch", targetBranch]);

    await expect(
      prepareGitStartApply({
        directory: repositoryRoot,
        configuration_root: configurationRoot,
        proposal_id: record.proposal.id,
        storage_root: storageRoot,
      }),
    ).rejects.toMatchObject({
      code: "STALE_PROPOSAL",
    });
  });

  test("rejects a proposal after the working tree becomes dirty", async () => {
    const record = await persistEligibleProposal();

    await writeFile(
      join(repositoryRoot, "uncommitted.txt"),
      "uncommitted\n",
      "utf8",
    );

    await expect(
      prepareGitStartApply({
        directory: repositoryRoot,
        configuration_root: configurationRoot,
        proposal_id: record.proposal.id,
        storage_root: storageRoot,
      }),
    ).rejects.toMatchObject({
      code: "STALE_PROPOSAL",
    });
  });

  test("does not mutate Git state while preparing Apply", async () => {
    const record = await persistEligibleProposal("feature/no-mutation-test");

    await prepareGitStartApply({
      directory: repositoryRoot,
      configuration_root: configurationRoot,
      proposal_id: record.proposal.id,
      storage_root: storageRoot,
    });

    const branch = await requireGit(repositoryRoot, [
      "symbolic-ref",
      "--short",
      "HEAD",
    ]);

    expect(branch.stdout.trim()).toBe("main");

    const target = await runGit(repositoryRoot, [
      "show-ref",
      "--verify",
      "--quiet",
      "refs/heads/feature/no-mutation-test",
    ]);

    expect(target.exitCode).toBe(1);
  });

  test("prepares Apply from a repository subdirectory", async () => {
    const record = await persistEligibleProposal();

    const subdirectory = join(repositoryRoot, "nested");

    await mkdir(subdirectory);

    const prepared = await prepareGitStartApply({
      directory: subdirectory,
      configuration_root: configurationRoot,
      proposal_id: record.proposal.id,
      storage_root: storageRoot,
    });

    expect(prepared.record.proposal.id).toBe(record.proposal.id);
    expect(prepared.preflight.state.root).toBe(repositoryRoot);
  });
});
