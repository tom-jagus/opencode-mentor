---
description: Restore durable project context for continued work
agent: lead
---

Load the `project-progress` skill and execute its Resume procedure.

This command is read-only. Do not create, modify, stage, commit, push or
otherwise mutate files, repository state, GitHub state, or runtime
configuration.

This command accepts no arguments, file references, or attachments.

Do not use Bash during session recovery. Use approved read-only tools and
`git_state` only as defined by the Resume procedure.

Restore working context from authoritative project artifacts and repository
state rather than relying on prior conversation history.

Distinguish recorded project facts from inferred recommendations.

Report missing, stale, or inconsistent context rather than guessing or silently
repairing it.
