import { resolve } from "node:path";
import { tool } from "@opencode-ai/plugin";
import { runGitCheckpointStagePreflight } from "../lib/git_checkpoint";
import {
  buildGitCheckpointStageProposal,
  buildGitCheckpointStageReview,
  GitCheckpointStageProposalError,
  persistGitCheckpointStageProposal,
} from "../lib/git_checkpoint_stage_proposal";
import { PolicyError, policyFailure } from "../lib/git_policy";

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export const preview = tool({
  description:
    "Create an immutable proposal for explicitly staging selected changed paths. " +
    "Runs deterministic policy and repository preflight, persists exact reviewed state outside the repository, and performs no Git mutation.",

  args: {
    selected_paths: tool.schema
      .array(
        tool.schema
          .string()
          .describe(
            "Exact changed repository path selected for whole-path staging.",
          ),
      )
      .describe("Exact changed paths selected for the Stage transaction."),
  },

  async execute(args, context) {
    try {
      const directory = context.worktree || context.directory;

      if (!directory) {
        return json({
          version: 1,
          ok: false,
          error: {
            code: "STAGE_PREFLIGHT_FAILED",
            message: "OpenCode did not provide a project directory",
          },
        });
      }

      const configurationRoot = resolve(import.meta.dir, "..");

      const preflight = await runGitCheckpointStagePreflight({
        directory,
        configuration_root: configurationRoot,
        selected_paths: args.selected_paths,
      });

      if (!preflight.ok) {
        return json({
          version: 1,
          ok: false,
          error: {
            code: "STAGE_PREFLIGHT_FAILED",
            message: preflight.error.message,
          },
        });
      }

      if (!preflight.stage_plan.eligible) {
        return json({
          version: 1,
          ok: false,
          error: {
            code: "STAGE_NOT_ELIGIBLE",
            message:
              "Git checkpoint Stage preflight rejected the proposed operation",
          },
          issues: preflight.stage_plan.issues,
        });
      }

      const record = buildGitCheckpointStageProposal(preflight);

      await persistGitCheckpointStageProposal(record);

      return json({
        version: 1,
        ok: true,
        proposal_id: record.proposal.id,
        project_root: record.proposal.project.root,
        review: buildGitCheckpointStageReview(record),
      });
    } catch (error) {
      if (error instanceof PolicyError) {
        const policyError = policyFailure(error);

        return json({
          version: 1,
          ok: false,
          error: {
            code: "STAGE_PREFLIGHT_FAILED",
            message: policyError.error.message,
          },
          cause: policyError.error,
        });
      }

      if (error instanceof GitCheckpointStageProposalError) {
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
