---
description: Review and apply a milestone state transition
agent: lead
---

Load the `project-progress` skill and execute its Milestone procedure.

Treat the following text as the requested milestone transition:

$ARGUMENTS

Apply milestone changes only through the constrained Documentation Transaction.

Create the review candidate through `documentation_preview` using `milestone`
authority.

After explicit approval of the exact current proposal, continue through
permission-gated `documentation_apply` using only that proposal identifier.

Do not modify project artifacts through generic editing or Bash.

Use authoritative project artifacts to understand the current milestone state
before proposing a transition.

Do not use Bash during the Milestone procedure.

Propose only the operational changes required in `docs/project/progress.md`.

Do not redefine project objectives, constraints, architecture, acceptance
criteria, or implementation phases through `/milestone`. Use `/define` when the
requested transition requires a material scope change.

Do not create or revise durable decisions through `/milestone`.

Report invalid, ambiguous, or inconsistent transitions rather than silently
repairing project state.
