---
description: Define a new project or materially revise approved project scope
agent: lead
---

Load the `project-definition` skill and execute its Project Definition procedure.

Treat the following text as the current definition or redefinition request when
present:

$ARGUMENTS

Use `/define` for initial project definition and for material changes to approved
project scope.

Read applicable project instructions and existing project artifacts before
proposing changes.

Challenge unclear objectives, assumptions, constraints, architecture,
non-goals, and acceptance criteria rather than accepting them automatically.

Distinguish desired outcomes from proposed implementation.

When project artifacts need to change, prepare one coordinated Documentation
Transaction proposal covering all affected artifacts.

Create that proposal only through `documentation_preview` using
`project-definition` authority and complete resulting artifact content.

Present the exact Preview for review.

After explicit approval of the exact current proposal, continue the Project
Definition procedure through permission-gated `documentation_apply` using only
that proposal identifier.

Do not create, edit, patch, delete, rename, or otherwise modify project artifacts
through generic file-editing or Bash capabilities.

Do not use Bash during Project Definition. Use approved read-only tools and
bounded `explore` investigation when existing implementation evidence is
materially relevant.

Do not perform Git lifecycle actions.

Do not treat ordinary implementation ambiguity, debugging, milestone movement,
or standalone decision recording as project redefinition.
