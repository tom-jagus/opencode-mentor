---
title: OpenCode Workflow Progress
status: active
current_phase: development
active_milestone: configuration-foundation
updated_at: 2026-08-03
---

# Project Progress

## Current State

- **Definition status:** approved
- **Definition version:** 1
- **Current phase:** Development
- **Active milestone:** Configuration Foundation
- **Repository status:** not yet created
- **Implementation status:** not started
- **Blocking issues:** none
- **Next action:** create the dedicated configuration repository and implement
  the minimum isolated configuration foundation.

## Phase Transition

The Project Definition phase is complete.

The project is ready to move into Development because the following are agreed:

- project purpose and non-goals;
- one-primary-agent architecture;
- primary agent name `lead`;
- workflow-routing rules;
- skill, subagent, command, and tool responsibilities;
- final command catalogue;
- project artifact model;
- source-code ownership rules;
- documentation transaction model;
- Git policy structure and lifecycle;
- vault integration boundaries;
- research publication rules;
- immutable permission requirement;
- implementation phases;
- acceptance criteria.

Remaining unknowns are implementation-level decisions and do not block
Development.

## Active Milestone — Configuration Foundation

### Objective

Create the smallest working and safely isolated OpenCode configuration that can
serve as the base for all later workflows.

### Planned outcomes

- create the dedicated OpenCode configuration repository;
- decide and implement the dotfiles linkage mechanism;
- define the initial repository layout;
- create the global `AGENTS.md`;
- define the `lead` primary agent;
- set `lead` as the default agent;
- disable `build` and `general`;
- retain `explore`;
- establish the initial permission baseline;
- create an isolated test launch using a branch or worktree;
- prevent accidental use of an unsafe fallback agent;
- document bootstrap and validation steps;
- create initial adversarial permission tests.

### Completion criteria

The milestone is complete when:

1. the repository exists and is version-controlled;
2. the dotfiles integration approach is implemented without file duplication;
3. an isolated OpenCode instance starts from the repository configuration;
4. `lead` is the only normal user-facing primary agent;
5. `build` and `general` are unavailable;
6. 'explore' can be used for read-only repository delegation; external research
remains with lead until a stable or justified specialist is available7. generic source editing is denied;
8. known shell mutation paths are blocked or permission-gated;
9. a misconfigured default agent cannot silently expose unsafe behaviour;
10. the setup and validation process are documented;
11. the initial change is checkpointed through a feature branch and PR.

## Planned Milestones

### 1. Configuration Foundation

Status: active

Deliver the repository, `lead`, base configuration, dotfiles linkage, isolated
testing, and initial permission controls.

### 2. Project Workflows

Status: planned

Deliver:

- skills;
- command catalogue;
- routing rules;
- project templates;
- `/define`;
- `/resume`;
- `/develop`;
- `/status`;
- `/milestone`;
- `/decision`.

### 3. Documentation Transaction

Status: planned

Deliver:

- documentation proposal model;
- previews and diffs;
- proposal identifiers;
- checksum and stale-target validation;
- multi-file atomic application;
- constrained documentation paths;
- `/docs`.

### 4. Git Policy and Lifecycle

Status: planned

Deliver:

- global Git schema;
- project override schema;
- deterministic merge logic;
- non-overridable guardrails;
- branch and commit validation;
- `/start`;
- `/checkpoint`;
- `/finish`;
- `/release`;
- local GitHub CLI integration.

### 5. Vault Curation

Status: planned

Deliver:

- vault taxonomy;
- templates;
- duplicate resolution;
- project note conventions;
- mediated project access;
- preview and apply tools;
- `/note`;
- vault Git checkpoint integration.

### 6. Research

Status: deferred

Deliver:

- general research procedure;
- source provenance;
- result validation;
- controlled handoff to `/note`.

Marketplace-specific product research remains a later subproject unless its
requirements become sufficiently stable.

## Open Implementation Questions

These questions must be resolved during the relevant milestone. They do not
require returning to Project Definition unless the answer materially changes
scope or constraints.

### Configuration Foundation

- exact repository layout;
- exact dotfiles linkage mechanism;
- exact live versus development configuration paths;
- exact `lead` prompt content;
- exact `opencode.jsonc` agent and permission structure;
- safe handling of invalid `default_agent` fallback;
- managed settings versus wrapper-based immutable restrictions;
- whether a replacement shell tool is required in the first version;
- minimum adversarial permission test suite.

### Project Workflows

- exact skill directory structure;
- exact command prompt wording;
- project-state bootstrap behaviour;
- command argument conventions;
- how `lead` records and recognises the active workflow;
- whether `project-critic` is required in the first implementation.

### Documentation Transaction

- preview storage format;
- proposal identifier format;
- checksum algorithm;
- atomic multi-file write strategy;
- rollback strategy;
- Markdown path classification;
- diff presentation method.

### Git Policy and Lifecycle

- final TOML schema;
- merge algorithm and precedence;
- approved branch types;
- Conventional Commit scope strategy;
- default validation profile;
- exact semantic-versioning implementation;
- release-note structure;
- treatment of repositories without releases.

### Vault Curation

- vault root configuration;
- note taxonomy;
- naming conventions;
- frontmatter schema;
- backlink rules;
- duplicate-resolution algorithm;
- protected paths;
- project-note template;
- person, organisation, client, article, and concept templates.

## Risks

### Permission bypass

Project configuration, shell commands, formatters, generators, or custom scripts
may bypass a superficial source-edit denial.

**Response:** use constrained tools, immutable enforcement, configuration
validation, and adversarial tests.

### Workflow overengineering

Too many agents, commands, or skills could make the system harder to understand
than the default configuration.

**Response:** create custom components only when authority, context, procedure, or
output materially differs.

### Prompt-only reliability

Prompts cannot guarantee deterministic branch names, policy precedence, atomic
writes, or permission boundaries.

**Response:** place enforceable behaviour in scripts, policies, schemas, and
custom tools.

### Documentation drift

Project artifacts may become outdated if progress and decisions are not updated.

**Response:** use `/milestone`, `/decision`, `/status`, and `/resume` as normal
workflow boundaries.

### Vault duplication

Project knowledge may be copied rather than linked.

**Response:** keep repository documentation authoritative and restrict vault
content to navigation and cross-project knowledge.

## Next Development Action

Start the Configuration Foundation milestone with:

```text
/start configuration-foundation
```

The first implementation unit should establish:

1. repository structure;
2. isolated launch path;
3. minimal global `AGENTS.md`;
4. minimal `lead` definition;
5. built-in agent disable/retain settings;
6. initial safe permission baseline.

Do not begin command, vault, or Git automation implementation before the isolated
foundation is working and tested.
