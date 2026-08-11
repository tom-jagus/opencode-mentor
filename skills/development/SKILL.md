---

name: development
description: Propose, debug, review, and validate source implementation without modifying source files.
compatibility: opencode
metadata:
  workflow: development
---

# Development

## Purpose

Use this skill to implement, debug, review, and validate source changes while
preserving manual source ownership.

Development is proposal-only for source files.

The workflow supports:

- implementation of approved project work;
- debugging existing implementation;
- review of manually entered changes;
- detection of transcription mistakes;
- correction proposals;
- validation planning and interpretation.

Development does not directly modify source files.

## Scope Boundary

Development works inside approved project scope.

Use this skill when the user asks to:

- implement an approved capability;
- change existing source behaviour;
- fix a defect;
- refactor source within approved architecture;
- investigate an implementation problem;
- review source changes the user entered manually;
- diagnose a validation failure;
- correct an implementation or transcription error.

Do not return to Project Definition merely because:

- implementation is difficult;
- multiple technical approaches exist;
- debugging reveals an ordinary defect;
- a proposed implementation needs refinement;
- validation fails;
- the user made a transcription mistake.

Return to Project Definition only when implementation evidence materially
indicates that an approved project assumption is no longer valid.

Examples include:

- the project objective must change;
- a non-goal must become required;
- a core constraint cannot be satisfied;
- an approved architectural assumption is invalid;
- acceptance criteria must change;
- a major capability must enter or leave scope.

When this occurs:

- explain the material conflict;
- stop the affected implementation proposal;
- recommend `/define`;
- do not silently redefine project scope inside Development.

## Source Ownership Boundary

Source files remain under manual user ownership.

Source files include:

- application code;
- tests;
- scripts;
- configuration;
- CI definitions;
- package manifests;
- migrations;
- generated code;
- OpenCode implementation files;
- other files whose primary purpose is executable or operational behaviour.

Development may:

- read source files;
- search and inspect repository content;
- reason about implementation;
- provide source changes in code blocks;
- explain design choices;
- reread files after the user modifies them;
- identify implementation mistakes;
- identify transcription mistakes;
- provide corrected source fragments;
- recommend validation;
- interpret validation results.

Development must not:

- create source files;
- edit source files;
- patch source files;
- delete source files;
- rename or move source files;
- format source files;
- regenerate source files;
- automatically fix source files;
- use another tool or shell command to bypass this boundary.

This applies even to trivial corrections.

If one character is wrong, show the correction and let the user enter it
manually.

## Documentation Boundary

Documentation work does not become part of Development merely because an
implementation requires documentation changes.

Development may identify required documentation work and describe what should be
documented.

Actual documentation creation or modification belongs to the Documentation
workflow.

Until the constrained documentation transaction is active, proposed
documentation changes remain conversational proposals.

## Project Context

Before proposing source changes:

- read the applicable project `AGENTS.md` when present;
- attempt to read `docs/project/definition.md`;
- read enough additional durable project context to understand the active work
  and constraints relevant to the request.

Use `definition.md` to establish:

- the approved objective;
- constraints relevant to the requested work;
- architecture relevant to the requested work;
- acceptance criteria relevant to the requested work.

Read these additional artifacts when relevant:

```text
docs/project/progress.md
docs/project/decisions.md
```

Use them to identify:

- the active milestone or implementation area;
- current implementation status;
- accepted decisions that constrain the implementation.

Read the applicable project `AGENTS.md` when present.

Do not load or summarize every project artifact mechanically.

Read only enough context to establish the implementation boundary and avoid
contradicting accepted decisions.

When required project context is missing or contradictory:

- identify the missing or conflicting information;
- determine whether implementation can still proceed safely;
- do not invent project decisions.

Use `/resume` when broader durable session reconstruction is needed before
Development can proceed.

## General Rules

- Solve the actual implementation problem rather than mechanically changing the
  first file that appears relevant.
- Challenge unnecessary complexity and weak implementation assumptions.
- Prefer maintainable and understandable solutions over cleverness.
- Work in one coherent implementation unit at a time.
- Keep unrelated changes outside the current implementation unit.
- Distinguish observed source behaviour from assumptions about source behaviour.
- Read relevant implementation before proposing modifications.
- Do not propose broad rewrites when a smaller coherent change solves the
  problem.
- Preserve established project conventions unless there is a concrete reason to
  change them.
- Explain important design choices and trade-offs.
- Do not reopen approved scope without material evidence.
- Do not modify project artifacts during Development.
- Do not perform Git lifecycle mutations such as stage, commit, push, merge,
  rebase, tag, release, or pull-request creation.
- Do not use source mutation as a shortcut during debugging or validation.
- Keep the main conversation responsible for implementation decisions and
  integration.

## Tool Use

### Direct inspection

Use normal read-only tools directly for straightforward investigation.

Typical uses include:

- reading known files;
- locating relevant symbols;
- searching for references;
- comparing related implementation;
- inspecting configuration;
- checking existing tests.

### `explore`

Use `explore` only for bounded read-only repository investigation when
delegation materially improves the work.

Good uses include:

- locating an unfamiliar implementation path;
- tracing references across several modules;
- independently mapping a subsystem;
- identifying existing patterns that should be reused.

Give `explore` a specific investigation question.

Do not delegate the implementation decision itself.

`lead` remains responsible for:

- interpreting the findings;
- selecting the implementation;
- presenting the proposal;
- reviewing the user's implementation.

### `git_state`

Use `git_state` when repository state materially affects Development.

Examples include:

- distinguishing pre-existing working-tree changes from the current work;
- confirming whether the repository is already dirty before review;
- identifying changed paths after the user reports applying a proposal.

Do not call `git_state` routinely when repository state is irrelevant.

Do not use Bash for Git status information that `git_state` already provides.

### Bash

Bash is permission-gated.

Use Bash only when inspection or validation materially benefits from executing a
command.

Before executing a command, determine whether it may modify source files.

Safe candidates may include:

- test commands known not to rewrite source;
- type checking;
- linting in check-only mode;
- compilation or build verification that does not rewrite tracked source;
- read-only diagnostic commands.

Do not execute commands that may modify source, including:

- formatters in write mode;
- automatic fix commands;
- code generators;
- migrations that rewrite repository files;
- snapshot update commands;
- dependency installers that modify manifests or lockfiles;
- scripts whose write behaviour is unknown;
- package commands that implicitly rewrite source or configuration.

When a command's mutation behaviour is uncertain:

- do not execute it;
- explain the uncertainty;
- recommend the command for manual execution when appropriate.

Generated runtime, cache, or build artifacts are not permission to allow tracked
source mutation.

If validation unexpectedly modifies tracked source:

- stop;
- report what happened;
- do not attempt to repair or revert the files automatically;
- let the user decide how to restore or keep the changes.

## Development Procedure

Use this procedure when the user invokes `/develop` or explicitly requests
implementation, debugging, or review of source changes.

### 1. Establish the development request

Identify the concrete implementation problem from:

- the `/develop` request;
- the user's current wording;
- relevant durable project state.

Determine:

- what behaviour should change;
- what behaviour should remain unchanged;
- the expected outcome;
- known constraints;
- relevant acceptance criteria.

When the request is sufficiently concrete, proceed without unnecessary
clarification.

When an important implementation detail is genuinely unavailable, inspect the
repository or approved project context before asking the user.

Do not convert an implementation request into broad brainstorming unless the
user requests it.

### 2. Verify the scope boundary

Check the requested change against approved project context.

Classify it as one of:

- **within scope** — consistent with approved objectives and architecture;
- **implementation ambiguity** — scope is valid but technical details must be
  resolved;
- **potential scope conflict** — implementation evidence may contradict an
  approved project decision.

For implementation ambiguity, continue Development and resolve the technical
question.

For a potential scope conflict:

- inspect enough evidence to determine whether the conflict is material;
- explain the conflict if confirmed;
- recommend `/define`;
- stop only the portion of work that depends on the unresolved scope change.

### 3. Inspect the existing implementation

Read the source needed to understand the requested change.

Identify:

- current behaviour;
- relevant entry points;
- dependencies;
- existing abstractions;
- nearby patterns;
- tests or validation relevant to the behaviour;
- constraints imposed by existing code.

Inspect narrowly first.

Expand investigation only when evidence shows that more context is necessary.

Do not read the entire repository merely because Development has started.

### 4. Use bounded exploration when useful

When the implementation crosses an unfamiliar or distributed area, delegate a
specific read-only question to `explore`.

Examples:

```text
Locate where configuration precedence is resolved and identify the functions
that participate in the merge.
```

```text
Find existing tests for custom tool permissions and summarize the patterns used
to construct hostile workspaces.
```

Integrate the returned findings into the main reasoning.

Do not copy subagent conclusions blindly.

Verify material claims against source when needed.

### 5. Define one coherent implementation unit

Before proposing source changes, define the smallest coherent unit that produces
a meaningful result.

A coherent unit should:

- have one clear purpose;
- fit approved scope;
- avoid unrelated cleanup;
- be reviewable as one change;
- have an identifiable validation strategy.

Examples:

- add one command contract;
- implement one parser behaviour;
- fix one permission boundary;
- add one deterministic tool capability;
- correct one defect and its tests.

Avoid combining unrelated improvements merely because the same files are open.

When the requested work is too large for one coherent unit:

- identify the natural implementation units;
- recommend an order;
- propose only the first unit unless the user explicitly asks for the complete
  multi-unit design.

### 6. Design the implementation

Reason through the proposed change before presenting code.

Consider when relevant:

- existing project architecture;
- established repository patterns;
- error handling;
- boundary conditions;
- backward compatibility;
- security implications;
- deterministic behaviour;
- maintainability;
- testability;
- operational side effects.

Prefer reuse of existing project capabilities over introducing new abstractions.

When multiple approaches are materially different:

- compare the meaningful alternatives;
- recommend one;
- explain why it fits the project better.

Do not present unnecessary alternatives when one implementation is clearly
appropriate.

### 7. Prepare the source proposal

Present the implementation as manual source changes.

For every affected source file:

- name the file;
- identify whether the change adds, replaces, or removes content;
- provide enough surrounding context to place the change correctly;
- use complete code blocks for new functions, sections, or small files when
  practical;
- use focused replacement fragments for large files;
- explain important interactions between files.

Do not present pseudo-code when the user needs directly transcribable source.

Do not hide required source changes behind vague instructions such as:

```text
Update the validation logic accordingly.
```

Show the actual proposed implementation.

For deletions, identify the exact block that should be removed.

For renames or moves, describe the operation and any required reference changes;
the user performs them manually.

### 8. Explain the proposal

After the code proposal, explain only the design choices that materially affect
understanding or future maintenance.

Include when relevant:

- why the chosen approach fits existing architecture;
- why an alternative was rejected;
- important safety properties;
- compatibility consequences;
- expected behavioural change.

Do not repeat the code line by line.

### 9. Stop for manual application

After presenting a source proposal, stop the implementation stage.

The user manually enters the proposed source changes.

Do not:

- apply the proposal;
- patch files;
- run an automatic fixer;
- assume the proposal has been entered;
- continue into implementation review before the user indicates that the change
  has been applied.

The next Development turn continues from review.

### 10. Reread the implemented change

After the user reports that the proposal has been entered, reread the affected
source files.

Compare the resulting implementation against:

- the intended behaviour;
- the proposed change;
- surrounding source;
- relevant project constraints.

Do not rely on memory of what the user was expected to type.

Inspect the actual resulting source.

When repository state is relevant, use `git_state` to identify changed paths, but
do not inspect unrelated changed paths merely because they appear in Git state.

### 11. Review implementation correctness

Classify findings as:

- **correct** — implementation matches the intended design;
- **transcription issue** — the intended proposal was entered incorrectly;
- **implementation issue** — the entered code follows the proposal but the design
  needs correction;
- **unrelated change** — the source contains changes outside the current
  implementation unit;
- **cannot verify** — required context is unavailable.

Check when relevant:

- syntax;
- control flow;
- types;
- names;
- imports;
- error handling;
- edge cases;
- configuration semantics;
- interactions with existing code;
- tests;
- accidental unrelated changes.

Do not directly correct any issue.

### 12. Propose corrections when needed

For every correction:

- explain the defect;
- identify its impact;
- provide the exact corrected fragment;
- identify where it belongs.

Keep corrections scoped to the current implementation unit.

When the original design itself was wrong, say so explicitly rather than calling
it a transcription error.

After proposing corrections, stop again for manual application.

Repeat reread and review until the implementation is correct enough to validate.

### 13. Determine validation

Once the implementation review is satisfactory, identify the smallest useful
validation set.

Prefer repository-defined validation when available.

Validation may include:

- syntax checks;
- focused unit tests;
- integration tests;
- type checks;
- lint checks;
- build verification;
- existing project guardrail suites;
- targeted runtime checks.

Order validation from focused to broader when practical.

Avoid running an expensive full suite when a focused check should happen first,
unless project policy explicitly requires the full suite.

Distinguish:

- validation that OpenCode can safely execute;
- validation the user should execute manually because mutation behaviour is
  uncertain or prohibited.

### 14. Execute approved non-mutating validation when appropriate

When a validation command is known to respect the source-ownership boundary and
the user permits execution, run it through the permission-gated Bash capability.

Report:

- command executed;
- success or failure;
- material output;
- what the result proves;
- what it does not prove.

Do not treat command success as proof beyond the scope of that validation.

### 15. Handle validation failures

When validation fails:

1. inspect the failure;
2. determine whether it is caused by the current implementation;
3. inspect relevant source;
4. explain the root cause;
5. propose a correction in code blocks;
6. stop for manual application;
7. reread the result;
8. recommend or rerun appropriate validation.

Do not automatically fix failures.

Remain in Development unless the failure reveals a material scope conflict.

### 16. Conclude the implementation unit

The implementation unit is ready to leave Development when:

- the intended source changes have been entered manually;
- the resulting source has been reread;
- no known implementation or transcription issue remains;
- appropriate validation has passed or remaining validation limitations are
  explicit;
- no unresolved scope conflict blocks the work.

Development does not stage, commit, or push the completed unit.

Git lifecycle actions belong to the Git workflow.

## Development Proposal Output Contract

For a normal implementation proposal, use this structure:

````markdown
# Development Proposal

## Goal

...

## Current Behaviour

...

## Proposed Implementation

### `path/to/file`

Change: add | replace | remove | rename

```language
...
```

## Design Notes

- ...

## Validation

- ...

````

Keep `Current Behaviour` concise when the requested change is already obvious.

Include only affected files.

Do not add an empty `Design Notes` section.

When validation should wait until after manual implementation, state that
clearly.

## Development Review Output Contract

After the user enters the proposed changes, use:

````markdown
# Implementation Review

## Result

correct | corrections required | cannot fully verify

## Findings

- ...

## Corrections

### `path/to/file`

```language
...
```

## Validation

- ...

````

Omit `Corrections` when none are required.

For a correct implementation, keep the report concise and move directly to
validation.

## Debugging Output Contract

When Development begins from a defect or failed validation rather than a new
implementation request, use:

````markdown
# Development Diagnosis

## Problem

...

## Root Cause

...

## Proposed Correction

### `path/to/file`

```language
...
```

## Validation

- ...

````

Distinguish confirmed root cause from hypotheses.

When the root cause is not yet confirmed, state what evidence is missing rather
than presenting a guess as fact.

## Required Behaviour for Common Conditions

### User already changed the source before invoking `/develop`

Inspect the resulting implementation directly.

Do not require the original proposal stage merely to satisfy procedure order.

Treat the current source as the implementation to review.

### User asks for a trivial source fix

Preserve the manual source-ownership boundary.

Show the exact correction.

Do not apply it automatically.

### User requests several unrelated changes

Separate them into coherent implementation units.

Recommend an order and begin with one unit unless the user explicitly requests a
combined design.

### Existing working tree is dirty

Do not assume all changes belong to the current Development work.

Use `git_state` when repository state matters.

Do not inspect unrelated changed paths unless required by the user's request or
the current implementation.

### Relevant source conflicts with approved documentation

Determine whether the source is simply behind the approved design or whether the
approved design itself appears invalid.

If implementation should conform to existing approved scope, continue
Development.

If evidence materially invalidates approved scope, recommend `/define`.

### Documentation must change with the implementation

Identify the documentation requirement.

Do not modify documentation from Development.

Route actual documentation work to `/docs` when that workflow is available.

### Validation command may rewrite source

Do not execute it.

Recommend a safe check-only form when one exists.

Otherwise give the command to the user with a clear warning about its mutation
behaviour.

### Validation creates build or cache output

This is acceptable only when the command is known not to rewrite tracked source
or configuration.

If uncertain, do not execute it.

### Generated source is part of the required change

Do not run the generator.

Explain the required generation step and let the user perform it manually.

Afterward, reread the generated result when review is useful.

### Implementation reveals a material project conflict

Stop the affected implementation work.

Explain:

- the evidence;
- the approved assumption it conflicts with;
- why the conflict is material;
- why `/define` is required.

Do not redefine the project inside Development.

## Completion Condition

The Development procedure is complete for one implementation unit when:

- the requested behaviour and approved scope are understood;
- relevant existing source has been inspected;
- one coherent implementation unit has been proposed;
- all source changes have been entered manually by the user;
- the resulting implementation has been reread;
- known transcription and implementation defects have been resolved through
  manual correction;
- appropriate validation has passed or its limitations are explicitly recorded;
- no unresolved material scope conflict remains;
- no source mutation has been performed by OpenCode.
