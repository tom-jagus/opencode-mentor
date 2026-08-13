import { resolve } from "node:path";
import { tool } from "@opencode-ai/plugin";
import {
  PolicyError,
  policyFailure,
  resolveEffectiveGitPolicy,
} from "../lib/git_policy";

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export default tool({
  description:
    "Resolve and strictly validate deterministic effective Git policy. " +
    "Reads fixed global defaults and an optional sparse project override. " +
    "Performs no Git, network, worktree, configuration, or policy mutation.",

  args: {},

  async execute(_args, context) {
    try {
      const directory = context.worktree || context.directory;

      if (!directory) {
        throw new PolicyError(
          "PROJECT_RESOLUTION_FAILED",
          "Tool context does not provide a project directory",
        );
      }

      const configurationRoot = resolve(import.meta.dir, "..");

      const resolution = await resolveEffectiveGitPolicy(
        directory,
        configurationRoot,
      );

      return json({
        version: 1,
        ok: true,
        sources: resolution.sources,
        effective_policy: resolution.effective_policy,
      });
    } catch (error) {
      return json(policyFailure(error));
    }
  },
});
