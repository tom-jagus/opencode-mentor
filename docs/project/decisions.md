---
title: OpenCode Workflow Decisions
status: active
updated_at: 2026-08-03
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
- **Status:** superseded bu DEC-036
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
- **Status:** accepted
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
- **Status:** accepted
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
