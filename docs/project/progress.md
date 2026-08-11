---
title: OpenCode Mentor Project Progress
status: active
current_phase: development
active_milestone: project-workflows
updated_at: 2026-08-11
---

# Project Progress


## Current State

* **Definition status:** approved
* **Definition version:** 3
* **Current phase:** Development
* **Completed milestone:** Configuration Foundation
* **Active milestone:** Project Workflows
* **Implementation status:** The `/state`, `/resume`, and `/develop` workflows
  are implemented and validated. The deterministic `git_state` tool, protected
  workspace boundary, command and skill discovery checks, and Project Workflows
  regression tests are also in place.
* **Blocking issues:** none
* **Next action:** implement `/define` and the proposal-only
  `project-definition` workflow.

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

## Planned Milestones

### 1. Configuration Foundation

Status: completed

Deliver the repository, `lead`, base configuration, isolated testing, and
initial permission controls.

### 2. Project Workflows

Status: active

Deliver:

- skills;
- command catalogue;
- routing rules;
- project templates;
- `/define`;
- `/resume`;
- `/develop`;
- `/state`;
- `/milestone`;
- `/decision`.

Current implementation status:

**Implemented and validated:**

* `/state`;
* `/resume`;
* `/develop`;
* State and Resume procedures in `project-progress`;
* proposal-only `development` skill;
* deterministic `git_state` tool;
* protected external-workspace boundary;
* command and skill runtime discovery tests;
* Project Workflows and permission guardrail regression tests.

**Remaining in this milestone:**

* `project-definition` skill;
* `/define`;
* `/milestone`;
* `/decision`;
* project templates;
* final workflow-routing integration and hardening.

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

### 6. Live Deployment and Dotfiles Integration

Status: planned

### 7. Research

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

* project-state bootstrap behaviour;
* command argument conventions for the remaining workflows;
* how `lead` records and recognises the active workflow;
* whether `project-critic` is required in the first implementation;
* final protection model for project-local commands, skills, agents, and other
  workflow overrides.

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

**Response:** use `/milestone`, `/decision`, `/state`, and `/resume` as normal
workflow boundaries.

### Vault duplication

Project knowledge may be copied rather than linked.

**Response:** keep repository documentation authoritative and restrict vault
content to navigation and cross-project knowledge.

## Next Development Action

Implement `/define` and the proposal-only `project-definition` workflow as the
next Project Workflows vertical slice.

1. define the `/define` command contract and route it through `lead`;
2. create the `project-definition` skill;
3. support both initial project definition and material re-entry during
   Development;
4. read and reason across `definition.md`, `progress.md`, and `decisions.md` as a
   coordinated project state;
5. distinguish material, editorial, and no-change definition outcomes;
6. challenge objectives, constraints, assumptions, architecture, non-goals, and
   acceptance criteria before proposing changes;
7. produce a coordinated preview of required project-artifact changes;
8. keep artifact mutation proposal-only until the Documentation Transaction
   milestone provides constrained preview and atomic application;
9. add command, skill, routing, and workflow-contract regression tests;
10. validate `/define` manually in both initial-definition and development
    re-entry scenarios.
