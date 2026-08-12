# Development Guide

## Purpose

Describe how OpenCode Mentor is structured, how production configuration is
separated from immutable policy, and how changes to the configuration repository
should be developed safely.

OpenCode Mentor uses a proposal-only development model in which the LLM guides,
challenges, investigates, and reviews source changes while the user remains
responsible for entering source modifications manually.

## Production Architecture

```text
opencode-mentor repository
        |
        +-- normal configuration ----------> ~/.config/opencode/
        |
        +-- managed/opencode.json ---------> /etc/opencode/opencode.json

optional shared personal skills
        |
        +-------------------------------> ~/.agents/skills/

runtime
        |
        +-------------------------------> opencode
```

Production use does not require a launcher or wrapper. Normal sessions are
started directly with:

```bash
opencode
```

The OpenCode Mentor repository remains the source of truth for the configuration
that is deployed into the user and managed OpenCode locations.

## Configuration Ownership

### `~/.config/opencode`

Contains normal OpenCode Mentor configuration, including:

- `AGENTS.md`;
- `opencode.json`;
- `tui.json`;
- agents;
- commands;
- skills;
- tools;
- policies and other normal configuration assets.

This layer owns behaviour, workflow procedures, user-facing commands, agent
prompts, deterministic helper tools, and ordinary OpenCode preferences.

It must not duplicate managed safety rules unless duplication is required for
clarity and does not create a competing source of truth.

### `/etc/opencode/opencode.json`

Contains non-overridable safety policy deployed from:

```text
managed/opencode.json
```

The managed layer owns capability restrictions rather than workflow behaviour.

Current managed responsibilities include:

- `lead` as the default primary agent;
- disabling broad built-in modifying agents such as `build`, `plan`, and
  `general`;
- deny-by-default permissions;
- generic source-edit denial;
- permission-gated Bash access for `lead`;
- restricted delegation;
- read-only `explore` permissions;
- deny-by-default skill access with explicit trusted-skill allowlisting;
- controlled access to reviewed custom tools.

Managed configuration must remain focused on restrictions that project or user
configuration must not be able to weaken.

### `~/.agents/skills`

May contain shared personal skills used across tools and agents.

OpenCode Mentor does not treat every discovered shared skill as automatically
trusted. `lead` may load only skill identifiers explicitly allowed by managed
policy.

Shared personal skills remain outside the OpenCode Mentor repository unless a
future decision explicitly moves one into the Mentor-owned workflow surface.

## Agent and Permission Model

### `lead`

`lead` is the normal user-facing primary agent.

Its behaviour and workflow routing live in:

```text
agents/lead.md
```

Hard capability restrictions live in managed configuration.

`lead`:

- maintains the main conversation;
- selects the active workflow;
- reasons directly by default;
- loads approved skills;
- delegates only when bounded investigation, independent context,
  specialisation, or different permissions materially improve the result;
- integrates delegated findings back into the main conversation.

Generic source-editing tools remain denied.

Bash remains permission-gated by design. It may be used where an approved
workflow permits it, but it must not be used as a bypass around source ownership.

New Mentor skills are deny-by-default until their identifiers are explicitly
added to the managed `lead` skill allowlist.

### `explore`

`explore` is retained as a constrained read-only repository-investigation
subagent.

Its responsibilities are limited to bounded inspection using capabilities such
as:

```text
read
glob
grep
list
```

It does not receive generic editing, Bash, delegation, or unrelated workflow
capabilities.

Broad built-in agents that conflict with the Mentor interaction model remain
disabled.

## Global Operating Contract

Stable personal behaviour lives in:

```text
AGENTS.md
```

The global operating contract defines principles that should apply across
workflows, including:

- challenging weak assumptions rather than agreeing automatically;
- distinguishing facts, assumptions, inferences, and recommendations;
- preferring clarity, maintainability, repeatability, and practical value;
- respecting authoritative project artifacts;
- preserving source ownership;
- separating inspection from mutation;
- requiring explicit intent for mutating operations;
- keeping delegation deliberate and bounded.

Detailed workflow procedures do not belong in `AGENTS.md`. They are owned by
skills, commands, policies, and constrained tools.

## Source and Mutation Model

Source-code changes remain proposal-only.

OpenCode Mentor may:

- inspect source files;
- investigate repository context;
- propose source changes in code blocks;
- explain important implementation choices;
- reread files after the user applies a proposed change;
- identify implementation or transcription errors;
- provide corrected fragments;
- recommend validation commands.

The user remains responsible for entering source modifications manually.

Documentation is the normal write exception. The Documentation Transaction
workflow will use constrained preview and apply tools so reviewed documentation
can be modified without enabling generic editing.

Later Git and vault workflows similarly use narrow deterministic tools where
mutation or policy enforcement requires them.

Mutating workflows require explicit user intent and the applicable permission
boundary.

## Project Context

Configured projects may maintain authoritative durable state in:

```text
docs/project/definition.md
docs/project/progress.md
docs/project/decisions.md
```

These files have distinct responsibilities:

- `definition.md` owns approved scope, objectives, constraints, architecture,
  acceptance criteria, and planned phases;
- `progress.md` owns current operational state, milestone status, blockers,
  open questions, and next action;
- `decisions.md` owns durable append-oriented decision history.

Implemented project workflows currently include:

```text
/define
/resume
/develop
/state
/milestone
/decision
```

Workflow selection is coordinated by `lead` and follows the approved routing
precedence.

## Trusted Project Configuration

Project-local OpenCode configuration is treated as trusted project configuration.

OpenCode Mentor's managed policy provides the hard capability boundary for the
reviewed Mentor environment, but Mentor is not an operating-system sandbox for
deliberately malicious executable configuration, native programs, shell
interpreters, plugins, or compromised OpenCode binaries.

This trust boundary is intentional.

Normal repository instructions and project configuration may influence project
behaviour, while non-overridable Mentor safety policy remains under the managed
OpenCode configuration layer.

## Deterministic Custom Tools

Custom tools are used when a capability needs a narrow deterministic interface
that should not depend on free-form shell execution or model interpretation.

The current example is:

```text
git_state
```

`git_state` provides structured, read-only local Git repository state for
Project State, Session Recovery, and later Git workflows.

Its permission boundary is intentionally asymmetric:

```text
global default: deny
lead:           allow
explore:        deny
```

Future custom tools should follow the same principle: introduce a reviewed,
purpose-specific interface only when it materially improves safety,
determinism, or workflow quality.

## Development Workflow

Development occurs on feature branches rather than directly on `main`.

Changes should be implemented as coherent, reviewable units.

A normal development unit is:

```text
understand the task
-> inspect relevant context
-> propose one coherent source change
-> user applies the source change manually
-> reread the implementation
-> identify errors or omissions
-> recommend appropriate validation
-> review the completed unit
-> checkpoint when validated
```

Source changes proposed by OpenCode remain manually applied.

Validation should be proportional to the change. Configuration syntax,
permission behaviour, runtime discovery, deterministic tool behaviour, and
workflow semantics should be checked when relevant.

The final diff for a coherent unit should be reviewed before it is committed.

## Temporary Development Scaffolding

During active development the repository may contain launchers, validators,
test suites, temporary fixtures, or other scaffolding used to establish and
verify the configuration model.

These components are development aids, not production runtime dependencies.

The current project has used isolated launchers and automated regression suites
to validate:

- managed permission precedence;
- agent restrictions;
- workflow discovery and routing;
- project bootstrap behaviour;
- deterministic Git-state handling;
- semantic workflow behaviour.

Their existence during development does not make them part of the final runtime
architecture.

Before the final release, development-only tests and scripts should be removed
unless a specific component remains necessary for installation or bootstrap.

An installation/bootstrap script may be retained if the Live Deployment and
Dotfiles Integration milestone determines that one is required.

## OpenCode Compatibility

OpenCode is an external dependency and its behaviour may evolve.

An OpenCode upgrade requires deliberate review when it materially changes:

- configuration precedence;
- managed configuration behaviour;
- available built-in agents;
- permission semantics;
- skill discovery;
- command discovery;
- custom-tool behaviour;
- plugin or MCP behaviour;
- other capability surfaces relied on by Mentor.

Managed policy must not be weakened merely to make a new OpenCode version work.

If an upgrade changes a relevant capability boundary, the new behaviour should
be understood first and the Mentor configuration adjusted deliberately.

## Planned Workflow Layers

OpenCode Mentor is implemented incrementally.

### Project Workflows

Implemented:

```text
/define
/resume
/develop
/state
/milestone
/decision
```

These workflows establish project definition, durable state, guided
development, session recovery, milestone transitions, and durable decisions.

### Documentation Transaction

Planned capabilities include:

- documentation proposal generation;
- reviewable previews and diffs;
- proposal identifiers;
- checksum and stale-target validation;
- atomic multi-file application;
- constrained documentation paths;
- `/docs`.

### Git Policy and Lifecycle

Planned capabilities include:

- global Git policy defaults;
- optional project overrides;
- deterministic policy merging;
- branch and commit validation;
- `/start`;
- `/checkpoint`;
- `/finish`;
- `/release`;
- local GitHub CLI integration.

### Vault Curation

Planned capabilities include:

- vault taxonomy and templates;
- project navigation notes;
- duplicate handling;
- constrained preview and apply tools;
- `/note`;
- mediated project-to-vault updates.

### Research

Research remains a later workflow.

Research output must be validated before any optional publication into the
vault.

## Live Deployment

Live deployment is delivered by the dedicated Live Deployment and Dotfiles
Integration milestone.

That milestone determines:

- the final non-duplicating repository linkage mechanism;
- deployment of normal Mentor configuration into `~/.config/opencode`;
- deployment of `managed/opencode.json` to
  `/etc/opencode/opencode.json`;
- installation or bootstrap automation if required;
- dotfiles or chezmoi integration;
- Herdr integration restoration;
- controlled live verification.

The intended production runtime remains:

```bash
opencode
```

No wrapper is required for normal use.

## Safety Boundary

OpenCode Mentor provides a controlled OpenCode workflow and permission model.

The hard capability boundary is supplied by managed OpenCode configuration and
purpose-specific constrained tools where necessary.

Behavioural rules remain important for workflow semantics, source ownership,
and intent interpretation, but prompt instructions are not treated as the sole
security boundary.

OpenCode Mentor is not an operating-system sandbox and must not be treated as
containment for deliberately malicious native programs, executable project
configuration, shell interpreters, plugins, or compromised OpenCode binaries.
