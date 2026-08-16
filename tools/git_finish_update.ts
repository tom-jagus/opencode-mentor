import { resolve } from "node:path";
import { tool } from "@opencode-ai/plugin";
import { runGitFinishUpdatePreflight } from "../lib/git_finish_update";
import {
  buildGitFinishUpdateProposal,
  buildGitFinishUpdateReview,
  GitFinishUpdateProposalError,
} from "../lib/git_finish_update_proposal";
import { persistGitFinishUpdateProposal } from "../lib/git_finish_update_proposal_storage";
import { PolicyError, policyFailure } from "../lib/git_policy";
import { applyGitFinishUpdateProposal } from "../lib/git_finish_update_apply";

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export const preview = tool({
  description:
    "Create an immutable proposal for updating one policy-compliant working branch before finalisation. " +
    "Inspects local state and the explicit remote base branch, persists exact reviewed state outside the repository, and performs no fetch, rebase, push, or other Git mutation.",

  args: {
    remote: tool.schema
      .string()
      .describe(
        "Explicit configured Git remote whose effective base branch will be inspected. The tool never infers origin or an upstream remote.",
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
            code: "UPDATE_PREFLIGHT_FAILED",
            message: "OpenCode did not provide a project directory",
          },
        });
      }

      const configurationRoot = resolve(import.meta.dir, "..");

      const preflight = await runGitFinishUpdatePreflight({
        directory,
        configuration_root: configurationRoot,
        remote: args.remote,
      });

      if (!preflight.ok) {
        return json({
          version: 1,
          ok: false,
          error: {
            code: "UPDATE_PREFLIGHT_FAILED",
            message: preflight.error.message,
          },
          cause: {
            stage: preflight.stage,
            ...preflight.error,
          },
        });
      }

      if (!preflight.eligibility.eligible) {
        return json({
          version: 1,
          ok: false,
          error: {
            code: "UPDATE_NOT_ELIGIBLE",
            message:
              "Git Finish Update preflight rejected the proposed operation",
          },
          issues: preflight.eligibility.issues,
        });
      }

      if (
        preflight.remote_inspection === null ||
        preflight.update_plan === null
      ) {
        return json({
          version: 1,
          ok: false,
          error: {
            code: "INVALID_UPDATE_PREFLIGHT",
            message:
              "Eligible Finish Update preflight did not produce remote inspection and plan state",
          },
        });
      }

      const record = buildGitFinishUpdateProposal(preflight);

      await persistGitFinishUpdateProposal(record);

      return json({
        version: 1,
        ok: true,
        proposal_id: record.proposal.id,
        project_root: record.proposal.project.root,
        review: buildGitFinishUpdateReview(record),
      });
    } catch (error) {
      if (error instanceof PolicyError) {
        const policyError = policyFailure(error);

        return json({
          version: 1,
          ok: false,
          error: {
            code: "UPDATE_PREFLIGHT_FAILED",
            message: policyError.error.message,
          },
          cause: policyError.error,
        });
      }

      if (error instanceof GitFinishUpdateProposalError) {
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
    "Apply one exact reviewed Git Finish Update proposal. " +
    "Revalidates project, policy, branch, HEAD, working tree, active operations, remote URL, and remote base state before fetching and rebasing only the reviewed branch.",

  args: {
    proposal_id: tool.schema
      .string()
      .describe(
        "Exact proposal identifier returned by git_finish_update_preview.",
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
        rollback: {
          attempted: false,
          succeeded: false,
          errors: [],
        },
      });
    }

    return json(
      await applyGitFinishUpdateProposal({
        directory,
        configuration_root: resolve(import.meta.dir, ".."),
        proposal_id: args.proposal_id,
      }),
    );
  },
});
