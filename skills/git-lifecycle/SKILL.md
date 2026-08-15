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

The current implementation provides the Start and Checkpoint procedures.

The Start flow is:

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

Checkpoint stages, commits, and pushes one coherent validated unit through three
separately reviewed transactions.

Later `/finish` and `/release` procedures remain outside the current
implementation.

## Scope Boundary

Git Lifecycle owns policy-controlled Git and GitHub lifecycle operations.

Use Start when the user wants to begin a coherent unit of work on a new local
working branch.

Use Checkpoint when the user wants to stage, commit, and push one coherent
validated unit through separately reviewed transactions.

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

Start and Checkpoint use deterministic effective policy resolved from:

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

Git Lifecycle does not modify project source files.

The only permitted repository mutations are the exact reviewed operations
performed by the constrained lifecycle Apply tools:

- local branch creation and switching through `git_start_apply`;
- exact path staging through `git_checkpoint_stage_apply`;
- exact reviewed-index commit through `git_checkpoint_commit_apply`;
- exact normal non-force Push through `git_checkpoint_push_apply`.

Do not use:

- generic editing;
- Bash;
- arbitrary Git commands;
- scripts;
- another mutation tool

as a substitute for the constrained lifecycle transactions.

## Start Tool Boundary

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

## Checkpoint Contract

Checkpoint processes one coherent validated unit through three distinct
transactions:

```text
Stage Preview
  -> Stage approval
  -> permission-gated Stage Apply
  -> Commit Preview
  -> Commit approval
  -> permission-gated Commit Apply
  -> Push Preview
  -> Push approval
  -> permission-gated Push Apply
```

Stage, Commit, and Push remain separate review and mutation boundaries.

Checkpoint must not combine:

- Stage Apply with Commit Apply;
- Commit Apply with Push Apply;
- multiple approvals into one approval;
- a Preview and Apply permission gate;
- inferred paths, messages, remotes, or destinations with reviewed input.

Checkpoint does not:

- fetch;
- pull;
- rebase;
- merge;
- force-push;
- switch branches;
- create a pull request;
- configure upstream tracking;
- tag;
- release;
- expose arbitrary Git commands.

### Validation Boundary

Application-specific validation remains outside constrained Git tooling.

Before Stage Preview, establish whether relevant validation has:

- passed;
- been explicitly assessed as unnecessary; or
- been explicitly accepted with a known limitation.

When validation status is unavailable, ask for it before beginning mutation.

Do not run application validation through Checkpoint tools.

Do not treat successful Git preflight as application validation.

### Tool Boundary

Checkpoint uses only:

```text
git_state
git_checkpoint_stage_preview
git_checkpoint_stage_apply
git_checkpoint_commit_preview
git_checkpoint_commit_apply
git_checkpoint_push_preview
git_checkpoint_push_apply
```

`git_state` is optional and read-only. Use it only when the exact changed paths
needed for Stage selection are not already established.

Do not use Bash, direct Git commands, scripts, or generic mutation tools as a
substitute.

### Stage Contract

Stage requires an explicit whole-path selection.

Every already-staged path must be included in the selection.

Unselected unstaged changes may remain and must not be staged implicitly.

Partial-hunk selection is outside the initial Checkpoint implementation.

Stage Apply:

- accepts only the reviewed Stage proposal identifier;
- stages only reviewed whole paths;
- performs no commit or push;
- verifies the resulting index;
- restores the prior index after recoverable failure.

### Commit Contract

Commit Preview occurs only after Stage Apply.

It binds:

- effective policy;
- project and repository;
- working branch;
- pre-commit HEAD;
- exact staged diff and checksum;
- exact canonical commit message and checksum.

The commit message must be supplied explicitly.

Mechanical message validation is deterministic. Semantic review remains the
responsibility of `lead` and the user.

Commit Apply:

- accepts only the reviewed Commit proposal identifier;
- stages no additional content;
- commits only the reviewed index;
- performs no push;
- verifies the exact resulting commit, parent, message, and committed diff;
- rolls back recoverable post-commit failure while preserving the reviewed index.

### Push Contract

Push Preview occurs only after Commit Apply returns the exact resulting commit
identifier.

It requires:

- that exact local commit identifier;
- an explicitly supplied configured remote;
- an explicitly supplied destination branch.

Never infer:

- `origin`;
- another remote;
- an upstream remote;
- the destination from the working branch;
- the destination from upstream tracking.

Push Preview contacts the explicit remote for read-only inspection.

Push Apply:

- accepts only the reviewed Push proposal identifier;
- performs a normal non-force push;
- pushes the exact reviewed commit to the exact reviewed destination;
- uses the proposal-bound effective push URL;
- does not configure or change upstream tracking;
- verifies the exact remote result.

A successful remote Push cannot be safely rolled back automatically. When
verification or proposal-state persistence fails after remote mutation, report
the returned remote result and required manual recovery accurately.

## Checkpoint Procedure

### 1. Establish the coherent unit

Identify the exact whole paths belonging to the checkpoint.

Do not infer unrelated paths merely because they are changed.

If the path selection is unavailable, call `git_state` once and present the
changed paths without inspecting their contents. Ask the user to select the exact
paths.

Also establish the application-validation status.

Do not invoke Stage Preview until both the selection and validation status are
explicit.

### 2. Preview Stage

Call:

```text
git_checkpoint_stage_preview
  selected_paths:
    - <exact selected path>
```

When Preview rejects the operation, report its structured error and every issue.
Do not alter the selection automatically.

When Preview succeeds, present:

```markdown
# Checkpoint Stage Proposal

- **Proposal:** <proposal_id>
- **Repository:** <project_root>
- **Branch:** <review.current_branch>
- **HEAD:** <review.head_sha>
- **Selected changes:** <review.selected_changes>
- **Unselected changes:** <review.unselected_changes>
- **Staging pathspecs:** <review.staging_pathspecs>
- **Snapshot checksum:** <review.snapshot_sha256>
- **Policy resolution:** <review.policy_resolution_sha256>
- **Status:** awaiting Stage approval
```

State clearly that no Git mutation has occurred.

### 3. Apply Stage

Stop for explicit approval of the exact Stage proposal.

After approval, call:

```text
git_checkpoint_stage_apply
  proposal_id: <exact Stage proposal identifier>
```

The Apply permission request is the Stage mutation gate.

On failure:

- report the exact error;
- report rollback state when returned;
- do not continue to Commit;
- do not retry automatically.

On success, report the exact staged paths and snapshot checksum.

### 4. Establish the commit message

Obtain the exact canonical commit message.

Do not generate or silently rewrite an approved message.

When the user asks for a recommendation, propose a descriptive natural-language
message for review, but do not invoke Commit Preview until the exact message is
accepted.

### 5. Preview Commit

Call:

```text
git_checkpoint_commit_preview
  commit_message: <exact canonical message>
```

When Preview rejects the operation, report all mechanical issues.

When Preview succeeds, present:

```markdown
# Checkpoint Commit Proposal

- **Proposal:** <proposal_id>
- **Repository:** <project_root>
- **Branch:** <review.current_branch>
- **Pre-commit HEAD:** <review.head_sha>
- **Commit message:** <review.commit_message>
- **Message checksum:** <review.commit_message_sha256>
- **Staged changes:** <review.staged_changes>
- **Remaining changes:** <review.remaining_changes>
- **Staged-diff checksum:** <review.staged_diff_sha256>
- **Policy resolution:** <review.policy_resolution_sha256>
- **Status:** awaiting Commit approval
```

Then show `review.staged_diff` exactly as returned in a fenced `diff` block.

Present every `review.semantic_review` item.

State clearly that no commit has occurred.

### 6. Apply Commit

Stop for explicit approval of the exact Commit proposal.

After approval, call:

```text
git_checkpoint_commit_apply
  proposal_id: <exact Commit proposal identifier>
```

The Apply permission request is the Commit mutation gate.

On failure:

- report the exact error;
- report rollback state when returned;
- do not continue to Push;
- do not retry automatically.

On success, preserve the returned `commit_sha`. It is the only valid
`local_commit_sha` for Push Preview.

### 7. Establish Push inputs

Obtain:

- the exact configured remote name;
- the exact destination branch.

Never infer either value.

When either is unavailable, ask the user.

Do not substitute an upstream or `origin`.

### 8. Preview Push

Call:

```text
git_checkpoint_push_preview
  local_commit_sha: <exact Commit Apply commit_sha>
  remote: <exact explicit remote>
  destination_branch: <exact explicit destination>
```

When Preview rejects the operation, report the structured error, disposition,
and every issue.

When Preview succeeds, present:

```markdown
# Checkpoint Push Proposal

- **Proposal:** <proposal_id>
- **Repository:** <project_root>
- **Branch:** <review.current_branch>
- **Local commit:** <review.local_commit_sha>
- **Remote:** <review.remote>
- **Push URL:** <review.push_url_display>
- **Push URL checksum:** <review.push_url_sha256>
- **Destination branch:** <review.destination_branch>
- **Destination ref:** <review.destination_ref>
- **Expected remote commit:** <review.expected_remote_commit_sha>
- **Disposition:** <review.disposition>
- **Policy resolution:** <review.policy_resolution_sha256>
- **Status:** awaiting Push approval
```

Present every warning returned in `review.warnings`.

State clearly that no Push has occurred.

### 9. Apply Push

Stop for explicit approval of the exact Push proposal.

After approval, call:

```text
git_checkpoint_push_apply
  proposal_id: <exact Push proposal identifier>
```

The Apply permission request is the Push mutation gate.

On success, report:

- proposal identifier;
- local commit;
- remote;
- destination branch and ref;
- verified remote commit;
- whether the remote was updated;
- applied timestamp.

On failure, report:

- error code and message;
- whether remote mutation completed, failed, or is uncertain;
- whether remote state was verified;
- that automatic rollback is unavailable;
- whether manual remote inspection is required.

Never claim that a failed Push Apply left the remote unchanged unless the
structured result establishes that fact.

Do not retry automatically.

## Checkpoint Completion Condition

Checkpoint is complete only when:

- application validation was completed or explicitly assessed;
- Stage Preview was reviewed and Stage Apply succeeded;
- Commit Preview was reviewed and Commit Apply succeeded;
- Push Preview was reviewed and Push Apply succeeded;
- each mutation received its own explicit approval and permission gate;
- the final local and remote commit identifiers were reported.

When any transaction fails, Checkpoint stops at that boundary after reporting
the exact failure and recovery state.
