---
name: project-definition
description: Define approved project scope and coordinate proposal-only changes to authoritative project artifacts.
compatibility: opencode
metadata:
  workflow: project-definition
---

# Project Definition

## Purpose

Use this skill to establish or materially revise durable project scope.

Project Definition answers questions such as:

- what problem the project exists to solve;
- what outcomes are required;
- what is explicitly outside scope;
- which constraints must be respected;
- which architectural approach is approved;
- which assumptions materially affect the project;
- how success will be evaluated;
- which implementation phases are expected.

The workflow covers:

- initial project definition;
- continued definition before initial approval;
- material re-entry during Development;
- coordinated definition, progress, and decision proposals.

During the current Project Workflows milestone, Project Definition is
proposal-only.

It does not modify project artifacts.

## Authoritative Project Artifacts

The workflow coordinates these artifacts:

```text
docs/project/definition.md
docs/project/progress.md
docs/project/decisions.md
```

### `definition.md`

Authoritative for:

- problem statement;
- objectives;
- intended outcomes;
- non-goals;
- constraints;
- approved architecture or approach;
- acceptance criteria;
- planned implementation phases.

It does not own current operational progress.

### `progress.md`

Authoritative for:

- current phase;
- active milestone;
- completed milestones;
- blockers;
- open implementation questions;
- next documented action.

Project Definition may propose progress changes when definition work establishes
or materially changes the project's operational starting point.

Ordinary milestone transitions belong to `/milestone`.

### `decisions.md`

Authoritative append-oriented history for durable decisions.

Project Definition may propose decision entries when accepted, rejected, or
superseded choices are part of defining project scope or architecture.

Ordinary standalone decision recording belongs to `/decision`.

Never erase historical decisions merely because later definition work supersedes
them.

## Definition Modes

Project Definition operates in one of two modes.

### Initial Definition

Use Initial Definition when:

- `definition.md` does not exist;
- project artifacts have not yet been established;
- the existing definition is explicitly incomplete or unapproved;
- the user is continuing an unfinished initial definition process.

Initial Definition establishes the first coherent project scope and coordinated
project artifacts.

### Material Re-entry

Use Material Re-entry when an approved definition already exists and new evidence
may require changing approved scope.

Re-enter Project Definition when:

- the objective changes;
- a non-goal becomes required;
- a core constraint changes;
- an architectural assumption becomes invalid;
- acceptance criteria change;
- a major capability enters or leaves scope;
- implementation evidence materially invalidates the approved approach.

Do not re-enter Project Definition merely because:

- implementation is difficult;
- several technical implementations are possible;
- an ordinary defect exists;
- validation fails;
- the working tree is dirty;
- a milestone advances;
- a standalone implementation decision must be recorded;
- documentation wording needs editorial cleanup.

Those remain in their owning workflows.

## Definition Change Classification

For an existing approved definition, classify the outcome as:

- **material**
- **editorial**
- **no-change**

### Material

A change is material when it changes approved project meaning.

Examples:

- objective changes;
- non-goal changes;
- required capability changes;
- core constraint changes;
- approved architecture changes materially;
- acceptance criteria change;
- implementation phase structure changes in a way that changes approved scope.

A material definition proposal increments the proposed definition version by
exactly one.

The currently recorded version remains authoritative until the proposal is
approved and applied.

### Editorial

A change is editorial when meaning remains unchanged.

Examples:

- clearer wording;
- grammar correction;
- restructuring for readability;
- removing duplication;
- clarifying terminology without changing intent.

Editorial changes do not increment the definition version.

Do not create unrelated progress or decision changes merely because an editorial
definition change exists.

### No-change

Use `no-change` when analysis confirms that the approved definition remains
correct.

No-change is a valid outcome.

Do not manufacture documentation changes simply to produce visible work.

## General Rules

- Read existing authoritative project artifacts before redefining approved scope.
- Read the applicable project `AGENTS.md` when present.
- Prefer recorded project facts over conversation memory.
- Treat prior conversation history as useful but non-authoritative context.
- Distinguish facts, assumptions, inferences, proposals, and accepted choices.
- Challenge unclear reasoning and unnecessary complexity.
- Separate desired outcomes from proposed implementation.
- Preserve approved decisions unless new evidence justifies reconsideration.
- Do not reopen settled scope without material evidence.
- Do not convert ordinary implementation ambiguity into a definition problem.
- Do not invent missing project requirements.
- Do not silently resolve contradictions between authoritative artifacts.
- When changing one ownership, permission, or workflow boundary, preserve
  adjacent boundaries unless the requested material change explicitly affects
  them.
- When a material change adds a capability, preserve compatible existing
  capabilities unless the request explicitly removes or replaces them.
- Do not infer that a newly approved workflow path becomes mandatory merely
  because it becomes the preferred or default path.
- Do not weaken or broaden another artifact category's mutation authority merely
  to contrast it with the category being changed.
- Do not modify project artifacts.
- Do not use Bash.
- Do not stage, commit, push, merge, rebase, tag, release, or create pull
  requests.
- Do not invoke documentation or vault mutation tools.
- Keep coordinated artifact changes internally consistent.
- Minimize changes to only the artifacts affected by the definition outcome.

## Investigation

Investigation must be proportional to the definition question.

Inspect implementation only when needed to:

- determine whether approved scope is actually affected;
- validate or invalidate an architectural assumption;
- establish a material constraint;
- understand consequences that materially affect the definition decision.

Stop investigation once enough evidence exists to classify the definition
outcome and frame the material choices.

Do not perform a complete implementation impact analysis during Project
Definition. Detailed implementation tracing belongs to Development.

### Direct inspection

Use approved read-only tools to inspect:

- project instructions;
- existing project artifacts;
- source relevant to a claimed architectural constraint;
- existing configuration relevant to approved scope;
- repository structure when it materially informs the definition.

Do not inspect implementation merely to find something to challenge.

### `explore`

Use `explore` only for bounded read-only repository investigation when existing
implementation evidence materially affects the definition.

Give `explore` the smallest question needed to resolve the definition issue.

Do not ask `explore` to map every file, test, permission, or implementation
dependency merely because a material definition change may later require
Development work.

Examples:

```text
Determine whether the currently approved architecture assumes a capability that
the existing platform cannot provide.
```

```text
Locate the implementation boundary affected by the proposed removal of the
current storage constraint.
```

Do not delegate definition decisions to `explore`.

`lead` remains responsible for:

- interpreting evidence;
- challenging assumptions;
- comparing alternatives;
- deciding what must be presented to the user;
- preparing the coordinated proposal.

### External research

Use external research only when it materially improves definition quality or the
user requests it.

Distinguish external evidence from recorded project facts.

Do not silently redefine the project because an external source recommends a
different architecture.

## Project Definition Procedure

Use this procedure when the user invokes `/define` or explicitly asks to create
or materially revise project scope.

### 1. Establish the definition request

Identify what the user is trying to define or reconsider.

Use:

- command arguments;
- the user's current wording;
- existing project artifacts;
- relevant project instructions.

Determine whether the request concerns:

- a new project;
- an unfinished initial definition;
- a possible material redefinition;
- an editorial clarification;
- something that belongs to another workflow.

Do not assume that invoking `/define` guarantees a material change.

### 2. Read applicable project instructions

Read the applicable project `AGENTS.md` when present.

Recover relevant:

- operating constraints;
- terminology;
- source-ownership rules;
- project artifact locations;
- workflow boundaries.

Project instructions may constrain Project Definition but must not weaken global
guardrails.

### 3. Inspect existing project artifacts

Attempt to read:

```text
docs/project/definition.md
docs/project/progress.md
docs/project/decisions.md
```

Determine for each artifact:

- whether it exists;
- whether frontmatter exists;
- relevant status and version information;
- whether it appears internally usable;
- whether it conflicts materially with another authoritative artifact.

Do not reconstruct a missing artifact from assumptions.

### 4. Select the definition mode

Select:

- **Initial Definition**, or
- **Material Re-entry**.

Use Initial Definition when approved scope has not yet been established.

Use Material Re-entry when an approved definition exists.

If an approved definition exists but the requested change is clearly editorial,
continue far enough to classify it correctly rather than forcing a material
redefinition.

State the selected mode internally and follow the corresponding rules.

### 5. Establish the problem and desired outcomes

Identify:

- the actual problem being solved;
- who or what is affected;
- the required outcomes;
- why the project is needed;
- how the desired future state differs from the current state.

Challenge solution-first framing.

When the user starts with an implementation idea, separate:

```text
desired outcome
from
proposed implementation
```

Do not reject an implementation idea merely because it was proposed early.

Treat it as one candidate approach until the underlying outcome is understood.

### 6. Identify objectives and non-goals

Determine the smallest useful set of explicit objectives.

Each objective should describe a required project outcome or capability.

Identify important non-goals where ambiguity could otherwise expand scope.

Challenge objectives that are:

- implementation details disguised as outcomes;
- redundant;
- unverifiable;
- contradictory;
- broader than the stated problem requires.

Do not create non-goals merely to make the document look complete.

### 7. Identify constraints and assumptions

Identify constraints that materially affect the solution.

Examples include:

- security boundaries;
- source-ownership requirements;
- platform limitations;
- compatibility requirements;
- workflow constraints;
- operational constraints;
- external system dependencies.

Separate constraints from assumptions.

A constraint is treated as required.

An assumption is believed to be true but may require validation.

For important assumptions, determine:

- why the assumption matters;
- what happens if it is false;
- whether it should be validated before implementation.

### 8. Evaluate architecture and implementation approach

When architecture is part of the definition, identify the smallest level of
architectural commitment needed to guide Development.

When a proposed architecture adds a new mechanism, determine whether it replaces
an existing mechanism or coexists with it.

Preserve an existing compatible mechanism unless replacement is required by the
requested outcome or explicitly chosen by the user.

Do not over-specify implementation details that can safely remain local
Development decisions.

Define architectural guarantees in terms of required behaviour and boundaries,
not the specific mechanism used to enforce them.

When a guarantee may be implemented in several valid ways, record what must be
true and leave details such as identifiers, checksums, hashes, session binding,
storage formats, or exact validation algorithms to the relevant implementation
workflow.

Only promote a mechanism into the project definition when that mechanism itself
is an approved architectural constraint.

When materially different approaches exist:

1. identify the meaningful alternatives;
2. compare their consequences;
3. challenge unnecessary complexity;
4. recommend one;
5. record accepted and rejected choices when they have durable value.

Architecture belongs in the definition when changing it later would materially
alter project scope, constraints, or acceptance criteria.

Ordinary implementation choices remain in Development.

### 9. Identify omissions, risks, and contradictions

Look for missing requirements or conflicts that could make the definition
unsafe, ambiguous, or misleading.

Consider when relevant:

- security;
- permissions;
- data ownership;
- failure handling;
- compatibility;
- migration;
- lifecycle;
- maintainability;
- validation;
- deployment;
- external dependencies;
- operational recovery.

Do not turn every implementation detail into a definition requirement.

Prioritize issues that materially affect approved scope.

### 10. Define acceptance criteria

Create acceptance criteria that make completion meaningfully verifiable.

Acceptance criteria should describe observable project-level outcomes or
properties.

Avoid criteria that merely restate implementation steps.

Good criteria answer:

> What must be demonstrably true for this project or capability to be considered
> successful?

Acceptance criteria may include:

- required behavior;
- prohibited behavior;
- compatibility guarantees;
- security properties;
- required validation;
- operational properties.

### 11. Define implementation phases

When useful, divide approved work into coherent implementation phases.

Phases should:

- have a clear purpose;
- respect dependencies;
- avoid premature detail;
- provide a useful order for Development.

Do not confuse implementation phases in `definition.md` with the current
operational phase or active milestone in `progress.md`.

### 12. Track definition decisions

Identify choices made during Project Definition that deserve durable history.

Classify each as appropriate:

- accepted;
- rejected;
- superseding an earlier decision.

For a proposed decision entry, identify:

- decision identifier when one can be determined safely;
- status;
- decision;
- rationale;
- consequence;
- superseded decision when applicable.

Base durable decision rationale on:

- explicit user statements;
- recorded project facts;
- evidence established during the current definition work;
- clearly labelled inference when inference is necessary.

Do not convert an inferred benefit, preference, motivation, or problem into a
recorded user rationale.

When the user's motivation has not been established, describe the architectural
or workflow consequence of the requested choice instead.

Do not rewrite or delete historical decisions.

When the next decision identifier cannot be determined safely, use a visible
placeholder rather than inventing an ID.

### 13. Assess definition sufficiency

Before preparing the artifact proposal, determine whether enough information
exists to approve the project scope.

Classify definition readiness as:

- **ready for approval**
- **needs clarification**
- **blocked**

Use `ready for approval` when the project has enough durable definition to enter
or continue Development safely.

Use `needs clarification` when one or more important questions remain but can be
resolved conversationally.

Use `blocked` when required information depends on unavailable evidence,
authority, or an unresolved contradiction.

Do not require every implementation question to be answered before declaring the
definition ready.

Implementation-level unknowns belong in `progress.md` as open implementation
questions when appropriate.

### 14. Ask only material clarification questions

When clarification is required:

- ask about the highest-impact unresolved issue first;
- explain why the answer affects project definition;
- avoid long generic questionnaires;
- avoid asking for information already available in project artifacts;
- use reasonable inference only for non-material details and label it clearly.

When presenting materially different choices:

- describe the meaningful consequence or trade-off of each option;
- make a recommendation when the evidence supports one;
- explain the reason for the recommendation;
- do not present a recommended option as though it were already approved.

Continue the definition conversation until the project becomes ready, blocked,
or the user chooses to stop.

### 15. Classify the definition outcome

For Initial Definition, classify the result as:

- **initial proposal**
- **needs clarification**
- **blocked**

For Material Re-entry, classify the proposed definition change as:

- **material**
- **editorial**
- **no-change**
- **needs clarification**
- **blocked**

For a material change:

- determine the current definition version;
- propose exactly the next version;
- identify why the change is material.

For editorial and no-change outcomes:

- do not increment the definition version.

When the outcome is conclusively `no-change` because the request belongs to
another workflow:

- stop definition investigation once enough evidence exists to establish that
  classification;
- explain briefly why approved project meaning remains unchanged;
- identify the owning workflow;
- do not perform implementation impact analysis for that workflow;
- do not continue to artifact proposal or approval steps;
- conclude the Project Definition procedure directly.

A `no-change` outcome requires no definition approval or artifact application.

### 16. Determine affected artifacts

Determine which authoritative artifacts need changes.

#### Initial Definition

Normally propose:

```text
docs/project/definition.md
docs/project/progress.md
docs/project/decisions.md
```

Omit an artifact only when there is a concrete reason it is not required.

#### Material Re-entry

Change only affected artifacts.

Examples:

- objective change → `definition.md`, usually `decisions.md`, and possibly
  `progress.md`;
- architectural decision change → `definition.md` and `decisions.md`;
- acceptance criteria clarification with unchanged meaning → possibly only
  `definition.md`;
- no-change → no artifacts.

Do not update `progress.md` merely to mirror every definition edit.

Do not add a decision entry for trivial editorial changes.

### 17. Check coordinated consistency

Before presenting the proposal, verify that affected artifacts agree on:

- project identity;
- definition status;
- definition version;
- current operational phase;
- active milestone;
- relevant decisions;
- implementation phase terminology;
- next documented action.

Respect artifact ownership.

For example:

- `definition.md` owns approved scope;
- `progress.md` owns active milestone;
- `decisions.md` owns decision history.

Do not duplicate operational state into `definition.md`.

Do not silently repair unrelated stale information.

Report unrelated inconsistencies separately.

### 18. Prepare the coordinated artifact proposal

When artifact changes are required, produce one coordinated proposal.

For a new artifact, provide complete proposed file content.

For an existing artifact, provide:

- the artifact path;
- change classification;
- exact affected section or frontmatter;
- proposed replacement or insertion;
- why the change is required.

When several artifacts must change together, present them as one change set.

Do not present one artifact as independently complete when the proposed
definition depends on coordinated changes to another artifact.

The proposal must remain reviewable and manually applicable.

### 19. Present consequences and unresolved issues

Summarize:

- what project meaning changes;
- what remains unchanged;
- important accepted choices;
- important rejected alternatives;
- unresolved implementation questions;
- risks introduced or removed;
- whether Development can proceed after approval.

Do not repeat the full artifact proposal.

### 20. Stop for review and approval

After presenting the coordinated proposal, stop.

Allow the user to:

- accept it;
- reject it;
- revise part of it;
- answer unresolved questions;
- request another alternative.

Do not treat presentation of the proposal as approval.

Do not modify project artifacts.

### 21. Handle approval during the proposal-only phase

During the current Project Workflows milestone, explicit user approval does not
authorize automatic artifact mutation.

When the user approves the proposal:

- state that the coordinated proposal is approved conceptually;
- provide any final exact artifact changes needed for manual application;
- let the user apply them manually;
- do not claim that durable project state changed until the files are actually
  updated and reread.

Once Documentation Transaction is implemented, this step will hand the approved
change set to its constrained preview and atomic apply mechanism.

## Initial Definition Output Contract

When enough information exists to propose initial project artifacts, use:

````markdown
# Project Definition Proposal

## Readiness

ready for approval | needs clarification | blocked

## Project

- **Problem:** ...
- **Objectives:** ...
- **Non-goals:** ...
- **Constraints:** ...
- **Proposed approach:** ...
- **Acceptance criteria:** ...

## Key Decisions

- accepted: ...
- rejected: ...

## Open Questions

- none | ...

## Proposed Artifact Changes

### `docs/project/definition.md`

Change: create

```markdown
...
```

### `docs/project/progress.md`

Change: create

```markdown
...
```

### `docs/project/decisions.md`

Change: create

```markdown
...
```

## Consequences

- ...

````

Omit empty optional sections.

Do not claim the project is approved until the user explicitly approves the
proposal.

## Redefinition Output Contract

For an existing approved definition, use:

````markdown
# Project Redefinition Proposal

## Classification

material | editorial | no-change | needs clarification | blocked

## Reason

...

## Scope Impact

### Changes

- ...

### Unchanged

- ...

## Proposed Artifact Changes

### `docs/project/definition.md`

Change: replace | insert | none

```markdown
...
```

### `docs/project/progress.md`

Change: replace | insert | none

```markdown
...
```

### `docs/project/decisions.md`

Change: append | none

```markdown
...
```

## Consequences

- ...

## Open Questions

- none | ...

````

For `no-change`, omit `Proposed Artifact Changes`.

For an editorial change, explicitly state that the definition version does not
change.

For a material change, state both:

- current definition version;
- proposed definition version.

## Required Behaviour for Common Conditions

### No project artifacts exist

Use Initial Definition.

Do not treat missing project files as an error when the user is defining a new
project.

### `definition.md` exists but is not approved

Continue Initial Definition.

Do not increment the definition version merely because the user resumes an
unfinished definition process.

### Approved definition exists and the requested change is implementation-only

Return a `no-change` definition outcome.

Explain why the request belongs in Development.

Do not alter project artifacts.

Once this classification is established, do not inspect the implementation
further except when additional evidence is required to confirm that approved
scope is genuinely unaffected.

### Approved definition exists and wording needs cleanup only

Classify the change as `editorial`.

Do not increment the definition version.

Do not create a decision entry unless the clarification itself records a durable
choice.

### Material objective change

Classify as `material`.

Increment the proposed definition version by one.

Identify related decision and progress consequences.

### Non-goal becomes required

Treat this as material scope expansion.

Identify the affected objectives, architecture, acceptance criteria, phases, and
decisions.

### Architecture assumption is invalidated during Development

Inspect enough evidence to confirm the conflict.

Do not redefine architecture merely because the current implementation is
awkward.

When the approved assumption is materially invalid:

- classify as material;
- explain the evidence;
- propose the smallest coherent scope correction.

### Existing artifacts contradict one another

Report the contradiction and artifact ownership.

Do not silently choose one value.

Continue only when the contradiction can be resolved safely through the current
definition proposal.

Otherwise classify the workflow as `blocked`.

### User rejects the proposed definition

Preserve the existing approved definition.

Continue conversational revision when useful.

Do not update project state.

### User approves the proposal but has not applied it

Treat the proposal as approved conversationally but not durably applied.

Do not use the proposed values as authoritative project state in later
procedures until the artifacts have been updated and reread.

### Only some coordinated changes are applied manually

Report the authoritative artifacts as inconsistent.

Do not pretend the proposal was applied atomically.

Recommend completing or correcting the coordinated manual change before normal
Development continues.

## Completion Condition

The Project Definition procedure is complete when one of these conditions is
true:

### Initial Definition

- the project is sufficiently defined;
- objectives, non-goals, constraints, approach, and acceptance criteria are
  coherent;
- important accepted and rejected choices are identified;
- implementation-level unknowns are separated from definition blockers;
- coordinated initial artifact content has been proposed;
- the user has been given a reviewable change set;
- no artifact mutation has occurred.

### Material Re-entry

- the requested issue has been classified correctly;
- affected approved scope has been identified;
- material, editorial, and no-change outcomes are distinguished;
- definition version behavior is correct;
- only affected artifacts are included;
- relevant historical decisions are preserved;
- coordinated artifact changes are internally consistent;
- the user has been given a reviewable proposal;
- no artifact mutation has occurred.
