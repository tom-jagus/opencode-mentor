import { resolve } from "node:path";
import { tool } from "@opencode-ai/plugin";
import { runGitCheckpointCommitPreflight } from "../lib/git_checkpoint_commit";
import {
  buildGitCheckpointCommitProposal,
  buildGitCheckpointCommitReview,
  GitCheckpointCommitProposalError,
  persistGitCheckpointCommitProposal,
} from "../lib/git_checkpoint_commit_proposal";
import { PolicyError, policyFailure } from "../lib/git_policy";
import { applyGitCheckpointCommitProposal } from "../lib/git_checkpoint_commit_apply";

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export const preview = tool({
  description:
    "Create an immutable proposal for committing the exact staged Git diff with a reviewed message. " +
    "Runs deterministic policy, repository, message, and staged-diff preflight; persists exact checksums and reviewed state outside the repository; and performs no Git mutation.",

  args: {
    commit_message: tool.schema
      .string()
      .describe(
        "Exact canonical commit message to review and bind to the staged diff.",
      ),
  },

  async execute(args, context) {
    try {
      const directory = context.worktree || context.directory;

      if (!directory) {
        return json({
          version: 1,
          ok: false,
          error: {
            code: "COMMIT_PREFLIGHT_FAILED",
            message: "OpenCode did not provide a project directory",
          },
        });
      }

      const configurationRoot = resolve(import.meta.dir, "..");

      const preflight = await runGitCheckpointCommitPreflight({
        directory,
        configuration_root: configurationRoot,
        commit_message: args.commit_message,
      });

      if (!preflight.ok) {
        return json({
          version: 1,
          ok: false,
          error: {
            code: "COMMIT_PREFLIGHT_FAILED",
            message: preflight.error.message,
          },
          cause: preflight.error,
        });
      }

      if (!preflight.commit_plan.eligible) {
        return json({
          version: 1,
          ok: false,
          error: {
            code: "COMMIT_NOT_ELIGIBLE",
            message:
              "Git checkpoint Commit preflight rejected the proposed operation",
          },
          issues: preflight.commit_plan.issues,
          message_validation: preflight.commit_plan.message_validation,
        });
      }

      if (preflight.diff === null) {
        return json({
          version: 1,
          ok: false,
          error: {
            code: "INVALID_COMMIT_PREFLIGHT",
            message: "Eligible Commit preflight did not produce a staged diff",
          },
        });
      }

      const record = buildGitCheckpointCommitProposal(preflight);

      await persistGitCheckpointCommitProposal(record);

      return json({
        version: 1,
        ok: true,
        proposal_id: record.proposal.id,
        project_root: record.proposal.project.root,
        review: buildGitCheckpointCommitReview(record, preflight.diff),
      });
    } catch (error) {
      if (error instanceof PolicyError) {
        const policyError = policyFailure(error);

        return json({
          version: 1,
          ok: false,
          error: {
            code: "COMMIT_PREFLIGHT_FAILED",
            message: policyError.error.message,
          },
          cause: policyError.error,
        });
      }

      if (error instanceof GitCheckpointCommitProposalError) {
        return json({
          version: 1,
          ok: false,
          error: {
            code: error.code,
            message: error.message,
          },
        });
      }

      return json({
        version: 1,
        ok: false,
        error: {
          code: "PROPOSAL_STORAGE_FAILED",
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  },
});

export const apply = tool({
  description:
    "Apply one exact reviewed checkpoint Commit proposal. " +
    "Revalidates project, policy, branch, HEAD, commit message, and staged diff before committing only the reviewed index.",

  args: {
    proposal_id: tool.schema
      .string()
      .describe(
        "Exact proposal identifier returned by git_checkpoint_commit_preview.",
      ),
  },

  async execute(args, context) {
    const directory = context.worktree || context.directory;

    if (!directory) {
      return json({
        version: 1,
        ok: false,
        proposal_id: args.proposal_id,
        error: {
          code: "STALE_PROPOSAL",
          message: "OpenCode did not provide a project directory",
        },
      });
    }

    return json(
      await applyGitCheckpointCommitProposal({
        directory,
        configuration_root: resolve(import.meta.dir, ".."),
        proposal_id: args.proposal_id,
      }),
    );
  },
});
