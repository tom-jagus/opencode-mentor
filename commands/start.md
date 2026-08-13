---
description: Start a policy-compliant local Git working branch
agent: lead
---

Load the `git-lifecycle` skill and execute its Start procedure.

Treat the following text as the requested branch or Start action:

$ARGUMENTS

Use only `git_start_preview` and `git_start_apply` for the Start lifecycle.

Create the review candidate through `git_start_preview` using the exact requested
target branch.

After explicit approval of the exact current proposal, continue through
permission-gated `git_start_apply` using only that proposal identifier.

Do not use Bash, generic Git commands, scripts, or arbitrary mutation tools.

Do not stage, commit, push, fetch, pull, rebase, merge, create a pull request,
tag, or release.

Do not modify project files.

Do not bypass effective policy or immutable Git safety requirements.

Report ineligible, stale, invalid, unavailable, concurrent, failed, or
rollback-required state exactly as returned by the constrained tools.

Do not automatically retry a failed Apply operation.
