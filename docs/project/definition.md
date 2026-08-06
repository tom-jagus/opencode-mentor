---
title: OpenCode Mentor Project Definition
status: approved
version: 3
approved_at: 2026-08-04
---

# Project Definition

## 1. Purpose

Build a personal OpenCode configuration and operating workflow that provides a
local LLM experience aligned with Tom's preferred way of working:

- challenge ideas instead of praising them by default;
- define projects thoroughly before implementation;
- preserve project context in durable Markdown artifacts;
- propose source-code changes without writing source files;
- allow controlled creation and modification of documentation;
- enforce repeatable Git, GitHub, project-progress, vault, and research workflows;
- keep the configuration maintainable, auditable, reusable, and version-controlled.

The configuration will expose one consistent user-facing primary agent while
using skills, subagents, commands, tools, policies, and project artifacts for
specialised behaviour and controlled execution.

## 2. Problem Statement

A default OpenCode setup does not encode Tom's preferred working method or
provide sufficiently strong guarantees around source-code ownership,
documentation changes, Git consistency, project continuity, and vault updates.

Without a deliberate configuration:

- the LLM may praise weak ideas rather than challenge them;
- project decisions may remain trapped in conversation history;
- source files may be modified without deliberate manual transcription;
- shell commands may bypass source-edit restrictions;
- Git branches, commits, merges, versions, and releases may be inconsistent;
- documentation and vault changes may lack reviewable previews;
- new sessions may lose project context;
- project and vault knowledge may drift or be duplicated;
- agent switching may create avoidable user errors.

## 3. Objectives

### 3.1 Primary objectives

1. Provide one user-facing primary agent named `lead`.
2. Make `lead` workflow-neutral rather than specialised for brainstorming.
3. Encode stable personal behaviour in a global `AGENTS.md`.
4. Route work through clearly named workflows and commands.
5. Prevent OpenCode from creating, editing, patching, formatting, regenerating,
   or automatically fixing source files.
6. Permit documentation and vault changes only through preview, revision,
   explicit approval, and constrained application.
7. Preserve project definition, progress, and decisions in authoritative files.
8. Make Git and GitHub operations repeatable through global defaults,
   project overrides, deterministic validation, and explicit confirmation.
9. Support mediated project-to-vault updates without duplicating repository
   documentation.
10. Store the OpenCode configuration in its own Git repository while integrating
    it into the dotfiles repository through linkage and bootstrap logic.

### 3.2 Secondary objectives

- Retain useful read-only built-in agents where custom replacements add no value.
- Allow automatic routing for read-only reasoning.
- Require explicit commands or confirmation for mutating workflows.
- Support clean session recovery without relying on conversation history.
- Make the configuration extensible for later research and marketplace workflows.

## 4. Non-Goals

The initial project will not:

- create a separate custom agent for every action;
- expose multiple normal user-facing primary agents;
- automatically modify source code;
- automatically commit after every file save;
- mirror repository documentation into the Obsidian vault;
- write unreviewed research directly into the vault;
- rebuild a complete project-management platform inside Markdown;
- implement full Polish marketplace product research in the first version;
- rely on OpenCode's GitHub Actions integration for the local Git workflow;
- allow OpenCode to rewrite its own live configuration without isolated testing;
- introduce nested subagent hierarchies unless later evidence justifies them.

## 5. Operating Principles

### 5.1 Behaviour

`lead` must:

- challenge assumptions, weak reasoning, unnecessary complexity, and missing
  requirements;
- avoid automatic praise and agreement;
- distinguish facts, assumptions, inferences, and recommendations;
- prefer maintainability, repeatability, clarity, and business value;
- use approved project artifacts as authoritative context;
- avoid reopening settled scope unless new evidence creates a material conflict,
  risk, or missing decision;
- perform direct reasoning by default and delegate only when special context,
  independence, bounded investigation, or permissions justify it.

### 5.2 Source ownership

OpenCode must never directly write source files.

This includes:

- application code;
- tests;
- scripts;
- configuration;
- CI definitions;
- package manifests;
- migrations;
- generated code;
- OpenCode implementation files.

OpenCode may:

- read source files;
- inspect repository status;
- propose changes in code blocks;
- explain proposed changes;
- reread files after Tom manually enters the changes;
- identify mistakes and provide corrected fragments in code blocks;
- recommend validation commands.

OpenCode must not fix even trivial source-code errors directly.

### 5.3 Documentation ownership

Documentation is the only normal file category OpenCode may create or modify.

Documentation changes must follow:

1. draft;
2. preview;
3. conversational revision;
4. explicit approval;
5. immutable permission confirmation;
6. constrained application;
7. resulting diff review.

Generic file-edit capability remains denied. Documentation writes use narrow
custom tools.

## 6. Architecture

### 6.1 Primary agent

The only normal user-facing primary agent is:

```text
lead
```

`lead` is responsible for:

- maintaining the main conversation;
- selecting the current workflow;
- loading relevant skills;
- invoking bounded subagents when useful;
- invoking constrained tools for approved operations;
- integrating specialist output;
- enforcing the interaction contract.

`lead` is not a brainstorming-only agent.

### 6.2 Skills

Skills contain reusable procedures and domain methodology. They are loaded on
demand and do not invoke subagents themselves.

Initial skills:

- `project-definition`
- `development`
- `documentation`
- `project-progress`
- `git-workflow`
- `vault-curation`
- `research`

### 6.3 Subagents

Initial agent decisions:

- retain built-in `explore` for constrained read-only repository investigation;
- keep external documentation and dependency research with `lead`;
- disable built-in `build`, `plan`, and `general`;
- avoid exposing multiple normal primary agents;
- add custom specialists only where permissions, context, reasoning role, or
  output contract materially differ.

Expected custom specialists:

- `project-critic`
- `documentation-writer`
- `git-operator`
- `vault-curator`

Subagents remain siblings of skills under `lead`. A skill may instruct `lead`
when a subagent is useful, but the skill does not execute the subagent.

### 6.4 Tools

Custom tools enforce deterministic and constrained actions.

Expected tools include:

- `documentation_preview`
- `documentation_apply`
- `vault_preview`
- `vault_apply`
- deterministic Git policy and lifecycle tools

Preview and apply remain separate internal operations even when they are part of
one continuous user-facing workflow.

## 7. Workflow Routing

Workflow selection follows this precedence:

1. explicit slash command;
2. explicit wording in the current request;
3. recorded project status;
4. automatic inference;
5. safe read-only fallback.

Automatic routing is permitted for read-only reasoning.

Mutating workflows require explicit intent, confirmation, and the required
permission prompt.

Project Definition must not be entered merely because `lead` is critical.
Development requests remain in Development unless new evidence materially
invalidates approved scope.

## 8. User-Facing Command Catalogue

```text
/define
/resume
/develop
/docs
/state
/milestone
/decision
/start
/checkpoint
/finish
/release
/note
/research
```

### 8.1 Command contracts

| Command       | Responsibility                                                           |
| ------------- | ------------------------------------------------------------------------ |
| `/define`     | Create or materially revise the project definition and related artifacts |
| `/resume`     | Reconstruct enough project context to continue work                      |
| `/develop`    | Propose and review source changes without writing them                   |
| `/docs`       | Create, review, revise, approve, and apply documentation                 |
| `/state`      | Report current project and repository state without modifying it         |
| `/milestone`  | Start, complete, block, or otherwise transition a milestone              |
| `/decision`   | Record, reject, or supersede a durable decision                          |
| `/start`      | Begin a policy-compliant unit of work on a feature branch                |
| `/checkpoint` | Validate, commit, and push a coherent unit of work                       |
| `/finish`     | Finalise the current branch and prepare a pull request                   |
| `/release`    | Merge, version, tag, and publish according to policy                     |
| `/note`       | Create or update an approved Obsidian vault note                         |
| `/research`   | Perform structured research without automatic publication                |

Commands use short names because their descriptions and definitions provide the
execution contract.

## 9. Project Artifacts

Every configured project may use:

```text
docs/project/definition.md
docs/project/progress.md
docs/project/decisions.md
```

### 9.1 `definition.md`

Authoritative for:

- problem statement;
- objectives;
- outcomes;
- non-goals;
- constraints;
- approved approach;
- acceptance criteria;
- planned implementation phases.

It does not store the current operational phase.

Definition changes are classified as:

- `material`
- `editorial`
- `no-change`

Only an approved material change increments the definition version.

### 9.2 `progress.md`

Authoritative for:

- current phase;
- active milestone;
- completed milestones;
- blockers;
- open questions;
- next action.

### 9.3 `decisions.md`

Authoritative append-oriented decision history.

Decisions may be:

- proposed;
- accepted;
- rejected;
- superseded.

Superseded decisions remain in history and reference their replacement.

## 10. Project Definition Workflow

The `/define` workflow covers both initial project definition and later material
redefinition.

### 10.1 Initial definition

The workflow must:

1. discuss and challenge the project;
2. separate outcomes from proposed implementation;
3. identify assumptions, constraints, omissions, and risks;
4. compare alternatives;
5. record accepted and rejected choices;
6. define acceptance criteria;
7. determine whether the project is sufficiently defined;
8. prepare coordinated project artifacts;
9. show a combined preview;
10. allow conversational revision;
11. apply the approved change set atomically.

The initial outcome is:

- `definition.md`
- `progress.md`
- `decisions.md`

### 10.2 Re-entry during development

Re-enter `/define` when:

- the objective changes;
- a non-goal becomes required;
- a core constraint changes;
- an architectural assumption becomes invalid;
- acceptance criteria change;
- a major capability enters or leaves scope;
- implementation evidence invalidates the approved approach.

Only affected artifacts should be changed. No-change and editorial outcomes are
valid and must not create meaningless Git noise.

### 10.3 Atomicity

Multi-file definition updates must be atomic.

The apply operation must:

- validate all target paths;
- verify source and preview checksums;
- refuse the whole operation if any target is stale or invalid;
- avoid partial application;
- return one combined resulting diff.

## 11. Development Workflow

The `/develop` workflow must:

1. read the approved project definition and relevant project instructions;
2. inspect relevant source files;
3. load the `development` skill;
4. use `explore` only when useful;
5. propose one coherent implementation unit;
6. show source changes in code blocks;
7. explain important design choices;
8. wait for Tom to enter the code manually;
9. reread the resulting files;
10. identify transcription or implementation errors;
11. provide corrections in code blocks;
12. recommend validation;
13. never modify source files.

Debugging, implementation, and transcription review remain inside Development
unless later evidence justifies separate workflows.

## 12. Documentation Workflow

The `/docs` workflow covers:

- creation;
- review;
- correction;
- restructuring;
- update;
- removal of obsolete documentation.

The user-facing flow is continuous:

```text
request -> preview -> revision -> approval -> permission -> apply
```

Separate `/docs-apply` is intentionally rejected.

The apply tool must reject:

- missing previews;
- stale previews;
- changed target files;
- altered content;
- out-of-bound paths;
- session or worktree mismatches.

## 13. Project Progress Workflow

The Project Progress capability includes:

- `/state`
- `/milestone`
- `/decision`

### 13.1 `/state`

Read-only report of:

- current phase;
- active milestone;
- branch;
- working-tree status;
- latest checkpoint;
- blockers;
- next documented action.

### 13.2 `/milestone`

Proposes and, after approval, applies milestone transitions.

Examples:

- start;
- complete;
- block;
- unblock;
- cancel.

### 13.3 `/decision`

Records durable decisions with:

- identifier;
- date;
- status;
- context;
- decision;
- rationale;
- alternatives;
- consequences;
- related milestone;
- supersession links where applicable.

Project Progress may record scope impact but must not redefine scope. Material
scope changes return to `/define`.

## 14. Session Recovery

`/resume` must bootstrap a new session from durable state by reading:

- project `AGENTS.md`;
- `definition.md`;
- `progress.md`;
- recent relevant decisions;
- effective Git policy;
- current branch;
- working-tree status;
- recent commits.

It returns:

- project objective;
- current phase and milestone;
- relevant accepted decisions;
- blockers;
- uncommitted changes;
- recommended next action.

`/state` remains lightweight; `/resume` restores working context.

## 15. Git and GitHub Workflow

### 15.1 Principles

- commit coherent validated units, not file saves;
- never commit directly to `main`;
- never force-push `main`;
- never stage unrelated files automatically;
- require confirmation for mutation;
- use local `git` and `gh`;
- avoid OpenCode GitHub Actions orchestration.

### 15.2 Lifecycle

```text
/start
  -> /develop
  -> /checkpoint
  -> /finish
  -> /release
```

### 15.3 Global and project policy

Effective policy:

```text
global defaults
  + optional project overrides
  + non-overridable safety guardrails
```

Expected locations:

```text
global: policies/git-defaults.toml
project: .opencode/git-policy.toml
```

Global defaults may define:

- base branch;
- branch grammar;
- commit convention;
- merge strategy;
- rebase policy;
- version scheme;
- tag prefix;
- changelog;
- release-note template.

Project files specify only differences.

The merge logic must be deterministic and implemented by code, not inferred by
the LLM.

### 15.4 Expected defaults

Initial defaults to validate during development:

- short-lived feature branches;
- branch pattern: `<type>/<kebab-case-summary>`;
- Conventional Commits;
- rebase feature branch onto updated base branch before PR when required;
- squash merge;
- delete merged feature branch;
- semantic versioning unless a project overrides or disables releases;
- explicit approval before commit, push, rebase, PR creation, merge, tag, or
  release;
- `--force-with-lease` only after approved feature-branch rebase where necessary.

## 16. Vault Curation

### 16.1 Purpose

Allow OpenCode to create and modify structured Obsidian notes when requested,
without duplicating repository documentation.

The vault stores:

- project navigation and knowledge notes;
- cross-project knowledge;
- articles and concepts;
- people and organisations;
- clients;
- lessons learned;
- milestone summaries;
- links to authoritative repository documentation.

### 16.2 Project-to-vault updates

Project sessions may trigger mediated vault updates.

Flow:

1. request `/note`;
2. read authoritative project artifacts;
3. read relevant existing vault notes;
4. prepare a proposal;
5. show the preview;
6. revise conversationally;
7. apply through a constrained vault tool after approval;
8. optionally checkpoint the vault repository.

The primary agent does not receive arbitrary vault write access.

### 16.3 Standalone vault workspace

A dedicated vault-rooted OpenCode workspace may support:

- article capture;
- person and client notes;
- topic maintenance;
- backlinking;
- duplicate resolution;
- general knowledge curation.

Both contexts use the same taxonomy, templates, and tools.

### 16.4 Tool constraints

Vault tools must enforce:

- vault-root confinement;
- Markdown-only writes;
- path traversal rejection;
- valid frontmatter;
- note-type rules;
- duplicate checks;
- stale-preview detection;
- protected vault configuration;
- final diff output.

Separate `/note-apply` is intentionally rejected.

## 17. Research

Research remains a separate workflow.

It may:

- challenge criteria;
- evaluate feasibility;
- search external sources;
- compare options;
- preserve source and retrieval metadata;
- produce a reviewable final result.

It must not automatically write to the vault.

Accepted findings may later be passed into `/note`.

Full product and Polish marketplace research is deferred to a later phase because
it may require browser automation, marketplace-specific handling, provenance,
freshness tracking, and additional tools.

## 18. Configuration Repository and Dotfiles Integration

The OpenCode configuration must live in a dedicated Git repository.

That repository is authoritative for OpenCode content.

The dotfiles repository is authoritative for:

- installation;
- linkage;
- bootstrap;
- dependency setup;
- component pinning;
- deployment of an accepted configuration revision.

The repositories must not contain duplicated copies of the same configuration.

Expected integration:

```text
dotfiles/
└── modules/opencode/   -> linked repository or submodule
```

Expected live linkage:

```text
~/.config/opencode
  -> accepted configuration repository path
```

Development must use an isolated branch or worktree and an isolated OpenCode
configuration path. The live configuration remains on the last accepted version
until changes are reviewed and merged.

## 19. Permission Model

Immutable permission enforcement is a core requirement.

### 19.1 Required guarantees

- built-in generic source editing denied;
- source mutation through shell restricted;
- broad built-in modifying agents disabled;
- documentation and vault mutation only through constrained tools;
- mutation requires explicit user intent and permission confirmation;
- project configuration must not be able to silently weaken hard protections.

### 19.2 Implementation concerns

OpenCode project configuration may override global configuration. Therefore,
global prompt rules alone are not a sufficient immutable boundary.

Development must evaluate and implement a hardened approach using one or more of:

- managed settings;
- validated launch wrappers;
- constrained replacement tools;
- project-configuration validation;
- removal or replacement of generic edit and shell capabilities.

The final model must be tested adversarially.

## 20. Implementation Phases

### Phase 1 — Configuration foundation

- repository structure;
- global `AGENTS.md`;
- `lead` primary agent;
- built-in agent restrictions;
- isolated development launcher;
- managed permission guardrails;
- resolved-configuration validation;
- adversarial integration tests;
- development documentation.

### Phase 2 — Project workflows

- skills;
- commands;
- workflow routing;
- project artifact templates;
- `/define`;
- `/resume`;
- `/develop`;
- `/state`;
- `/milestone`;
- `/decision`.

### Phase 3 — Documentation transaction

- preview model;
- proposal identifiers;
- checksums;
- multi-file atomic application;
- documentation path restrictions;
- `/docs`.

### Phase 4 — Git policy and lifecycle

- global policy schema;
- project override schema;
- deterministic merge logic;
- branch naming;
- commit validation;
- `/start`;
- `/checkpoint`;
- `/finish`;
- `/release`;
- local `gh` integration.

### Phase 5 — Vault curation

- vault taxonomy;
- templates;
- project index notes;
- note resolution and deduplication;
- preview and apply tools;
- mediated project access;
- `/note`.

### Phase 6 — Live deployment and dotfiles integration

- accepted configuration revision;
- managed configuration deployment under `/etc/opencode`;
- live `~/.config/opencode` linkage;
- dotfiles or chezmoi integration;
- Herdr integration restoration;
- deployed-topology guardrail validation;
- controlled live testing.

### Phase 7 — Research

- general research methodology;
- source provenance;
- result validation;
- later marketplace integrations;
- optional publication handoff to `/note`.

## 21. Acceptance Criteria

The project is successful when:

1. OpenCode starts with `lead` as the only normal user-facing primary agent.
2. `build`, `plan`, and `general` are disabled.
3. `explore` remains available for read-only delegation.
4. `lead` selects workflows without repeatedly reopening approved scope.
5. explicit commands override automatic routing.
6. source files cannot be modified through built-in edit tools or permitted shell
   paths.
7. Development produces reviewable code blocks only.
8. documentation changes require preview, revision, approval, permission, and
   constrained application.
9. project definition updates can atomically modify multiple artifacts.
10. `/resume` reconstructs useful project context from files and repository state.
11. Git naming, validation, commits, PRs, merges, versions, tags, and releases
    follow deterministic effective policy.
12. project policy can override approved defaults but not hard safety guardrails.
13. project sessions can prepare vault updates without receiving arbitrary vault
    write access.
14. vault notes follow defined templates, structure, backlinks, and duplicate
    handling.
15. research is not published to the vault without explicit acceptance.
16. the configuration repository is independently versioned and integrated into
    dotfiles without duplicated source files.
17. permission assumptions are covered by repeatable adversarial tests.

## 22. Definition Completion

The project definition is sufficiently complete to begin Development.

The remaining unresolved items are implementation decisions, not scope blockers:

- exact configuration file layouts;
- exact wording of agent, skill, and command prompts;
- exact custom-tool interfaces;
- exact immutable-permission mechanism;
- exact TOML schemas;
- exact transaction implementation;
- exact vault taxonomy and templates;
- exact validation command profiles.

These must be resolved and tested within their implementation phases while
remaining consistent with this approved definition.
