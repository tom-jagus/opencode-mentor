---
description: Mentor - Stage, commit, and push one coherent validated unit
agent: lead
---

Load the `git-lifecycle` skill and execute its Checkpoint procedure.

Treat the following text as requested Checkpoint context, including any supplied
validation status, path selection, commit message, remote, or destination branch:

$ARGUMENTS

Do not treat omitted values as approved or infer them from repository conventions.

Use only:

- `git_state` when exact changed paths must be presented for explicit selection;
- `git_checkpoint_stage_preview`;
- `git_checkpoint_stage_apply`;
- `git_checkpoint_commit_preview`;
- `git_checkpoint_commit_apply`;
- `git_checkpoint_push_preview`;
- `git_checkpoint_push_apply`.

Before Stage Preview, establish:

- the exact whole-path selection;
- whether relevant application validation passed, was assessed as unnecessary, or
  was explicitly accepted with a known limitation.

Require separate explicit review and approval for:

1. Stage;
2. Commit;
3. Push.

Each Apply must receive only the exact current proposal identifier and must pass
its own permission gate.

Do not carry approval from one transaction into another.

Do not use Bash, direct Git commands, scripts, generic mutation tools, or
unconstrained shell execution.

Do not fetch, pull, rebase, merge, force-push, switch branches, create a pull
request, configure upstream tracking, tag, or release.

Never infer:

- unrelated paths;
- a commit message;
- `origin` or another remote;
- an upstream remote;
- a destination branch.

Stop at the current transaction boundary after any rejection, denied permission,
stale proposal, failed Apply, failed rollback, uncertain remote result, or
unverified remote state.

Do not retry a failed Apply automatically.
