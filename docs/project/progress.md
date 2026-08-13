---
title: OpenCode Mentor Project Progress
status: active
current_phase: development
active_milestone: Git Policy and Lifecycle
updated_at: 2026-08-13
---

# Project Progress


## Current State

* **Definition status:** approved
* **Definition version:** 3
* **Current phase:** Development
* **Completed milestones:** Configuration Foundation, Project Workflows,
  Documentation Transaction
* **Active milestone:** Git Policy and Lifecycle
* **Implementation status:** `/state`, `/resume`, `/develop`, `/define`, `/docs`,
  `/milestone`, and `/decision` are implemented and validated.
  `project-progress` provides State, Resume, Milestone, and Decision procedures;
  `project-definition` provides initial definition, material re-entry, project
  bootstrap semantics, and embedded project artifact templates; `documentation`
  provides reviewed ordinary-documentation changes through the constrained
  Documentation Transaction; `lead` provides workflow routing and project-state
  bootstrap classification. Production configuration hardening is established
  through the managed `/etc/opencode` policy, explicit skill allowlisting, and
  the production trust boundary recorded in DEC-042. A dedicated
  `project-critic` is deferred by DEC-043. The Documentation Transaction is
  implemented and validated with authority-specific integration for `/docs`,
  `/define`, `/milestone`, and `/decision`. Git Policy and Lifecycle is active.
  Its v1 global policy schema and deterministic read-only `git_policy` resolver
  are implemented and validated against DEC-046, including strict global and
  sparse project-policy validation, deterministic merge semantics, effective
  policy validation, normal handling of an absent project policy, managed tool
  permissions, focused automated tests, and successful runtime resolution of the
  global policy without a project override. Pure deterministic branch-name and
  commit-message validators using the effective `GitPolicy` are also implemented,
  tested, committed, and pushed; semantic commit-message quality remains an
  explicit review responsibility.
* **Blocking issues:** none
* **Next action:** implement `/start` as a constrained, policy-aware lifecycle
  operation with deterministic inspection, validation, preview, explicit
  approval, and narrowly scoped branch creation.

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

Status: completed

Delivered:

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

Completed implementation:

**Implemented:**

* `/state`;
* `/resume`;
* `/develop`;
* `/define`;
* `/milestone`;
* `/decision`;
* State, Resume, Milestone, and Decision procedures in `project-progress`;
* proposal-only `development` skill;
* proposal-only `project-definition` skill;
* workflow routing through `lead`;
* project-state bootstrap classification and handling;
* initial project artifact templates;
* deterministic `git_state` tool;
* protected external-workspace boundary;
* manual semantic smoke validation of implemented workflows;
* production configuration and trust-boundary hardening;
* deny-by-default managed skill policy with explicit trusted-skill allowlisting.

### 3. Documentation Transaction

Status: completed

Delivered:

- constrained `documentation_preview` and permission-gated
  `documentation_apply` tools;
- authority-specific integration for `docs`, `project-definition`, `milestone`,
  and `decision` workflows while preserving their semantic ownership;
- immutable proposals identified by unique proposal identifiers;
- complete exact before/after proposal snapshots and checksums;
- deterministic unified-diff human review derived from those exact snapshots, as
  established by DEC-045;
- revision through new proposal identifiers;
- Apply using only the exact reviewed proposal identifier and persisted complete
  content;
- constrained documentation path and operation authority;
- proposal-integrity, project-binding, authority, and stale-target revalidation
  before mutation;
- multi-file transactional preparation and deterministic application;
- rollback handling for safely recoverable failures;
- single-use applied proposal state;
- proposal runtime storage outside the project repository;
- proposal-state symbolic-link hardening;
- `/docs`;
- integrated use of the Documentation Transaction by `/define`, `/milestone`, and
  `/decision`.

### 4. Git Policy and Lifecycle

Status: active

Delivered:

- v1 global Git policy schema in `policies/git-defaults.toml`;
- architectural support for optional sparse `.opencode/git-policy.toml` project
  overrides;
- strict validation of global, project, and effective policy;
- deterministic scalar replacement, array replacement, and recursive known-table
  merge semantics;
- deterministic read-only `git_policy` custom tool with managed access for
  `lead` and denial for `explore`;
- focused resolver tests outside the OpenCode tool-discovery directory;
- successful runtime resolution with no project override;
- pure deterministic branch-name validation against effective configured branch
  types and lowercase kebab-case grammar;
- pure deterministic commit-message validation for mechanical policy rules with
  semantic descriptiveness and body usefulness preserved for explicit review;
- focused automated validator tests.

Remaining:

- non-overridable guardrails;
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

- exact non-duplicating dotfiles linkage mechanism;
- installation/bootstrap strategy for `~/.config/opencode` and
  `/etc/opencode/opencode.json`;
- whether the final repository requires an installation/bootstrap script;
- exact Herdr integration restoration mechanism.

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

### Git Policy and Lifecycle

- exact semantic-versioning implementation;
- release-note structure.

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

**Response:** enforce immutable permissions through managed configuration under
`/etc/opencode`, keep generic source editing denied, permission-gate shell
execution, and expose approved mutation through constrained workflow-specific
tools. Project-local executable OpenCode configuration is treated as trusted
project configuration rather than an adversarial sandbox boundary.

### Workflow overengineering

Too many agents, commands, or skills could make the system harder to understand
than the default configuration.

**Response:** create custom components only when authority, context, procedure, or
output materially differs.

### Prompt-only reliability

Prompts cannot guarantee deterministic branch names, policy precedence, atomic
writes, or permission boundaries.

**Response:** place enforceable behaviour in managed configuration, deterministic
policies, schemas, and constrained custom tools.

### Documentation drift

Project artifacts may become outdated if progress and decisions are not updated.

**Response:** use `/milestone`, `/decision`, `/state`, and `/resume` as normal
workflow boundaries.

### Vault duplication

Project knowledge may be copied rather than linked.

**Response:** keep repository documentation authoritative and restrict vault
content to navigation and cross-project knowledge.

## Next Development Action

Implement `/start` as a constrained, policy-aware lifecycle operation with
deterministic inspection, validation, preview, explicit approval, and narrowly
scoped branch creation.
