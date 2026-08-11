---
description: Propose and review source changes without modifying source files
agent: lead
---
Load the `development` skill and execute its Development procedure.

Treat the following text as the current development request when present:

$ARGUMENTS

This workflow is proposal-only for source files. Do not create, edit, patch,
format, regenerate, rename, move, or delete source files.

Inspect the approved project context and relevant implementation before proposing
changes.

Propose one coherent implementation unit at a time. Present source changes in
reviewable code blocks with enough context for the user to enter them manually.

After the user applies a proposed change, reread the affected files and review
the resulting implementation. Identify implementation or transcription errors
and provide corrected fragments without applying them.

Use read-only investigation directly or delegate bounded repository exploration
to `explore` when useful.

Bash is validation-only during Development. Do not use Bash for repository,
source, filesystem, environment, or external-path investigation.

Validation through Bash remains permission-gated and must not modify source
files or access paths outside the active workspace.

Recommend appropriate validation after implementation review, but do not perform
mutating fixes in response to validation failures.

Do not reopen approved project scope merely because implementation requires
reasoning or debugging. Return to Project Definition only when new evidence
materially invalidates an approved objective, constraint, architecture decision,
required capability, or acceptance criterion.
