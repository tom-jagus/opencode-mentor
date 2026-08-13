import { resolve } from "node:path";
import { tool } from "@opencode-ai/plugin";
import { runGitStartPreflight } from "../lib/git_start";
import {
  buildGitStartProposal,
  buildGitStartReview,
  gitStartPreviewFailure,
  persistGitStartProposal,
} from "../lib/git_start_proposal";
import { PolicyError, policyFailure } from "../lib/git_policy";

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export const preview = tool({
  description:
    "Create an immutable, read-only proposal for starting one policy-compliant local Git working branch. " +
    "Runs deterministic preflight and persists exact reviewed state without performing Git mutation.",

  args: {
    target_branch: tool.schema
      .string()
      .describe("Exact proposed local working branch name."),
  },

  async execute(args, context) {
    try {
      const directory = context.worktree || context.directory;

      if (!directory) {
        return json({
          version: 1,
          ok: false,
          error: {
            code: "START_PREFLIGHT_FAILED",
            message: "OpenCode did not provide a project directory",
          },
        });
      }

      const configurationRoot = resolve(import.meta.dir, "..");

      const preflight = await runGitStartPreflight({
        directory,
        configuration_root: configurationRoot,
        target_branch: args.target_branch,
      });

      if (!preflight.ok) {
        return json({
          version: 1,
          ok: false,
          error: {
            code: "START_PREFLIGHT_FAILED",
            message: preflight.error.message,
          },
        });
      }

      if (!preflight.eligibility.eligible) {
        return json({
          version: 1,
          ok: false,
          error: {
            code: "START_NOT_ELIGIBLE",
            message: "Git start preflight rejected the proposed operation",
          },
          issues: preflight.eligibility.issues,
        });
      }

      const record = buildGitStartProposal(preflight);

      await persistGitStartProposal(record);

      return json({
        version: 1,
        ok: true,
        proposal_id: record.proposal.id,
        project_root: record.proposal.project.root,
        review: buildGitStartReview(record),
      });
    } catch (error) {
      if (error instanceof PolicyError) {
        const policyError = policyFailure(error);

        return json({
          version: 1,
          ok: false,
          error: {
            code: "START_PREFLIGHT_FAILED",
            message: policyError.error.message,
          },
          cause: policyError.error,
        });
      }

      return json(gitStartPreviewFailure(error));
    }
  },
});
