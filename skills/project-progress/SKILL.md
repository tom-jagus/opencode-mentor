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

The initial implementation provides the read-only **State** and **Resume**
procedures.

Milestone transitions and decision recording remain inactive until constrained
documentation preview and application are implemented.


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
  the State or Resume procedures.
- Do not stage, commit, push, switch branches, fetch, pull, merge, rebase, tag,
  release, or create pull requests.
- Do not invoke documentation or vault write tools.
- Do not call the Bash tool anywhere in the State or Resume procedures.
- Do not claim that a milestone is complete merely because implementation appears
  finished. Completion must be recorded explicitly in `progress.md`.
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

- **consistent** — relevant values agree;
- **missing** — an expected value or artifact is unavailable;
- **inconsistent** — two authoritative locations provide conflicting values;
- **stale** — a value clearly refers to a completed or superseded state.

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

- DEC-... — ...

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

- **consistent** — relevant values agree;
- **missing** — required recovery context is unavailable;
- **inconsistent** — authoritative locations conflict;
- **stale** — recorded context clearly describes superseded or completed work.

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

- **ready** — sufficient durable context exists and no blocker prevents the next
  action;
- **ready with issues** — continuation is possible, but missing, stale, or
  inconsistent context should be noted;
- **blocked** — required context is missing or contradictory enough that
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

- **Next documented action** — exactly what durable project state says should
  happen next.
- **Recommended immediate action** — what should be done now after considering
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

- DEC-... — ...

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

## Inactive Procedures

The following Project Progress procedures are planned but not active in this
skill version:

- milestone transitions;
- decision creation;
- decision rejection;
- decision supersession;
- progress-file updates;
- coordinated project-artifact writes.

Until constrained documentation transactions are implemented:

- `/milestone` must remain proposal-only;
- `/decision` must remain proposal-only;
- no project artifact may be modified through this skill;
- proposed updates must be shown in the conversation for manual review.

## State Completion Condition

The State procedure is complete when:

- available authoritative artifacts have been read;
- relevant Git state has been inspected or reported unavailable;
- missing and conflicting state has been identified;
- no mutation has occurred;
- one clear recommended next action has been returned.

