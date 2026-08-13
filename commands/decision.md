---
description: Review and apply a durable project decision update
agent: lead
---

Load the `project-progress` skill and execute its Decision procedure.

Treat the following text as the requested decision action:

$ARGUMENTS

Apply decision-history changes only through the constrained Documentation
Transaction.

Create the review candidate through `documentation_preview` using `decision`
authority.

After explicit approval of the exact current proposal, continue through
permission-gated `documentation_apply` using only that proposal identifier.

Do not modify project artifacts through generic editing or Bash.

Use the authoritative decision register and relevant project context before
proposing a durable decision update.

Do not use Bash during the Decision procedure.

Propose only the decision-history changes required in
`docs/project/decisions.md`.

Do not redefine project objectives, constraints, architecture, acceptance
criteria, or implementation phases through `/decision`. Use `/define` when the
requested decision materially changes approved project scope.

Do not change milestone or operational project state through `/decision`. Use
`/milestone` when the requested action is an operational transition.

Report ambiguous, duplicate, unavailable, or inconsistent decision state rather
than silently inventing or repairing it.
