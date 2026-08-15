import { resolve } from "node:path";
import { tool } from "@opencode-ai/plugin";
import { runGitCheckpointPushPreflight } from "../lib/git_checkpoint_push";
import {
  buildGitCheckpointPushProposal,
  buildGitCheckpointPushReview,
  GitCheckpointPushProposalError,
  persistGitCheckpointPushProposal,
} from "../lib/git_checkpoint_push_proposal";
import { PolicyError, policyFailure } from "../lib/git_policy";
import { applyGitCheckpointPushProposal } from "../lib/git_checkpoint_push_apply";

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export const preview = tool({
  description:
    "Create an immutable proposal for pushing one exact local commit to an explicitly supplied remote and destination branch. " +
    "Performs deterministic local and remote inspection, contacts the explicit remote, persists reviewed state outside the repository, and performs no push or local Git mutation.",

  args: {
    local_commit_sha: tool.schema
      .string()
      .describe(
        "Exact local commit identifier returned by checkpoint Commit Apply.",
      ),
    remote: tool.schema
      .string()
      .describe(
        "Explicit configured Git remote name. The tool never infers origin or an upstream remote.",
      ),
    destination_branch: tool.schema
      .string()
      .describe(
        "Explicit remote destination branch. The tool never infers it from the working branch or upstream.",
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
            code: "PUSH_PREFLIGHT_FAILED",
            message: "OpenCode did not provide a project directory",
          },
        });
      }

      const configurationRoot = resolve(import.meta.dir, "..");

      const preflight = await runGitCheckpointPushPreflight({
        directory,
        configuration_root: configurationRoot,
        local_commit_sha: args.local_commit_sha,
        remote: args.remote,
        destination_branch: args.destination_branch,
      });

      if (!preflight.ok) {
        return json({
          version: 1,
          ok: false,
          error: {
            code: "PUSH_PREFLIGHT_FAILED",
            message: preflight.error.message,
          },
          cause: {
            stage: preflight.stage,
            ...preflight.error,
          },
        });
      }

      if (!preflight.push_plan.eligible) {
        return json({
          version: 1,
          ok: false,
          error: {
            code: "PUSH_NOT_ELIGIBLE",
            message:
              "Git checkpoint Push preflight rejected the proposed operation",
          },
          disposition: preflight.push_plan.disposition,
          issues: preflight.push_plan.issues,
        });
      }

      if (preflight.remote_inspection === null) {
        return json({
          version: 1,
          ok: false,
          error: {
            code: "INVALID_PUSH_PREFLIGHT",
            message:
              "Eligible Push preflight did not produce remote inspection",
          },
        });
      }

      const record = buildGitCheckpointPushProposal(preflight);

      await persistGitCheckpointPushProposal(record);

      return json({
        version: 1,
        ok: true,
        proposal_id: record.proposal.id,
        project_root: record.proposal.project.root,
        review: buildGitCheckpointPushReview(record),
      });
    } catch (error) {
      if (error instanceof PolicyError) {
        const policyError = policyFailure(error);

        return json({
          version: 1,
          ok: false,
          error: {
            code: "PUSH_PREFLIGHT_FAILED",
            message: policyError.error.message,
          },
          cause: policyError.error,
        });
      }

      if (error instanceof GitCheckpointPushProposalError) {
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
    "Apply one exact reviewed checkpoint Push proposal. " +
    "Revalidates local and remote state, performs only a normal non-force push of the reviewed commit to the reviewed destination, verifies the exact remote result, and does not configure upstream tracking.",

  args: {
    proposal_id: tool.schema
      .string()
      .describe(
        "Exact proposal identifier returned by git_checkpoint_push_preview.",
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
        remote_result: {
          mutation_completed: false,
          state_verified: false,
          rollback_available: false,
        },
      });
    }

    return json(
      await applyGitCheckpointPushProposal({
        directory,
        configuration_root: resolve(import.meta.dir, ".."),
        proposal_id: args.proposal_id,
      }),
    );
  },
});
