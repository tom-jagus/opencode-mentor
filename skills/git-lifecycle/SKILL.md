---
name: git-lifecycle
description: Preview, review, approve, and apply policy-controlled Git lifecycle operations.
compatibility: opencode
metadata:
  workflow: git-lifecycle
---

# Git Lifecycle

## Purpose

Use this skill to execute policy-controlled Git lifecycle workflows through
narrow deterministic tools.

The current implementation provides the Start procedure:

```text
request
  -> deterministic preflight
  -> immutable proposal
  -> explicit review
  -> explicit approval
  -> permission-gated Apply
  -> verified branch state
```

Start creates and switches to one policy-compliant local working branch.

It does not:

- stage files;
- commit;
- push;
- fetch or pull;
- rebase;
- create a pull request;
- merge;
- tag;
- publish a release;
- expose arbitrary Git commands.

Later `/checkpoint`, `/finish`, and `/release` procedures remain outside the
current implementation.

## Scope Boundary

Git Lifecycle owns policy-controlled Git and GitHub lifecycle operations.

Use Start when the user wants to begin a coherent unit of work on a new local
working branch.

Do not use Start to:

- switch to an existing branch;
- create an unvalidated branch;
- carry uncommitted changes onto a new branch;
- bypass effective policy;
- work around an ineligible repository state;
- redefine Git policy or approved project scope.

Policy changes belong to Development or the appropriate durable project
workflow.

Material project-scope changes belong to Project Definition.

## Effective Policy

Start uses deterministic effective policy resolved from:

```text
global Git defaults
  -> optional sparse project overrides
  -> strict policy validation
  -> effective Git policy
```

The workflow does not infer policy precedence or silently replace invalid
policy.

Malformed policy, unknown keys, invalid values, and unsupported schema versions
are hard failures.

Immutable Git safety rules remain separate from configurable policy.

## Start Contract

Start may create a branch only when deterministic preflight establishes all of
the following:

- the workspace is inside a Git repository;
- Git inspection succeeds;
- the repository has a valid named HEAD;
- the current branch is the effective base branch;
- the working tree is completely clean;
- no unresolved conflicts exist;
- the proposed branch follows the effective branch grammar;
- the proposed branch type is allowed by effective policy;
- the proposed branch is not the effective base branch;
- the proposed local branch does not already exist;
- the effective policy is valid.

These are fail-closed requirements.

Do not weaken or reinterpret them conversationally.

## Source Ownership

The Start workflow does not modify project source files.

The only permitted project mutation is the exact local Git branch operation
performed by `git_start_apply`.

Do not use:

- generic editing;
- Bash;
- arbitrary Git commands;
- scripts;
- another mutation tool

as a substitute for the constrained Start transaction.

## Tool Boundary

Start uses only:

```text
git_start_preview
git_start_apply
```

`git_start_preview`:

- is read-only with respect to Git and project files;
- runs deterministic preflight;
- rejects ineligible operations;
- persists an immutable project-bound proposal outside the repository;
- returns the exact reviewed operation and freshness state.

`git_start_apply`:

- accepts only the exact proposal identifier;
- is permission-gated;
- reloads and strictly validates the persisted proposal;
- revalidates project binding, policy, branch, HEAD, working tree, conflicts, and
  target-branch absence;
- creates and switches to only the reviewed local branch;
- verifies the resulting state;
- marks the proposal applied;
- attempts constrained rollback after a recoverable post-mutation failure.

Never reconstruct Apply input from conversational text.

## Start Procedure

### 1. Establish the target branch

Identify the exact requested local branch name.

The expected form is:

```text
<type>/<lowercase-kebab-case-summary>
```

Do not add or substitute a branch type that the user did not request.

When the target branch is missing or materially ambiguous, ask for the exact
branch name before invoking Preview.

Do not invoke Apply based only on inferred intent.

### 2. Create the Preview

Call:

```text
git_start_preview
  target_branch: <exact requested branch>
```

Do not call Bash or invoke Git separately before or after Preview.

The tool owns deterministic policy resolution, repository inspection, and
eligibility validation.

### 3. Handle Preview rejection

When Preview returns `ok: false`, report:

- the structured error code;
- the error message;
- every eligibility issue returned by the tool.

Do not:

- create a proposal manually;
- ask Apply to bypass the rejection;
- switch branches;
- clean or modify the working tree;
- retry automatically with a different branch name.

When policy is invalid, report the underlying policy cause when supplied.

When the user changes the requested target, call Preview again. The new target
requires a new proposal.

### 4. Present the review candidate

When Preview succeeds, present:

````markdown
# Git Start Proposal

- **Proposal:** <proposal_id>
- **Repository:** <repository_root>
- **Operation:** create and switch local branch
- **Current branch:** <review.current_branch>
- **Effective base branch:** <review.base_branch>
- **Target branch:** <review.target_branch>
- **HEAD:** <review.head_sha>
- **Working tree:** <review.working_tree>
- **Project policy present:** <review.project_policy_present>
- **Policy resolution:** <review.policy_resolution_sha256>
- **Status:** awaiting approval
````

State clearly:

No Git mutation has occurred.

The complete structured tool result remains authoritative.

Do not paraphrase the reviewed target into a different branch name.

### 5. Stop for explicit approval

Wait for explicit approval of the exact current proposal.

Approval must refer unambiguously to the proposal currently under review.

Examples of sufficient approval include:

```text
approved
apply this proposal
proceed with git-start-...
```

Questions, discussion, revised branch names, or conditional language are not
approval.

If the user requests a different target branch, create a new Preview and treat
the earlier proposal as no longer current.

### 6. Apply the exact proposal

After explicit approval, call:

```text
git_start_apply
  proposal_id: <exact current proposal identifier>
```

Do not pass:

- a branch name;
- replacement policy;
- Git arguments;
- shell commands;
- reconstructed proposal content.

The Apply permission request is the final mutation gate.

### 7. Handle Apply results

On success, report:

# Git Start Applied

- **Proposal:** ...
- **Repository:** ...
- **Base branch:** ...
- **Current branch:** ...
- **HEAD:** ...
- **Applied at:** ...

State that the reviewed local branch was created and checked out.

On failure, report the structured error accurately.

Important failure classes include:

- INVALID_PROPOSAL_ID;
- PROPOSAL_NOT_FOUND;
- INVALID_PROPOSAL;
- UNSUPPORTED_PROPOSAL_VERSION;
- PROPOSAL_INTEGRITY_FAILED;
- PROJECT_MISMATCH;
- PROPOSAL_ALREADY_APPLIED;
- STALE_PROPOSAL;
- APPLY_IN_PROGRESS;
- APPLY_FAILED;
- PROPOSAL_STATE_FAILED;
- ROLLBACK_FAILED.

When rollback information is returned, report:

- whether rollback succeeded;
- every rollback error;
- whether repository recovery requires manual inspection.

Do not claim success after a failed Apply.

Do not automatically retry any Apply failure.

A stale proposal requires a new Preview before any later Apply attempt.

If permission is denied, report that no approved mutation was performed and stop.

## Output Contract

### Successful Preview

````markdown
# Git Start Proposal

- **Proposal:** ...
- **Repository:** ...
- **Operation:** create and switch local branch
- **Current branch:** ...
- **Effective base branch:** ...
- **Target branch:** ...
- **HEAD:** ...
- **Working tree:** clean
- **Project policy present:** true | false
- **Policy resolution:** ...
- **Status:** awaiting approval

No Git mutation has occurred.
````

### Rejected Preview

````markdown
# Git Start

## Result

not eligible | unavailable | invalid policy

## Findings

- CODE — message

No proposal was created and no Git mutation occurred.
````

### Successful Apply

````markdown
# Git Start Applied

- **Proposal:** ...
- **Repository:** ...
- **Base branch:** ...
- **Current branch:** ...
- **HEAD:** ...
- **Applied at:** ...
````

### Failed Apply

````markdown
# Git Start Failed

- **Proposal:** ...
- **Code:** ...
- **Message:** ...
- **Rollback:** not required | succeeded | failed
- **Rollback errors:** none | ...

Do not retry Apply without resolving the reported state.
````

## Completion Condition

Start is complete when:

- an exact target branch was established;
- Preview succeeded;
- the exact proposal was presented;
- the user explicitly approved it;
- permission-gated Apply succeeded;
- the resulting branch and HEAD were reported.

When Preview or Apply fails, the procedure is complete after the failure and
required recovery information have been reported accurately.
