---
name: project-progress
description: Read and manage durable project state, milestones, and decisions without redefining approved project scope.
compatibility: opencode
metadata:
  workflow: project-progress
---

# Project Progress

## Purpose

Use this skill to work with durable project state stored in the project's
authoritative Markdown artifacts.

This skill covers:

- lightweight project state reporting;
- session recovery from durable project context;
- milestone state;
- durable decision history;
- detection of inconsistencies between project artifacts;
- identification of the next documented action.

The current implementation provides:

- read-only **State**;
- read-only **Resume**;
- transactional **Milestone**;
- transactional **Decision**.

State and Resume are strictly read-only.

Milestone and Decision may modify their owned authoritative artifact only through
the constrained Documentation Transaction after exact Preview, explicit approval,
and permission-gated Apply.

## Scope Boundary

Project Progress manages operational state. It does not redefine project scope.

Use this skill for:

- current phase;
- completed and active milestones;
- blockers;
- open implementation questions;
- next actions;
- durable decisions;
- repository state relevant to current work.

Return to the Project Definition workflow when evidence indicates a material
change to:

- project objectives;
- non-goals;
- core constraints;
- accepted architecture;
- required capabilities;
- acceptance criteria;
- implementation phases.

Do not silently convert a scope change into a progress update.

## Authoritative Artifacts

Use these project files when available:

```text
docs/project/definition.md
docs/project/progress.md
docs/project/decisions.md
```

Their responsibilities are separate.

### `definition.md`

Authoritative for:

- purpose;
- problem statement;
- objectives;
- non-goals;
- operating principles;
- approved architecture;
- workflow contracts;
- constraints;
- acceptance criteria;
- planned implementation phases;
- definition version.

It does not own the current operational phase or active milestone.

### `progress.md`

Authoritative for:

- current phase;
- active milestone;
- completed milestones;
- implementation status;
- blockers;
- open implementation questions;
- risks;
- next documented action.

### `decisions.md`

Authoritative for:

- accepted decisions;
- rejected alternatives;
- superseded decisions;
- rationales;
- consequences;
- durable implementation choices.

Treat the decision register as append-oriented. Historical accepted decisions
must not be removed merely because a later decision supersedes them.

## General Rules

- Read authoritative project artifacts before reporting or reconstructing project
  state.
- Prefer explicit artifact content over assumptions from the conversation.
- Treat prior conversation history as non-authoritative context.
- Distinguish recorded facts, repository observations, and inferred
  recommendations.
- Do not invent missing project state.
- Do not silently repair contradictions.
- Report conflicting values together and identify their sources.
- Do not mutate files, Git state, GitHub state, or runtime configuration during
  State or Resume.
- Milestone may modify only `docs/project/progress.md`, and only through
  `documentation_preview` with `milestone` authority followed by explicit review,
  approval, and permission-gated `documentation_apply`.
- Decision may modify only `docs/project/decisions.md`, and only through
  `documentation_preview` with `decision` authority followed by explicit review,
  approval, and permission-gated `documentation_apply`.
- Do not stage, commit, push, switch branches, fetch, pull, merge, rebase, tag,
  release, or create pull requests.
- State and Resume must not invoke documentation mutation tools.
- Milestone and Decision may invoke only `documentation_preview` and
  `documentation_apply` as specified by their procedures.
- Do not invoke vault write tools.
- Do not call the Bash tool anywhere in the State, Resume, Milestone, or Decision
  procedures.
- Treat a milestone as currently complete only when completion is recorded
  explicitly in `progress.md`.
- The Milestone procedure may propose completion only from explicit user intent;
  implementation appearance alone is insufficient.
- Do not treat an implementation-level unknown as a scope problem unless it
  materially affects approved objectives, constraints, architecture, or
  acceptance criteria.
- Treat paths returned by `git_state` as repository-state facts.
- Report staged, unstaged, untracked, and conflicted paths exactly as returned.
- Do not inspect the type, metadata, contents, ownership, or purpose of changed
  paths merely because they appear in repository state.
- Inspect a changed path only when it is an authoritative project artifact that
  the selected procedure already requires, or when the user explicitly requests
  a separate investigation.
- An unusual filename is not by itself a blocker and does not justify additional
  inspection.
- Milestone proposals affect operational state in `progress.md` only.
- Do not use a milestone transition to redefine approved project scope.
- Do not infer milestone completion from repository activity alone.
- Decision proposals affect durable decision history in `decisions.md` only.
- Do not use a decision update to redefine approved project scope.
- Do not use a decision update to perform a milestone transition.
- Preserve historical decision entries when they are superseded or rejected.
- Do not invent user motivations or rationale that are not established by the
  request, authoritative artifacts, or evidence available to the procedure.
- Do not use generic editing as a substitute for the Documentation Transaction.
- Never alter proposal content at Apply time; Apply receives only the exact
  approved proposal identifier.
- Do not automatically retry failed Apply operations.

## State Procedure

Use this procedure when the user invokes `/state` or explicitly requests a
lightweight report of current project and repository state.

The procedure is read-only.

### 1. Locate the project root

Determine the current workspace root.

Prefer the Git repository root when the workspace is inside a Git repository.

When no Git repository is available:

- continue reading project artifacts relative to the workspace when possible;
- report Git state as unavailable;
- do not fail the entire state report solely because Git is absent.

### 2. Read project instructions

Read the applicable project `AGENTS.md` when present.

Use it to understand project-specific operating rules, terminology, and artifact
locations.

Do not allow project instructions to weaken the global source-ownership or
permission boundaries.

### 3. Read authoritative artifacts

Attempt to read:

```text
docs/project/definition.md
docs/project/progress.md
docs/project/decisions.md
```

For each file:

- report whether it exists;
- read its frontmatter when present;
- extract only information relevant to the state report;
- preserve the artifact's terminology;
- do not infer absent values.

A missing artifact is a reportable condition, not permission to create it.

### 4. Extract project definition status

From `definition.md`, identify when available:

- project title;
- definition status;
- definition version;
- approval date;
- project purpose or primary objective;
- planned implementation phases;
- acceptance criteria relevant to the active milestone.

Keep this summary brief. `/state` is not a full definition review.

### 5. Extract operational state

From `progress.md`, identify when available:

- current phase;
- completed milestones;
- active milestone;
- implementation status;
- blockers;
- open questions relevant to current work;
- risks currently affecting progress;
- next documented action;
- last recorded update date.

Prefer explicit fields in the Current State section for the main report.

Use frontmatter as additional structured evidence, not as an unquestioned
replacement for contradictory body content.

### 6. Extract relevant decisions

From `decisions.md`, identify:

- accepted decisions directly relevant to the active milestone;
- recent decisions that changed implementation direction;
- superseded decisions that might otherwise create confusion;
- unresolved proposed decisions when present.

Do not summarize the entire decision history.

Prioritize:

1. decisions named by the active milestone;
2. decisions referenced by `progress.md`;
3. the most recent accepted or superseding decisions;
4. decisions that materially constrain the next action.

When one decision supersedes another, report the effective decision and mention
the supersession only when it helps explain the current state.

### 7. Inspect Git state

Call the `git_state` tool exactly once.

The tool performs deterministic, local, read-only Git inspection and returns
structured repository state.

Use its result to identify when available:

- repository root;
- current branch or detached HEAD state;
- unborn branch state;
- upstream branch;
- ahead and behind counts;
- staged paths;
- unstaged paths;
- untracked paths;
- merge conflicts;
- latest commit.

Do not use the Bash tool for routine Git inspection during the State procedure.

If `git_state` reports that the workspace is not inside a Git repository, report
Git state as unavailable and continue with artifact-based project state.

If `git_state` is unavailable or reports an inspection failure:

- report the failure clearly;
- do not guess the missing Git information;
- do not fall back to general Bash commands;
- continue with the project information that remains available.

The `git_state` result is sufficient for working-tree reporting.

Do not run additional commands or tools to inspect paths listed as staged,
unstaged, untracked, or conflicted. Report those paths as repository state.

An unusual filename is not by itself a blocker and does not justify further
inspection.

### 8. Check artifact consistency

Compare overlapping values across artifacts.

Check at least:

- project title and identity;
- definition version;
- definition status;
- current phase;
- active milestone;
- completed milestone declarations;
- implementation phase ordering;
- next documented action;
- decisions referenced as superseding other decisions.

Classify findings as:

- **consistent** - relevant values agree;
- **missing** - an expected value or artifact is unavailable;
- **inconsistent** - two authoritative locations provide conflicting values;
- **stale** - a value clearly refers to a completed or superseded state.

Do not resolve inconsistencies automatically.

For every inconsistency, report:

- the conflicting values;
- the files or sections containing them;
- which artifact normally owns that type of state;
- the recommended corrective workflow.

Examples:

- a current-phase conflict belongs to Project Progress;
- a definition-version conflict requires checking whether an approved material
  definition change was recorded;
- a material scope conflict returns to `/define`;
- a milestone transition belongs to `/milestone` once its write workflow exists.

### 9. Determine blockers

Separate blockers into:

- explicitly recorded blockers;
- repository-state blockers;
- artifact-consistency blockers;
- inferred risks.

Do not promote every open question into a blocker.

An issue is a blocker only when it prevents the documented next action or makes
continuation unsafe or materially ambiguous.

Label inferred blockers clearly as inference.

### 10. Determine the recommended next action

Start with the next action recorded in `progress.md`.

Evaluate it against:

- current branch;
- working-tree state;
- completed work;
- blockers;
- relevant decisions;
- artifact inconsistencies.

Return one recommended next action.

When the documented next action remains valid, preserve it.

When evidence shows it is stale or blocked:

- report the documented action;
- explain the conflict;
- recommend the smallest corrective action;
- do not update the artifact automatically.

Do not expand the recommendation into a broad new plan unless the user asks.

## State Output Contract

Return the report using this structure.

```markdown
# Project State

## Project

- **Name:** ...
- **Objective:** ...
- **Definition:** approved, version ...
- **Current phase:** ...
- **Active milestone:** ...

## Repository

- **Branch:** ...
- **Tracking:** ...
- **Working tree:** clean | dirty | unavailable
- **Latest checkpoint:** ...

## Progress

- **Completed:** ...
- **Current work:** ...
- **Blockers:** none | ...
- **Next documented action:** ...

## Relevant Decisions

- DEC-... - ...

## Consistency

- **State:** consistent | issues detected
- ...

## Recommended Next Action

...
```

Omit empty optional subsections only when their absence cannot hide a problem.

Use `unavailable` rather than omitting required state that could not be read.

Keep the normal report concise, but include enough detail to make the next action
unambiguous.

## Required Behaviour for Common Conditions

### Complete and consistent project state

Produce the normal report and state that no artifact inconsistencies were found.

### Missing `definition.md`

Report:

- project definition unavailable;
- objective and definition version unavailable;
- whether progress and decisions can still be read;
- recommended recovery or definition workflow.

Do not reconstruct a definition from progress or conversation history.

### Missing `progress.md`

Report:

- operational project state unavailable;
- active phase, milestone, blockers, and next documented action unavailable;
- definition and decisions that remain readable.

Do not infer the active milestone from branch names alone.

### Missing `decisions.md`

Report:

- decision history unavailable;
- any decision references found in other artifacts;
- that effective decision constraints could not be fully verified.

### Conflicting definition versions

Show every conflicting version and its source.

Do not choose the numerically highest version without evidence that the
corresponding material definition change was approved.

### Conflicting milestone state

Treat `progress.md` as the normal owner of operational milestone state, but report
contradictions inside that file or between its frontmatter and body.

Do not silently prefer frontmatter over body or body over frontmatter.

### Dirty working tree

Report:

- whether changes are staged, unstaged, untracked, or conflicted;
- the affected paths exactly as returned by `git_state`;
- whether the dirty state blocks the documented next action.

Do not inspect changed paths merely to classify or explain them.
Do not infer why a path exists.

### Detached HEAD

Report detached HEAD explicitly and avoid describing it as a normal feature
branch.

### Missing upstream

Report that the current branch is local-only or lacks upstream tracking.

Do not push or configure an upstream.

### Not inside Git

Report Git state as unavailable and continue with artifact-based state.

## Resume Procedure

Use this procedure when the user invokes `/resume` or explicitly asks to restore
enough durable project context to continue work in a new session.

The procedure is read-only.

`/resume` is intentionally broader than `/state`.

`/state` answers:

> What is the project and repository state now?

`/resume` answers:

> What durable context do I need in order to continue the current work safely
> and coherently?

Resume must reconstruct context from project artifacts and repository state
rather than relying on previous conversation history.

### 1. Locate the project root

Determine the current workspace root.

Prefer the Git repository root when the workspace is inside a Git repository.

When no Git repository is available:

- continue reading project artifacts relative to the workspace when possible;
- report repository context as unavailable;
- do not fail the entire recovery solely because Git is absent.

### 2. Read project instructions

Read the applicable project `AGENTS.md` when present.

Use it to recover:

- project-specific operating rules;
- source-ownership constraints;
- terminology;
- artifact locations;
- workflow restrictions relevant to continued work.

Do not allow project instructions to weaken global permission or source-ownership
boundaries.

### 3. Read authoritative project artifacts

Attempt to read:

```text
docs/project/definition.md
docs/project/progress.md
docs/project/decisions.md
```

For each file:

- report whether it exists;
- read its frontmatter when present;
- recover context relevant to the current phase, milestone, and next action;
- preserve the artifact's terminology;
- do not infer missing values.

A missing artifact is a recovery limitation, not permission to reconstruct or
create it.

### 4. Recover approved project context

From `definition.md`, identify when available:

- project title and identity;
- approved definition status and version;
- project purpose or primary objective;
- important non-goals;
- constraints relevant to current work;
- approved architecture relevant to the active milestone;
- acceptance criteria relevant to the current implementation unit;
- planned implementation phase containing the active milestone.

Do not summarize the entire definition.

Recover only enough approved scope to prevent the resumed session from drifting
or reopening settled decisions unnecessarily.

### 5. Recover operational work context

From `progress.md`, identify when available:

- current phase;
- completed milestones;
- active milestone;
- current implementation status;
- explicitly recorded blockers;
- open implementation questions relevant to current work;
- active risks;
- next documented action;
- last recorded update.

Identify what the project says is currently being worked on.

Do not infer a new milestone or implementation unit merely from repository paths
or branch names.

### 6. Recover relevant decision context

From `decisions.md`, recover decisions that materially constrain continuation.

Prioritize:

1. decisions directly relevant to the active milestone;
2. decisions referenced by `progress.md`;
3. recent decisions that changed implementation direction;
4. decisions that define safety or workflow boundaries for the next action;
5. superseding decisions needed to avoid following obsolete guidance.

For each included decision, preserve:

- identifier;
- effective status;
- decision;
- consequence relevant to current work.

Do not reproduce the complete decision register.

Do not treat a superseded decision as current merely because it appears earlier
in the file.

### 7. Inspect repository state

Call the `git_state` tool exactly once.

Use its structured result to recover when available:

- repository root;
- current branch or detached HEAD state;
- unborn branch state;
- upstream branch;
- ahead and behind counts;
- staged paths;
- unstaged paths;
- untracked paths;
- conflicts;
- latest repository checkpoint.

Do not use Bash or another Git mechanism to expand repository inspection.

The latest commit returned by `git_state` is the repository checkpoint available
to Resume v1.

If deeper commit history is required but unavailable, report that limitation
rather than reconstructing history through general shell commands.

If `git_state` reports that the workspace is not inside a Git repository, report
repository context as unavailable and continue.

If `git_state` is unavailable or reports an inspection failure:

- report the failure clearly;
- do not guess repository state;
- do not fall back to Bash;
- continue recovering artifact-based context.

Do not inspect the contents or purpose of paths returned by `git_state` merely
because they are changed or unusual.

### 8. Check recovered context for consistency

Compare overlapping values needed for continuation.

Check at least:

- project identity;
- definition status and version;
- current phase;
- active milestone;
- completed milestone declarations;
- implementation status;
- next documented action;
- relevant superseding decisions;
- repository branch state when the documented workflow depends on it.

Classify findings as:

- **consistent** - relevant values agree;
- **missing** - required recovery context is unavailable;
- **inconsistent** - authoritative locations conflict;
- **stale** - recorded context clearly describes superseded or completed work.

Do not resolve contradictions automatically.

For each material issue, identify:

- the conflicting or missing context;
- its source;
- which artifact normally owns that information;
- whether the issue prevents safe continuation.

### 9. Reconstruct the continuation context

Build a concise model of the current work using three evidence classes.

#### Recorded facts

Facts explicitly stored in authoritative project artifacts.

Examples:

- approved objective;
- active milestone;
- implementation status;
- accepted decisions;
- documented blockers;
- next documented action.

#### Repository observations

Facts returned by `git_state`.

Examples:

- current branch;
- dirty or clean working tree;
- changed paths;
- upstream divergence;
- latest checkpoint.

Repository observations do not automatically redefine recorded project state.

#### Inferences

Recommendations derived from comparing recorded facts with repository
observations.

Examples:

- the documented next action appears stale;
- the working tree may need review before continuing;
- an inconsistency should be corrected before implementation proceeds.

Label these as inference.

Never present an inferred recommendation as though it were already recorded
project state.

### 10. Determine continuation readiness

Determine whether the project can continue safely from the recovered context.

Classify recovery as:

- **ready** - sufficient durable context exists and no blocker prevents the next
  action;
- **ready with issues** - continuation is possible, but missing, stale, or
  inconsistent context should be noted;
- **blocked** - required context is missing or contradictory enough that
  continuing would be unsafe or materially ambiguous.

Do not classify ordinary open questions as blockers unless they prevent the next
documented action.

### 11. Determine the continuation action

Start with the next action recorded in `progress.md`.

Evaluate it against:

- approved scope;
- active milestone;
- relevant decisions;
- current implementation status;
- repository state;
- blockers;
- material inconsistencies.

Return both when available:

- **Next documented action** - exactly what durable project state says should
  happen next.
- **Recommended immediate action** - what should be done now after considering
  repository observations and consistency findings.

When they are the same, say so without inventing a second action.

When they differ:

- preserve the documented action;
- explain why it appears stale, blocked, or premature;
- recommend the smallest corrective step;
- do not update project artifacts automatically.

Do not expand recovery into a new implementation plan unless the user asks.

## Resume Output Contract

Return the recovery report using this structure:

```markdown
# Session Recovery

## Project

- **Name:** ...
- **Objective:** ...
- **Definition:** approved, version ...
- **Current phase:** ...
- **Active milestone:** ...

## Current Work

- **Implementation status:** ...
- **Completed milestones:** ...
- **Latest checkpoint:** ...
- **Working tree:** clean | dirty | unavailable
- **Changed paths:** none | ...
- **Tracking:** ...

## Relevant Decisions

- DEC-... - ...

## Blockers and Risks

- **Recorded blockers:** none | ...
- **Consistency issues:** none | ...
- **Repository concerns:** none | ...

## Continuation

- **Recovery:** ready | ready with issues | blocked
- **Next documented action:** ...
- **Recommended immediate action:** ...

## Unavailable Context

- none | ...
```

Omit `Unavailable Context` only when all required recovery information was
available.

Keep the report focused on continuation. Do not reproduce full project artifacts
or the complete decision register.

Use `unavailable` rather than guessing required state.

## Required Resume Behaviour for Common Conditions

### Complete and consistent project context

Return a concise recovery report, classify recovery as `ready`, and identify the
documented next action.

### Missing `definition.md`

Report approved scope as unavailable.

Do not reconstruct the objective, architecture, or acceptance criteria from
progress, decisions, branch names, or conversation history.

Classify recovery as `blocked` when safe continuation depends on approved scope.

### Missing `progress.md`

Report current phase, active milestone, implementation status, blockers, and
next documented action as unavailable.

Do not infer them from the branch name or recent repository activity.

Normally classify recovery as `blocked`.

### Missing `decisions.md`

Report decision history as unavailable.

Continue only when the available definition and progress context are sufficient
and no unresolved decision dependency is referenced.

Otherwise classify recovery as `blocked`.

### Dirty working tree

Report changed paths exactly as returned by `git_state`.

Do not inspect their contents merely to infer what work was being performed.

Determine whether the dirty state affects the documented next action.

### Conflicting project artifacts

Report the conflicting values and their sources.

Do not silently choose one.

Classify recovery as `blocked` only when the inconsistency makes continuation
unsafe or materially ambiguous.

### Stale next action

Preserve the recorded next action.

Explain the evidence showing that it appears stale.

Return the smallest corrective action as the recommended immediate action.

### Detached HEAD

Report detached HEAD explicitly.

Do not infer a feature branch or switch branches.

Determine whether the documented next action requires normal branch context.

### Missing upstream

Report the absence of upstream tracking.

Do not configure or push an upstream.

Treat it as a blocker only when the documented next action depends on remote
tracking.

### No Git repository

Report repository context as unavailable.

Continue recovery from durable artifacts when possible.

### Insufficient recovery context

List exactly what information is unavailable or contradictory.

Do not fill gaps using prior conversation history.

Return the smallest recovery action needed before normal work can continue.

## Resume Completion Condition

The Resume procedure is complete when:

- applicable project instructions have been read;
- available authoritative project artifacts have been read;
- relevant approved scope has been recovered;
- current operational work context has been recovered;
- relevant effective decisions have been identified;
- repository state has been inspected once or reported unavailable;
- missing, stale, and inconsistent context has been identified;
- recorded facts, repository observations, and inferences have been kept
  distinct;
- continuation readiness has been classified;
- the next documented action and recommended immediate action have been returned;
- no mutation has occurred.

## Milestone Procedure

Use this procedure when the user invokes `/milestone` or explicitly asks to
start, complete, block, unblock, or otherwise transition a project milestone.

The procedure owns transactional operational changes to:

```text
docs/project/progress.md
```

Milestone changes are previewed through the Documentation Transaction using
`milestone` authority and are applied only after explicit review, approval, and
the permission-gated Apply operation.

No other project artifact may be mutated by this procedure.

### 1. Establish the requested transition

Identify:

- the milestone involved;
- the requested transition;
- any reason, blocker, or completion context supplied by the user;
- whether more than one milestone transition is explicitly requested.

Interpret the user's request naturally.

Typical transitions include:

- start;
- complete;
- block;
- unblock;
- cancel.

A single request may contain a coherent transition such as completing one
milestone and starting the next.

Do not invent an additional transition merely because it would be convenient.

### 2. Read project instructions

Read the applicable project `AGENTS.md` when present.

Use it to understand:

- workflow boundaries;
- project terminology;
- artifact locations;
- operational constraints.

Do not allow project instructions to weaken global permission or source-ownership
boundaries.

### 3. Read authoritative project state

Read when available:

```text
docs/project/definition.md
docs/project/progress.md
```

Read `decisions.md` only when the requested transition depends on a recorded
decision or `progress.md` explicitly references one.

From `definition.md`, recover only enough approved scope to verify that the
transition does not redefine the project.

From `progress.md`, identify:

- current phase;
- active milestone;
- completed milestones;
- planned milestones;
- milestone statuses;
- current implementation status;
- blocking issues;
- open implementation questions relevant to the milestone;
- next documented action.

Do not infer missing milestone state from branch names, repository activity, or
conversation history.

### 4. Identify the current milestone state

Determine the recorded state of the requested milestone.

Use the terminology already present in `progress.md`.

Typical states are:

- planned;
- active;
- blocked;
- completed;
- cancelled.

Also determine whether another milestone is currently active.

Report contradictions when, for example:

- frontmatter and Current State name different active milestones;
- a milestone is marked both active and completed;
- multiple milestones appear active without an explicit project convention;
- a milestone named by the request does not exist in the recorded milestone plan.

Do not silently repair these conditions.

### 5. Validate workflow ownership

Determine whether the request is actually a milestone transition.

Continue with Milestone when the request changes operational state such as:

- which milestone is active;
- whether a milestone is blocked;
- whether a milestone is completed;
- which next action follows from that transition.

Use `/define` instead when satisfying the request would materially change:

- project objectives;
- non-goals;
- core constraints;
- accepted architecture;
- required capabilities;
- acceptance criteria;
- planned implementation phases.

Do not rewrite approved project meaning merely to make a milestone transition
valid.

### 6. Evaluate the requested transition

Evaluate the transition against the recorded project state.

**Start**

A start transition normally requires:

- the target milestone exists in the recorded plan;
- it is not already completed;
- it is not already active;
- another active milestone will not be silently displaced.

If another milestone is active, require either:

- an explicit transition for that milestone in the same request; or
- clarification.

Do not automatically complete the current milestone merely because the user
starts another one.

**Complete**

A completion transition requires explicit user intent.

Before proposing completion, check `progress.md` for:

- recorded remaining deliverables;
- recorded blockers;
- unresolved items explicitly identified as completion requirements;
- implementation status contradicting completion.

If the durable project state still records unfinished milestone work, surface
that conflict.

Do not claim completion merely because repository implementation appears
finished.

If the user explicitly confirms completion despite remaining recorded work, the
milestone may be proposed as completed, but preserve the discrepancy accurately.

Completion of the milestone and completion of every recorded work item are
separate facts.

Do not:

- describe recorded unfinished work as completed without evidence;
- remove unresolved questions merely because the milestone is being completed;
- imply that blockers, deliverables, or questions were resolved, waived,
  cancelled, or transferred unless the user established that disposition;
- replace detailed recorded state with a blanket statement that all milestone
  work is complete.

When unfinished work remains at completion, preserve it as unresolved milestone
history or follow-on work without inventing where it belongs.

If the requested completion cannot be represented coherently without deciding
the disposition of unfinished work, return `needs clarification` and ask only
for that disposition.

**Block**

A block transition should identify the blocking condition.

Keep the milestone as the current operational focus unless the user explicitly
moves work elsewhere.

Propose:

- blocked milestone status;
- the blocker;
- an appropriate next action related to resolving or waiting on the blocker.

Do not convert an ordinary open implementation question into a blocker unless
it actually prevents progress.

**Unblock**

An unblock transition requires evidence from the user's request or recorded
state that the blocking condition is resolved or no longer prevents progress.

Propose removal or resolution of only the relevant blocker.

Do not remove unrelated blockers.

Return the milestone to active state unless the user explicitly requests another
transition.

**Cancel**

A cancel transition means the milestone is intentionally abandoned rather than
completed.

Before proposing cancellation, determine whether abandoning the milestone would
materially change approved project scope.

Cancellation is valid only when the milestone can be abandoned without changing:

- required project objectives;
- core constraints;
- accepted architecture;
- required capabilities;
- acceptance criteria;
- planned implementation phases owned by the approved definition.

If cancellation would leave required approved scope intentionally undelivered,
classify the request as a scope change and route it to `/define`.

For a valid cancellation:

- preserve the milestone in project history;
- mark its status as cancelled;
- preserve the reason for cancellation when the user supplied one;
- remove it as the active milestone when it is currently active;
- update blocker state when cancellation makes an existing blocker irrelevant;
- update the next action to reflect the resulting operational state.

Do not mark a cancelled milestone as completed.

Do not automatically activate another milestone merely because the current
milestone was cancelled.

When the user explicitly requests a combined transition such as:

```text
cancel Research and start Live Deployment
```

evaluate both transitions through the combined-transition procedure.

Do not cancel an already completed milestone merely to rewrite project history.
If the user intends to revise previously recorded completion, require
clarification before proposing a state change.

### 7. Handle combined transitions

When the user explicitly requests a coherent sequence such as:

```
complete Project Workflows and start Documentation Transaction
```

evaluate each transition in order.

The combined proposal must leave `progress.md` internally consistent.

For example:

1. complete the current milestone;
2. add it to completed milestones;
3. mark its milestone section completed;
4. activate the next milestone;
5. update active-milestone fields;
6. update implementation status and next action as required.

Do not infer a combined transition from a request that mentions only one action.

### 8. Determine transition result

Classify the requested transition as:

- **valid** - the recorded state supports the requested transition;
- **needs clarification** - material operational intent is ambiguous;
- **inconsistent** - authoritative project state conflicts enough that the
transition cannot be proposed safely;
- **scope change** - the request belongs to Project Definition.
- **unavailable** - authoritative operational state required for the transition
is unavailable.

For `needs clarification`, ask only the question required to resolve the
transition.

For `inconsistent`, identify the conflicting state and its authoritative
location.

For `scope change`, explain why `/define` owns the requested change.

For `unavailable`, identify the missing authoritative state and do not propose a
transition from assumptions or conversation history.

### 9. Determine affected progress state

For a valid transition, determine the smallest coherent set of
`progress.md` changes.

Consider only fields actually affected by the transition, including when
relevant:

- frontmatter `active_milestone`;
- `Current State`;
- completed milestone declarations;
- active milestone declaration;
- milestone section status;
- implementation status;
- blocking issues;
- relevant open questions;
- next action;
- `updated_at`.

Preserve unrelated milestone history, risks, questions, and future plans.

Completing a milestone does not by itself authorize removing unresolved work or
open questions associated with that milestone.

Do not rewrite the entire progress artifact merely because one milestone changes
state.

### 10. Check internal consistency

Before presenting the proposal, verify that the resulting operational state
would be internally consistent.

Check when applicable:

- frontmatter active milestone;
- Current State active milestone;
- completed milestone list;
- milestone section status;
- blocker state;
- next action;
- current phase.

A completed milestone must not remain recorded as active.

A cancelled milestone must not remain recorded as active.

A cancelled milestone must not also be recorded as completed.

A blocked milestone must not be reported as unblocked elsewhere in the same
artifact.

A newly active milestone must agree across the locations that record active
state.

Do not silently correct unrelated stale information.

Report unrelated inconsistencies separately.

### 11. Build and Preview the milestone transition

Construct the complete intended resulting content of:

```text
docs/project/progress.md
```

Preserve all unrelated operational state and history.

Call `documentation_preview` with:

```text
authority: milestone
operation: replace
path: docs/project/progress.md
content: <complete resulting progress.md>
```

Milestone authority permits only replacement of this exact artifact.

After Preview succeeds, present:

```text
Milestone proposal: <proposal-id>
Authority: milestone
```

Then present the exact deterministic unified diff returned in `review.diff`.

Show:

- `review.additions`;
- `review.deletions`;
- the exact unified diff.

Do not reconstruct or modify the returned diff.

The complete before/after snapshots remain authoritative and may be shown when
the user explicitly requests the full proposal.

State clearly that no project artifact has yet been modified.

### 12. Review, revise, and apply

Stop for explicit review.

If the user requests a change:

1. construct the new complete resulting `progress.md`;
2. call `documentation_preview` again with `milestone` authority;
3. present the new proposal and its exact content.

A revision creates a new proposal identifier.

After explicit approval of the exact current proposal, call:

```text
documentation_apply
  proposal_id: <exact-current-proposal-id>
```

The Apply permission request is the final mutation gate.

If permission is denied, leave `progress.md` unchanged and do not retry
automatically.

On successful Apply:

- report the proposal identifier;
- report `docs/project/progress.md — replace`;
- state the resulting milestone transition;
- report warnings when present.

On `STALE_TARGET`, report that operational state changed since review and require
a fresh Preview before any later application.

On `PROPOSAL_ALREADY_APPLIED`, report the existing applied state and do not retry.

For another safe failure, report the structured error and rollback result when
provided.

For `ROLLBACK_FAILED`, report unresolved paths and preserved recovery state,
claim no successful milestone transition, and stop automatic mutation.

## Milestone Output Contract

For a valid transition, use:

````markdown
# Milestone Transition Proposal

## Current State

- Milestone: ...
- Status: ...
- Active milestone: ...
- Blockers: none | ...

## Transition

- Action: start | complete | block | unblock | cancel | ...
- Milestone: ...
- Resulting status: ...

## Validation

- Result: valid
- Relevant findings: ...

## Documentation Transaction

- **Proposal:** <proposal-id>
- **Authority:** milestone
- **Status:** awaiting review

### `docs/project/progress.md`

**Operation:** replace  
**Changes:** +<review.additions> -<review.deletions>

```diff
<exact review.diff returned by documentation_preview>
```

The decision has not yet been durably recorded.

## Consequences

- ...

````

For a transition that cannot yet be proposed, use:

````markdown
# Milestone Transition

## Requested Transition

- ...

## Result

needs clarification | inconsistent | unavailable | scope change

## Reason

- ...

## Required Next Step

- ...
````

Do not include `Documentation Transaction` when no safe durable update exists.

## Decision Procedure

Use this procedure when the user invokes `/decision` or explicitly asks to
record, accept, reject, supersede, partially supersede, or propose a durable
project decision.

The procedure owns transactional durable decision-history changes to:

```text
docs/project/decisions.md
```

Decision changes are previewed through the Documentation Transaction using
`decision` authority and are applied only after explicit review, approval, and
permission-gated Apply.

No other project artifact may be mutated by this procedure.

### 1. Establish the requested decision action

Identify:

- the decision being expressed;
- whether the user is accepting, rejecting, proposing, superseding, or partially
superseding something;
- any rationale explicitly supplied by the user;
- any consequences explicitly supplied by the user;
- any existing decision identifiers referenced by the request.

Interpret the user's wording naturally.

Examples of explicit accepted intent include:

- `use X`;
- `we decided X`;
- `record X`;
- `accept X`.

Examples of rejected intent include:

- `reject X`;
- `do not use X`;
- `we decided against X`.

A question such as:

```text
should we use X?
```

does not by itself establish an accepted decision.

Do not record an unresolved discussion as accepted merely because `/decision`
was invoked.

### 2. Read project instructions

Read the applicable project `AGENTS.md` when present.

Use it to understand:

- workflow boundaries;
- project terminology;
- artifact locations;
- durable decision conventions.

Do not allow project instructions to weaken global permission or source-ownership
boundaries.

### 3. Read the decision register

Read:

```
docs/project/decisions.md
```

Recover:

- existing decision identifiers;
- statuses;
- decision subjects;
- supersession relationships;
- relevant rejected alternatives;
- register frontmatter when present.

Treat the register as append-oriented.

Do not rewrite historical rationale or consequences merely because a later
decision changes direction.

If the register is unavailable, do not invent existing decision history or the
next decision identifier.

### 4. Read scope context when needed

Read `definition.md` when necessary to determine whether the requested decision
would materially change approved project meaning.

Read `progress.md` when necessary to determine whether the requested action is
actually an operational milestone or progress-state change.

Do not read either artifact merely to add unrelated context.

Do not inspect repository implementation unless evidence is required to
understand the decision the user is explicitly recording.

Do not use Git or Bash to build a general implementation impact inventory.

### 5. Validate workflow ownership

Continue with Decision when the requested action records a durable choice within
approved project scope.

Use `/define` when the proposed decision would materially change:

- project objectives;
- non-goals;
- core constraints;
- accepted architecture;
- required capabilities;
- acceptance criteria;
- planned implementation phases.

Use `/milestone` when the requested action primarily changes:

- active milestone;
- milestone completion;
- milestone blocker state;
- current operational progress.

Do not record a decision first and leave the authoritative definition knowingly
contradictory.

### 6. Identify related existing decisions

Determine whether the requested decision:

- is new;
- duplicates an existing effective decision;
- resolves an existing proposed decision;
- rejects an existing proposed decision;
- supersedes an accepted decision;
- partially supersedes an accepted decision;
- conflicts with an existing effective decision without explicitly resolving it.

When the same durable decision is already recorded and effective, do not create
a duplicate entry.

When the request conflicts with an existing effective decision, determine
whether the user explicitly intends to supersede it.

If supersession intent is materially ambiguous, ask for clarification rather
than silently creating conflicting accepted decisions.

### 7. Determine the decision identifier

For a new decision entry:

1. collect all valid `DEC-###` identifiers from the register;
2. ensure identifiers relevant to sequencing are unambiguous;
3. identify the highest recorded numeric identifier;
4. use the next numeric identifier;
5. preserve zero-padded `DEC-###` formatting.

Do not fill earlier gaps or reuse historical identifiers.

For example:

```text
DEC-039
DEC-040
DEC-041
```

produces:

```text
DEC-042
```

If duplicate, malformed, or contradictory identifiers make the next identifier
unsafe to determine, report the inconsistency rather than inventing one.

### 8. Determine the durable status change

Supported durable outcomes include:

- `proposed`;
- `accepted`;
- `rejected`;
- `superseded`;
- `partially superseded`.

**New accepted decision**

Append a new accepted decision.

**New rejected decision**

Append a rejected decision when preserving the rejected alternative has durable
value.

Do not create a decision entry for every discarded conversational idea.

**Proposed decision**

Use `proposed` only when the user explicitly wants an unresolved candidate
preserved in durable history.

Do not treat a proposed decision as effective project policy.

**Resolve an existing proposed decision**

When an existing `proposed` decision is accepted or rejected, update that
decision's status rather than creating a second identifier for the same
decision.

Preserve its original decision text and historical context unless the user is
actually making a materially different decision.

**Supersede**

For a replacement of an effective historical decision:

- preserve the existing decision entry;
- update its status to reference the replacement;
- append the new replacement decision;
- include the supersession relationship in the new entry.

**Partial supersession**

When only part of an earlier decision changes:

- preserve the earlier decision;
- mark it partially superseded by the new decision;
- clearly state which part the new decision replaces;
- leave unaffected parts effective.

### 9. Build evidence-based rationale

Use rationale supported by:

- explicit user statements;
- authoritative project facts;
- evidence established while handling the current decision;
- clearly labelled inference when inference is necessary.

Do not invent:

- preferences;
- frustrations;
- motivations;
- performance claims;
- safety concerns;
- historical reasons

that the user or project artifacts did not establish.

When user motivation is unknown, describe the architectural, workflow, or
operational reason for the recorded choice instead.

### 10. Determine consequences

Record consequences that have durable value.

Prefer consequences that explain:

- what future work must follow this decision;
- what previous behavior is replaced;
- what remains unchanged;
- which workflow or component is affected;
- what future interpretation of the decision register should understand.

Do not turn the Consequences section into a complete implementation plan.

Implementation details that remain undecided should remain undecided.

### 11. Check register consistency

Before presenting the proposal, verify that the resulting decision history would
be internally coherent.

Check when applicable:

- unique decision identifiers;
- status of superseded decisions;
- replacement references;
- partial supersession wording;
- duplicate effective decisions;
- contradictory accepted decisions;
- proposed decisions being treated as non-effective;
- register `updated_at`.

Do not silently repair unrelated historical inconsistencies.

Report them separately when they do not prevent the requested decision.

### 12. Determine the decision result

Classify the request as:

- **valid** - a safe durable decision proposal can be produced;
- **already recorded** - the effective decision already exists;
- **needs clarification** - material decision intent is ambiguous;
- **inconsistent** - existing decision history conflicts enough that a safe
update cannot be determined;
- **unavailable** - required authoritative decision state is unavailable;
- **scope change** - the requested decision belongs to Project Definition;
- **operational change** - the requested action belongs to Milestone.

For `already recorded`, identify the existing effective decision and propose no
artifact change.

For `needs clarification`, ask only the question required to determine durable
decision intent.

For `scope change`, explain why `/define` owns the requested change.

For `operational change`, explain why `/milestone` owns the requested change.

### 13. Build and Preview the decision proposal

For a valid decision action, construct the complete intended resulting content of:

```text
docs/project/decisions.md
```

Preserve all unrelated historical entries exactly in meaning and preserve the
append-oriented decision-history contract.

The resulting content may include when relevant:

- frontmatter `updated_at`;
- status change to an existing decision;
- one appended decision entry.

Call `documentation_preview` with:

```text
authority: decision
operation: replace
path: docs/project/decisions.md
content: <complete resulting decisions.md>
```

After Preview succeeds, present:

```text
Decision proposal: <proposal-id>
Authority: decision
```

Then present the exact deterministic unified diff returned in `review.diff`.

Show:

- `review.additions`;
- `review.deletions`;
- the exact unified diff.

Do not reconstruct or modify the returned diff.

The complete before/after snapshots remain authoritative and may be shown when
the user explicitly requests the full proposal.

Do not paraphrase or reconstruct the tool-returned content.

State clearly that the decision has not yet been durably recorded.

### 14. Review, revise, and apply

Stop for explicit review.

Do not treat presentation as approval.

If the user requests a revision:

1. construct the new complete resulting `decisions.md`;
2. call `documentation_preview` again with `decision` authority;
3. receive a new proposal identifier;
4. present the exact revised Preview.

Do not mutate or later apply the superseded review candidate.

After explicit approval of the exact current proposal, call:

```text
documentation_apply
  proposal_id: <exact-current-proposal-id>
```

The Apply permission request is the final mutation gate.

If permission is denied, leave the decision unapplied and do not retry
automatically.

On successful Apply:

- report the proposal identifier;
- report `docs/project/decisions.md — replace`;
- state that the decision update is now durable;
- report warnings when present.

On `STALE_TARGET`, report that the decision register changed since review and
require a fresh Preview before later application.

On `PROPOSAL_ALREADY_APPLIED`, report that the proposal is already durable and do
not retry.

For another safely handled failure, report the structured failure and rollback
status when available.

For `ROLLBACK_FAILED`, report unresolved paths and recovery-state preservation,
do not claim the decision was durably recorded, and stop automatic mutation.

## Decision Output Contract

For a valid decision proposal, use:

````markdown
# Decision Proposal

## Decision

- **Action:** propose | accept | reject | supersede | partially supersede
- **Identifier:** DEC-...
- **Status:** proposed | accepted | rejected
- **Decision:** ...
- **Date:** ...

## Existing Decision Impact

- none | DEC-... remains unchanged | DEC-... becomes superseded | ...

## Validation

- **Result:** valid
- **Scope:** within approved project scope
- **Relevant findings:** ...

## Documentation Transaction

- **Proposal:** <proposal-id>
- **Authority:** decision

- **Status:** awaiting review

### `docs/project/decisions.md`

**Operation:** replace  
**Changes:** +<review.additions> -<review.deletions>

```diff
<exact review.diff returned by documentation_preview>
```

No project artifacts have been modified.

## Consequences

- ...

## Follow-on Work

- none | ...
````

For a request that does not produce a decision proposal, use:

````margdown
# Decision

## Requested Action

- ...

## Result

already recorded | needs clarification | inconsistent | unavailable |
scope change | operational change

## Reason

- ...

## Required Next Step

- ...
````

Do not include `Documentation Transaction` when no safe transition proposal exists.

## State Completion Condition

The State procedure is complete when:

- available authoritative artifacts have been read;
- relevant Git state has been inspected or reported unavailable;
- missing and conflicting state has been identified;
- no mutation has occurred;
- one clear recommended next action has been returned.

