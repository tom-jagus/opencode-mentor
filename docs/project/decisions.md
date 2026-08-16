---
title: OpenCode Mentor Project Decisions
status: active
updated_at: 2026-08-16
---

# Decision Register

This file is append-oriented. Accepted historical decisions must not be removed.
When a decision is replaced, mark it `superseded` and reference the replacement.

## DEC-001 — Dedicated OpenCode Configuration Repository

- **Date:** 2026-08-03
- **Status:** accepted
- **Decision:** Store the OpenCode configuration in its own Git repository.
- **Rationale:** The configuration is a substantial independent system requiring
  versioning, testing, releases, and isolated development.
- **Consequences:** The dotfiles repository manages installation, linkage,
  bootstrap, and component revision rather than duplicating the configuration.

## DEC-002 — Dotfiles Integration by Linkage

- **Date:** 2026-08-03
- **Status:** accepted
- **Decision:** Integrate the separate OpenCode repository into dotfiles through
  a linked repository, submodule, or equivalent non-duplicating mechanism.
- **Rationale:** Both repositories cannot be authoritative for the same copied
  files.
- **Consequences:** The exact linkage mechanism will be selected during
  Configuration Foundation.

## DEC-003 — Global Behavioural Contract

- **Date:** 2026-08-03
- **Status:** accepted
- **Decision:** Store stable personal behaviour in global `AGENTS.md`.
- **Rationale:** Permanent behaviour should be available consistently without
  bloating every specialised skill or agent.
- **Consequences:** Procedural details remain in skills, commands, and policies.

## DEC-004 — One User-Facing Primary Agent

- **Date:** 2026-08-03
- **Status:** accepted
- **Decision:** Use one normal user-facing primary agent named `lead`.
- **Rationale:** Manual switching between multiple primary agents is prone to
  user error and breaks conversational continuity.
- **Consequences:** `lead` must be workflow-neutral and route work through skills,
  subagents, commands, and tools.

## DEC-005 — `lead` Is Not a Brainstorming-Only Agent

- **Date:** 2026-08-03
- **Status:** accepted
- **Decision:** `lead` must not default every task back to brainstorming.
- **Rationale:** Development, documentation, Git, vault, and research work require
  different procedures without reopening settled project scope.
- **Consequences:** Critical behaviour remains permanent, while current workflow
  is selected separately.

## DEC-006 — Workflow Routing Precedence

- **Date:** 2026-08-03
- **Status:** accepted
- **Decision:** Route workflows using this precedence:
  1. explicit command;
  2. explicit current wording;
  3. recorded project state;
  4. automatic inference;
  5. safe read-only fallback.
- **Rationale:** Commands must provide deterministic overrides while natural
  interaction remains convenient.
- **Consequences:** Mutating operations cannot rely solely on automatic inference.

## DEC-007 — Skills and Subagents Are Separate Primitives

- **Date:** 2026-08-03
- **Status:** accepted
- **Decision:** Treat skills and subagents as sibling capabilities coordinated by
  `lead`.
- **Rationale:** Skills are passive procedures; they do not own or invoke
  subagents.
- **Consequences:** A skill may instruct `lead` when delegation is useful, but
  `lead` performs the actual Task invocation.

## DEC-008 — Direct Work by Default

- **Date:** 2026-08-03
- **Status:** accepted
- **Decision:** `lead` handles normal reasoning directly and delegates only when
  bounded context, independence, specialisation, or permissions justify it.
- **Rationale:** A pure routing agent would create needless context fragmentation
  and model calls.
- **Consequences:** Subagents support rather than replace the main conversation.

## DEC-009 — Built-In Agent Policy

- **Date:** 2026-08-03
- **Status:** superseded by DEC-036
- **Decision:** Disable `build` and `general`; retain `explore` and `scout`
  initially.
- **Rationale:** Broad modifying agents conflict with the safety model, while the
  read-only specialists provide useful generic capabilities.
- **Consequences:** Custom replacements are created only when materially different
  permissions, roles, models, or output contracts justify them.

## DEC-010 — Source Code Is Proposal-Only

- **Date:** 2026-08-03
- **Status:** accepted
- **Decision:** OpenCode must never create, edit, patch, format, regenerate, or
  automatically fix source files.
- **Rationale:** Manual retyping preserves understanding, ownership, and deliberate
  review.
- **Consequences:** OpenCode may inspect source and provide code blocks, but Tom
  manually enters all source changes.

## DEC-011 — Shell Source Mutation Is Restricted

- **Date:** 2026-08-03
- **Status:** accepted
- **Decision:** Prevent shell commands from bypassing source-edit restrictions.
- **Rationale:** Denying a built-in edit tool is insufficient when shell commands,
  formatters, generators, package commands, or scripts may rewrite files.
- **Consequences:** Shell permissions and possibly replacement shell tools must be
  designed and tested as part of immutable enforcement.

## DEC-012 — Documentation Is the Write Exception

- **Date:** 2026-08-03
- **Status:** accepted
- **Decision:** Documentation is the only normal project file category OpenCode
  may create or modify.
- **Rationale:** Tom does not want to write documentation manually.
- **Consequences:** Generic editing remains denied; documentation uses constrained
  preview and apply tools.

## DEC-013 — One Documentation Command

- **Date:** 2026-08-03
- **Status:** accepted
- **Decision:** Use `/docs` for creation, review, revision, approval, and eventual
  application.
- **Rejected alternative:** Separate `/docs-apply`.
- **Rationale:** Application is a state in one conversational workflow, not a
  separate user-facing capability.
- **Consequences:** Preview and apply remain separate internal tools.

## DEC-014 — Documentation Preview and Apply Separation

- **Date:** 2026-08-03
- **Status:** accepted
- **Decision:** Keep `documentation_preview` and `documentation_apply` as separate
  internal operations.
- **Rationale:** Preview must be read-only; application must be permission-gated
  and tied to the exact reviewed proposal.
- **Consequences:** Apply rejects stale, altered, invalid, or out-of-bound
  proposals.

## DEC-015 — Project Definition Workflow Name

- **Date:** 2026-08-03
- **Status:** accepted
- **Decision:** Name the initial and material redefinition workflow **Project
  Definition**, with skill `project-definition` and command `/define`.
- **Rejected alternative:** `scope-alignment` or `brainstorming`.
- **Rationale:** The workflow includes challenge, analysis, decisions, scope,
  constraints, and acceptance criteria, not only ideation.

## DEC-016 — Development Workflow Name

- **Date:** 2026-08-03
- **Status:** accepted
- **Decision:** Name the source implementation workflow **Development**, with
  skill `development` and command `/develop`.
- **Rejected alternative:** `guided-development`.
- **Rationale:** Guidance is an inherent global operating rule and does not need to
  be repeated in the name.

## DEC-017 — Project Definition Produces Project Artifacts

- **Date:** 2026-08-03
- **Status:** accepted
- **Decision:** The outcome of initial `/define` is the coordinated creation of
  `definition.md`, `progress.md`, and `decisions.md`.
- **Rationale:** Conversation alone is not durable project memory.
- **Consequences:** Re-entering `/define` later updates only affected artifacts.

## DEC-018 — Project Artifact Separation

- **Date:** 2026-08-03
- **Status:** accepted
- **Decision:** Use three focused authoritative artifacts:
  - `definition.md`
  - `progress.md`
  - `decisions.md`
- **Rationale:** Scope, current status, and decision history change at different
  rates and should not be mixed.
- **Consequences:** The current project phase is stored only in `progress.md`.

## DEC-019 — Definition Change Classification

- **Date:** 2026-08-03
- **Status:** accepted
- **Decision:** Classify definition outcomes as `material`, `editorial`, or
  `no-change`.
- **Rationale:** Not every discussion justifies a version increment or file
  modification.
- **Consequences:** Only approved material changes increment the definition
  version.

## DEC-020 — Atomic Multi-File Definition Updates

- **Date:** 2026-08-03
- **Status:** accepted
- **Decision:** Apply coordinated project-definition changes atomically.
- **Rationale:** Partial updates would leave authoritative project state
  inconsistent.
- **Consequences:** The application tool must validate the full change set and
  refuse all changes when any target is stale or invalid.

## DEC-021 — Project Progress Capability

- **Date:** 2026-08-03
- **Status:** accepted
- **Decision:** Add the Project Progress skill `project-progress` with `/status`,
  `/milestone`, and `/decision`.
- **Rationale:** Durable operational state and project decisions must be managed
  separately from scope.
- **Consequences:** Material scope changes return to `/define`.

## DEC-022 — Session Recovery

- **Date:** 2026-08-03
- **Status:** accepted
- **Decision:** Add `/resume` to reconstruct project context from artifacts,
  policy, Git state, and recent history.
- **Rationale:** New sessions must not depend on prior conversation memory.
- **Consequences:** `/status` remains a lightweight report, while `/resume`
  restores working context.

## DEC-023 — Simplified Command Names

- **Date:** 2026-08-03
- **Status:** partially superseded
- **Decision:** Use the compact command catalogue:
  `/define`, `/resume`, `/develop`, `/docs`, `/status`, `/milestone`,
  `/decision`, `/start`, `/checkpoint`, `/finish`, `/release`, `/note`,
  `/research`.
- **Rationale:** Command definitions provide the contract; unnecessarily long
  names do not improve reliability.
- **Consequences:** Generic ambiguous commands such as `/apply`, `/update`, or
  `/run` remain avoided.

## DEC-024 — Commit Coherent Units, Not Saves

- **Date:** 2026-08-03
- **Status:** accepted
- **Decision:** Create checkpoints after coherent validated units of work rather
  than after each file save.
- **Rationale:** File saves are not reliable semantic boundaries and would create
  broken or noisy history.
- **Consequences:** `/checkpoint` reviews, validates, commits, and pushes an
  approved unit.

## DEC-025 — Local Git and GitHub CLI Workflow

- **Date:** 2026-08-03
- **Status:** accepted
- **Decision:** Use local `git` and `gh` rather than OpenCode GitHub Actions
  integration.
- **Rationale:** The required workflow is local, iterative, and confirmation-based.
- **Consequences:** Git and GitHub operations are implemented through policies,
  commands, scripts, and custom tools.

## DEC-026 — Global Git Defaults with Project Overrides

- **Date:** 2026-08-03
- **Status:** accepted
- **Decision:** Define one global Git policy and allow optional repository-level
  overrides.
- **Rationale:** Most conventions should be consistent, while validation,
  releases, and selected conventions may differ by project.
- **Consequences:** A deterministic tool merges the policy layers; the LLM does
  not decide precedence.

## DEC-027 — Immutable Git Safety Rules

- **Date:** 2026-08-03
- **Status:** partially superseded by DEC-046
- **Decision:** Certain Git rules cannot be overridden by projects.
- **Rules include:**
  - never commit directly to `main`;
  - never force-push `main`;
  - never stage unrelated files automatically;
  - require confirmation before mutating operations;
  - inspect the final diff before commit.
- **Rationale:** Project convenience must not weaken core safety guarantees.

## DEC-028 — Git Lifecycle Commands

- **Date:** 2026-08-03
- **Status:** accepted
- **Decision:** Use `/start`, `/checkpoint`, `/finish`, and `/release`.
- **Rationale:** The commands represent complete workflow intentions rather than
  low-level Git operations.
- **Consequences:** Branch creation, validation, PR preparation, merging, versioning,
  tagging, and release publication remain policy-controlled.

## DEC-029 — Reject Automatic Vault Mirroring

- **Date:** 2026-08-03
- **Status:** accepted
- **Decision:** Do not copy repository documentation into the Obsidian vault.
- **Rationale:** Duplication creates competing sources of truth and inevitable
  drift.
- **Consequences:** The vault contains navigation, knowledge, people, article,
  decision-summary, and lesson notes linked to authoritative repository files.

## DEC-030 — Mediated Project-to-Vault Updates

- **Date:** 2026-08-03
- **Status:** accepted
- **Decision:** Allow project sessions to trigger vault updates through a
  constrained mediated workflow.
- **Rationale:** A completely isolated vault session would not know current project
  changes without manual handoff.
- **Consequences:** Project artifacts may be read, vault changes are previewed, and
  only a constrained tool writes approved notes.

## DEC-031 — One Vault Command

- **Date:** 2026-08-03
- **Status:** accepted
- **Decision:** Use `/note` for creating or updating Obsidian notes.
- **Rejected alternative:** `/vault-note` plus `/vault-apply`.
- **Rationale:** The shorter command is unambiguous within the configured workflow,
  while apply remains an internal state.
- **Consequences:** Internal `vault_preview` and `vault_apply` tools remain
  separate.

## DEC-032 — Vault Curation Is Layered

- **Date:** 2026-08-03
- **Status:** accepted
- **Decision:** Implement Vault Curation through:
  - skill `vault-curation`;
  - subagent `vault-curator`;
  - preview and apply tools;
  - `/note`.
- **Rationale:** Semantic curation, reasoning, mutation enforcement, and command
  entry are separate concerns.
- **Consequences:** The primary agent never receives arbitrary vault write access.

## DEC-033 — Research Requires Validation Before Publication

- **Date:** 2026-08-03
- **Status:** accepted
- **Decision:** Research must not automatically write to the vault.
- **Rationale:** Research may be stale, incorrect, incomplete, or irrelevant.
- **Consequences:** Accepted research may later be passed into `/note`.

## DEC-034 — Immutable Permission Enforcement

- **Date:** 2026-08-03
- **Status:** accepted
- **Decision:** Permission enforcement must remain effective even when project
  configuration attempts to weaken it.
- **Rationale:** Prompt instructions and ordinary global configuration are not a
  hard security boundary.
- **Consequences:** Development must evaluate managed settings, launch wrappers,
  constrained replacement tools, configuration validation, and adversarial tests.

## DEC-035 — Definition Phase Completion

- **Date:** 2026-08-03
- **Status:** accepted
- **Decision:** The project is sufficiently defined to enter Development.
- **Rationale:** Objectives, non-goals, architecture, workflows, command names,
  artifacts, safety principles, phases, and acceptance criteria are agreed.
- **Consequences:** Remaining questions are implementation details to resolve
  within the planned milestones rather than blockers requiring more definition.

## DEC-036 — Revised Built-In Agent Policy

* **Date:** 2026-08-03
* **Status:** accepted
* **Supersedes:** DEC-009
* **Decision:**

  * disable built-in `build`, `plan`, and `general`;
  * retain built-in `explore` for constrained repository investigation;
  * do not configure `scout` because it is unavailable in OpenCode `1.18.10`;
  * reconsider `scout` only when it is available in a stable release or a custom
    research agent provides a justified material benefit.
* **Rationale:** Implementation validation showed that the approved configuration
  assumed the existence of a built-in `scout` agent that is not present in the
  installed stable OpenCode version. Creating a custom replacement solely to
  preserve that assumption would introduce unnecessary complexity.
* **Consequences:** External documentation and dependency research remains the
  responsibility of `lead`. The agent architecture retains one read-only
  repository specialist rather than inventing an unsupported equivalent.

## DEC-037 — Managed Guardrails and Fail-Closed Launch

* **Date:** 2026-08-03
* **Status:** accepted
* **Decision:** Separate normal OpenCode configuration from immutable safety
  guardrails. Store guardrails in `managed/opencode.json`, apply them through
  runtime inline configuration during development, and validate the fully
  resolved configuration before OpenCode starts.
* **Rationale:** Adversarial testing proved that project configuration could
  override global agent permissions, restore source-editing tools on `lead`, and
  introduce unrestricted user-facing primary agents.
* **Consequences:**

  * `opencode.json` contains normal configurable preferences only;
  * `managed/opencode.json` contains non-overridable safety policy;
  * the development launcher fails closed when the resolved agent surface or
    permissions differ from the approved baseline;
  * `--auto` and explicit agent selection are rejected by the hardened launcher;
  * the eventual Linux deployment will install the managed configuration under
    `/etc/opencode/`;
  * OpenCode upgrades that introduce or remove agents require explicit review.

## DEC-038 — OpenCode Mentor Project Identity

* **Date:** 2026-08-03
* **Status:** accepted
* **Decision:** Name the project **OpenCode Mentor** and use
  `opencode-mentor` as the repository name.
* **Rationale:** The project is an opinionated guidance and workflow system, not
  an OpenCode fork or a collection of ordinary dotfiles. The name reflects the
  proposal-only relationship in which the LLM guides and reviews while the user
  retains ownership of source implementation.
* **Consequences:** Repository documentation, examples, paths, and future release
  metadata use the OpenCode Mentor identity.

## DEC-039 — Defer Live Deployment and Dotfiles Linkage

* **Date:** 2026-08-03
* **Status:** accepted
* **Decision:** Complete and merge the isolated Configuration Foundation before
  implementing live OpenCode deployment and dotfiles linkage. Move live
  deployment into a later dedicated milestone after the first usable OpenCode
  Mentor configuration has been established.
* **Rationale:** Linking an incomplete configuration into
  `~/.config/opencode` would introduce live-system risk without improving
  isolated development. The hardened launcher already provides a reproducible
  environment for configuration and workflow development.
* **Consequences:**

  * Configuration Foundation is completed through isolated execution,
    guardrails, validation, tests, and documentation;
  * the live OpenCode configuration remains unchanged;
  * `/etc/opencode` deployment, dotfiles integration, Herdr restoration, and
    live testing are delivered in the later deployment milestone;
  * final project acceptance still requires non-duplicating dotfiles
    integration.

## DEC-040 — Rename Project State Command

- **Date:** 2026-08-04
- **Status:** accepted
- **Partially supersedes:** DEC-023
- **Decision:** Rename the read-only Project Progress command from `/status` to
  `/state`. All other command names accepted by DEC-023 remain unchanged.
- **Rationale:** `/status` already exists in the installed OpenCode environment.
  Reusing it would override or obscure existing behavior. `/state` more precisely
  describes the command's responsibility: reporting durable project state from
  authoritative artifacts and read-only repository inspection.
- **Consequences:**
  - the custom command file is `commands/state.md`;
  - the `project-progress` skill exposes a State procedure;
  - project documentation and tests use `/state`;
  - OpenCode's existing `/status` behavior remains untouched.

## DEC-041 — Deterministic Read-Only Git State Tool

- **Date:** 2026-08-04
- **Status:** accepted
- **Decision:** Implement a custom `git_state` tool for deterministic,
  read-only Git repository inspection. Project State, Session Recovery, and
  later Git lifecycle workflows will reuse this tool instead of independently
  executing general shell commands.
- **Rationale:** Repeated Bash permission prompts make read-only workflows noisy,
  while broad approval of `git *` would also authorize mutating operations. A
  fixed custom tool provides one reviewed inspection boundary and structured
  output.
- **Consequences:**
  - `git_state` accepts no arbitrary commands;
  - it performs no network or mutation operations;
  - `lead` may invoke it without general Bash approval;
  - `explore` remains unable to invoke it unless a later decision justifies
    access;
  - Git lifecycle mutations will use separate permission-gated mechanisms.
  - project-local custom tool directories are rejected by the hardened launcher so
    workspace code cannot replace or collide with an approved global tool;
  - unapproved MCP servers are rejected because their generated tool names could
    collide with approved custom-tool permissions;
  - future project-specific tools or MCP servers require an explicit design and
    guardrail revision.
  - repository-controlled Git hooks and FSMonitor commands are disabled during
    inspection;
  - Git lifecycle mutations will use separate permission-gated mechanisms;

## DEC-042 — Production Configuration and Trust Boundary

- **Date:** 2026-08-12
- **Status:** accepted
- **Decision:**
  - normal production use launches OpenCode directly with `opencode`;
  - `~/.config/opencode/` contains OpenCode Mentor behaviour, agents, commands,
    skills, tools, and normal user configuration;
  - `/etc/opencode/opencode.json`, deployed from `managed/opencode.json`, contains
    non-overridable safety policy;
  - `~/.agents/skills/` may provide shared personal skills, but `lead` may load
    only skill identifiers explicitly allowed by managed policy;
  - project-local OpenCode configuration is treated as trusted project
    configuration rather than as an adversarial sandbox boundary;
  - development launchers, validators, and test suites are development
    scaffolding rather than part of the production runtime architecture.
- **Rationale:** Production should use OpenCode normally without requiring a
  wrapper while preserving hard safety rules through OpenCode's managed
  configuration layer. Shared personal skills remain usable without implicitly
  granting every discovered skill to `lead`.
- **Consequences:**
  - production operation does not depend on `scripts/opencode-dev`;
  - managed permissions remain the hard capability boundary;
  - behavioural and workflow configuration remains under
    `~/.config/opencode/`;
  - newly implemented Mentor skills must be explicitly added to the managed
    `lead` skill allowlist;
  - development-only tests and scripts are removed before the final release,
    except for an installation/bootstrap script if one is ultimately required;
  - Mentor v1 does not claim to protect against malicious executable OpenCode
    configuration intentionally present in a repository.

## DEC-043 — Defer Dedicated Project Critic

- **Date:** 2026-08-12
- **Status:** accepted
- **Decision:** Do not implement `project-critic` in the first OpenCode Mentor
  version.
- **Rationale:** Current validation shows that `lead` with the
  `project-definition` workflow already provides the required critical analysis,
  clarification, and scope challenge. A separate critic has no demonstrated
  permission, context, or output-contract advantage.
- **Consequences:** Reconsider a dedicated critic only if practical use shows that
  independent critique materially improves definition quality.

## DEC-044 — Documentation Transaction Contract

- **Date:** 2026-08-12
- **Status:** partially superseded by DEC-045
- **Decision:**
  - documentation mutation uses one constrained preview/apply transaction;
  - `/docs`, `/define`, `/milestone`, and `/decision` may submit changes through
    that transaction while retaining their existing semantic ownership;
  - supported operations are create, replace, and delete;
  - preview stores an immutable proposal containing the complete intended
    resulting content;
  - revisions create a new proposal rather than modifying an existing one;
  - explicit approval applies only to the exact reviewed proposal;
  - apply accepts a proposal identifier and does not accept replacement content;
  - apply revalidates proposal integrity, workspace/session binding, path
    authority, and target freshness before mutation;
  - any stale or invalid target rejects the entire multi-file proposal before
    mutation;
  - handled application failures roll back already-applied changes;
  - applied proposals cannot be reused;
  - review presentation uses structured current/proposed Markdown rather than a
    side-by-side diff.
- **Rationale:** Documentation is the approved file-write exception, but generic
  editing would weaken source ownership and workflow boundaries. A shared
  transaction allows reviewed documentation changes to be applied exactly as
  approved while preserving deterministic authority and stale-target checks.
- **Consequences:**
  - generic editing remains denied;
  - project-artifact meaning remains owned by Project Definition, Milestone, and
    Decision workflows rather than `/docs`;
  - proposal storage is runtime state outside the project repository;
  - exact proposal-storage hierarchy and internal representation remain
    implementation decisions;
  - Documentation Transaction v1 does not require a graphical or side-by-side
    diff renderer.

## DEC-045 — Documentation Transaction Review Representation

- **Date:** 2026-08-13
- **Status:** accepted
- **Partially supersedes:** DEC-044
- **Decision:**
  - the authoritative Documentation Transaction proposal continues to store
    complete exact before/after content and checksums;
  - human review uses a deterministic unified diff generated by
    `documentation_preview` from those exact snapshots;
  - the diff is a review representation, not the Apply payload;
  - complete snapshots remain available for explicit inspection;
  - `documentation_apply` accepts only the exact proposal identifier and applies
    the persisted complete content.
- **Rationale:** A deterministic unified diff provides a concise human-review
  representation without weakening the exact-snapshot transaction model or
  allowing review content to become the mutation payload.
- **Consequences:**
  - the review-presentation requirement in DEC-044 is replaced by deterministic
    unified-diff presentation;
  - all other Documentation Transaction guarantees in DEC-044 remain effective;
  - approval remains bound to the exact current proposal;
  - Apply continues to revalidate and apply persisted complete content rather
    than reconstructed diff content.

## DEC-046 — Git Policy and Lifecycle Contract

- **Date:** 2026-08-13
- **Status:** accepted
- **Partially supersedes:** DEC-027
- **Decision:**
  - use `policies/git-defaults.toml` as the normal source of configurable global
    Git defaults and as the primary policy for the initial implementation;
  - support configurable base branch, branch naming and types, commit-message
    rules, merge strategy, branch update and rebase behaviour, validation
    profile, GitHub pull-request behaviour, and release enablement and defaults;
  - architecturally support optional sparse project overrides, without requiring
    or using them initially;
  - resolve policy deterministically: project scalars replace global scalars,
    arrays replace rather than append, known tables merge recursively, missing
    project values inherit global values, absence of project policy is valid,
    and unknown keys, invalid values, or unsupported schema versions fail
    validation;
  - use `main` as the default base branch while allowing a repository eventually
    to configure a different effective base branch;
  - allow only configured branch types, initially `feature`, `fix`, `docs`,
    `refactor`, `test`, and `chore`, with branch grammar
    `<type>/<kebab-case-summary>` and a lowercase kebab-case summary;
  - do not add `release`, `hotfix`, `ci`, `build`, or other branch categories
    unless later requirements justify them;
  - do not use Conventional Commits: commit subjects use clear, descriptive
    natural language in sentence case, contain no trailing period, avoid generic
    wording and unnecessary categorisation, and remain proportional to the
    coherent change;
  - reject known Conventional Commit-style type and scope prefixes
    deterministically, while reviewing semantic descriptiveness explicitly;
  - make commit bodies optional and use them only when they add material context,
    rationale, implementation detail, or consequences rather than repeating the
    subject;
  - preview the proposed commit message before committing;
  - use squash merge by default, rebase a working branch onto the effective base
    branch when policy requires an update before finalisation, allow
    `--force-with-lease` only after an approved rebase of an appropriate non-base
    branch, and delete the merged working branch by default;
  - keep immutable Git safety enforcement separate from configurable policy;
  - enforce immutable invariants independently: never commit directly to or
    force-push the effective protected base branch, never stage unrelated files
    automatically, inspect the intended final diff before commit, require
    explicit approval for mutating lifecycle operations, expose no arbitrary Git
    commands through constrained lifecycle tooling, and never bypass effective
    policy for convenience;
  - make the initial `standard` validation profile responsible for deterministic
    Git and lifecycle correctness, including current-branch validity, acceptable
    working-tree state, explicit staging selection, absence of unresolved
    conflicts, final staged-diff inspection, commit-message compliance, and
    effective-policy compliance;
  - keep arbitrary application-specific shell validation outside the initial Git
    policy engine and within the existing Development workflow and shell
    permission boundary;
  - support explicit release-enabled and release-disabled modes; default enabled
    releases use semantic versioning, `v` tags, and generated but reviewable
    release notes, while disabled releases allow finalisation and merging without
    assigning a semantic version, creating a release tag, or publishing a GitHub
    release;
  - never infer whether a repository should have releases; use the effective
    policy setting;
  - leave the next-version increment algorithm and exact release-note structure
    to the `/release` implementation work rather than deciding them here;
  - apply the implementation boundary: global Git defaults -> optional sparse
    project overrides -> deterministic policy resolution and validation ->
    effective Git policy -> immutable Git invariants -> allowed lifecycle
    operation.
- **Rationale:** The active milestone needs one deterministic contract for policy
  resolution, lifecycle semantics, validation, release behaviour, and immutable
  safety enforcement. Configurable defaults and non-overridable invariants have
  different authority and must not be conflated.
- **Consequences:**
  - the deterministic policy resolver and `/start`, `/checkpoint`, `/finish`, and
    `/release` implementations must follow this contract;
  - DEC-026 remains effective and is made concrete by this decision;
  - DEC-027 remains effective except that its hardcoded `main` protections are
    replaced by protections targeting the effective configured base branch;
  - the tentative Conventional Commits default in the approved definition is
    resolved in favour of descriptive natural-language commit messages;
  - project-specific overrides and sophisticated validation profiles remain
    deferred until practical use demonstrates sufficient value.

## DEC-047 — Git Start Lifecycle Contract

- **Date:** 2026-08-13
- **Status:** accepted
- **Decision:**
  - `/start` may create a working branch only while the repository is on the
    effective configured base branch with a valid named HEAD, no unresolved
    conflicts, and a completely clean working tree;
  - the target must be a new local branch that is not the effective base branch
    and complies with the effective branch-name policy;
  - `/start` uses an immutable, project-bound Preview/Apply transaction;
  - Preview performs deterministic policy resolution and repository preflight,
    persists the exact reviewed operation outside the repository, and performs no
    Git mutation;
  - Apply accepts only the exact reviewed proposal identifier, requires explicit
    approval and a separate permission gate, and revalidates proposal integrity,
    project binding, effective policy, current branch, HEAD, working-tree state,
    conflicts, and target-branch absence before mutation;
  - Apply creates and switches to only the reviewed local branch, verifies the
    resulting branch, HEAD, and working tree, marks the proposal single-use, and
    attempts constrained rollback after recoverable post-mutation failure;
  - `/start` does not stage, commit, push, fetch, pull, rebase, merge, open a pull
    request, tag, release, switch to an existing branch, or expose arbitrary Git
    commands.
- **Rationale:** Starting work from a clean effective base branch gives the new
  unit a deterministic origin and prevents unrelated or unfinished work from
  being carried implicitly into it. Immutable reviewed proposals preserve
  explicit approval while freshness revalidation prevents stale conversational
  intent from authorising a changed repository operation.
- **Consequences:**
  - repositories must clean or otherwise resolve existing work before `/start`;
  - starting from another working branch or reusing an existing branch is rejected
    rather than treated as a convenience shortcut;
  - policy or repository changes after Preview require a fresh proposal;
  - `/checkpoint`, `/finish`, and `/release` retain separate workflow and mutation
    boundaries.

## DEC-048 — Git Checkpoint Lifecycle Contract

- **Date:** 2026-08-14
- **Status:** accepted
- **Decision:**
  - `/checkpoint` handles one coherent validated unit through three separately
    reviewed and permission-gated transactions: Stage, Commit, and Push;
  - Stage Preview binds the effective policy, current working branch and HEAD,
    inspected working-tree state, and exact explicitly selected changed paths;
  - Stage Apply accepts only the exact reviewed proposal identifier, revalidates
    freshness, and stages only the reviewed whole-path selection; it does not
    commit or push;
  - every already-staged path must be included in the explicit Stage selection,
    while unselected unstaged changes may remain and must not be staged implicitly;
  - Commit Preview occurs only after staging, shows the final staged diff and
    proposed commit message, and binds their exact checksums together with the
    effective policy, branch, and pre-commit HEAD;
  - Commit Apply revalidates all bound state and commits exactly the reviewed
    index with the reviewed message; it does not stage additional content or push;
  - Push Preview occurs only after commit and binds the exact local commit,
    working branch, explicitly supplied remote, and destination branch;
  - the remote must always be supplied explicitly and must never be inferred as
    `origin` or from another repository convention;
  - Push Apply revalidates the reviewed local and remote state and performs only a
    normal non-force push of the reviewed commit to the reviewed destination; it
    does not establish or change upstream configuration implicitly;
  - each Preview is read-only and persists an immutable project-bound proposal
    outside the repository; each Apply requires explicit approval, a separate
    permission gate, integrity and freshness revalidation, and single-use
    enforcement;
  - `/checkpoint` does not fetch, pull, rebase, merge, force-push, switch branches,
    open a pull request, tag, release, or expose arbitrary Git commands.
- **Rationale:** Staging must finish before the exact final staged diff can be
  reviewed, committing must finish before the exact pushed commit exists, and a
  remote must be deliberate rather than guessed. Separate transactions preserve
  meaningful review and approval at each mutation boundary.
- **Consequences:**
  - a combined stage-and-commit Apply is prohibited;
  - a combined commit-and-push Apply is prohibited;
  - partial-hunk selection is outside the initial checkpoint implementation;
  - changes to selected paths, policy, branch, HEAD, staged diff, commit message,
    local commit, remote, or destination after the relevant Preview require a new
    proposal;
  - application-specific validation remains outside constrained Git tooling and
    must be completed or explicitly assessed before checkpoint mutation begins.

## DEC-049 — Git Finish Lifecycle Contract

- **Date:** 2026-08-16
- **Status:** accepted
- **Decision:**
  - `/finish` finalises one working branch through three separately reviewed and
    permission-gated transactions: Update, Publish, and Pull Request;
  - all transactions require a valid non-base working branch, clean working tree,
    named HEAD, no unresolved conflicts, no active Git operation, and valid
    effective policy;
  - Update requires an explicit remote, derives the base branch from effective
    policy, and binds the exact remote URL, local HEAD, and advertised remote base
    tip;
  - Update Apply fetches only the reviewed base tip and rebases the current branch
    onto that exact commit when required by policy;
  - recoverable Update failures restore the original branch state, while
    unresolved recovery state is reported explicitly;
  - Publish targets the same-name remote branch and binds the exact local commit,
    remote URL, and expected remote branch tip;
  - Publish uses a normal push when possible and permits exact
    `--force-with-lease` only when required by a successful approved Update;
  - Publish never force-pushes the effective base branch and never creates or
    changes upstream tracking;
  - Pull Request binds repository identity, base and head branches, exact
    published commit, title, body, and policy-controlled draft state;
  - an existing matching pull request is returned rather than duplicated, while
    conflicting or ambiguous existing pull-request state is rejected;
  - Pull Request Apply creates through local `gh` and verifies the resulting pull
    request;
  - every Preview is read-only and persists an immutable project-bound proposal;
    every Apply requires separate explicit approval, permission, integrity
    validation, freshness revalidation, and single-use enforcement;
  - remote Publish and Pull Request outcomes are non-rollbackable and must report
    whether mutation and verification completed;
  - `/finish` does not merge, delete branches, tag, release, modify the effective
    base branch, or expose arbitrary Git or GitHub commands.
- **Rationale:** Rebasing, publishing rewritten history, and creating a pull
  request have different review requirements, mutation risks, and recovery
  properties. Separate transactions preserve meaningful approval while binding
  every local and remote mutation to exact reviewed state.
- **Consequences:**
  - Update, Publish, and Pull Request cannot share one combined Apply;
  - the remote is always explicit, while the base branch comes only from
    effective policy;
  - force-with-lease requires persisted provenance from an approved Update;
  - Pull Request title and body remain reviewable exact inputs;
  - authentication must already be available to non-interactive Git and `gh`
    subprocesses;
  - `/release` retains separate merge, branch deletion, versioning, tagging, and
    publication boundaries.
