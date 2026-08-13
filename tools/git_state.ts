import { tool } from "@opencode-ai/plugin"
import { inspectGitState } from "../lib/git_state"

function json(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

export default tool({
  description:
    "Return deterministic read-only Git repository state. " +
    "Runs only fixed local Git inspection commands and performs no network, " +
    "index, worktree, configuration, reference, or history mutation.",

  args: {},

  async execute(_args, context) {
    const directory =
      context.directory || context.worktree

    return json(
      await inspectGitState(directory),
    )
  },
})
