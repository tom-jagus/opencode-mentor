# Development Guide

## Purpose

**OpenCode Mentor** is a personal, version-controlled OpenCode configuration and
operating workflow.

It implements a proposal-only development model in which the LLM guides,
challenges, investigates, and reviews work but never directly modifies source
code.

OpenCode Mentor currently provides:

* one normal user-facing primary agent named `lead`;
* stable global operating instructions;
* constrained read-only repository investigation through `explore`;
* deny-by-default tool permissions;
* protection against project-level configuration weakening;
* isolated development and validation;
* repeatable adversarial guardrail tests.

The repository is developed and tested independently from the live OpenCode
configuration.

## Current Deployment Status

OpenCode Mentor is currently used only through the isolated development launcher.

The following live-system changes are intentionally deferred:

* replacing `~/.config/opencode` with a repository link;
* installing managed configuration under `/etc/opencode`;
* integrating the repository with dotfiles or chezmoi;
* reinstalling the Herdr OpenCode integration;
* migrating authentication, sessions, or other runtime state;
* using OpenCode Mentor for normal daily OpenCode work.

The existing live OpenCode configuration must remain unchanged until an accepted
first version is ready for live testing.

## Prerequisites

Development currently requires:

```text
bash
git
jq
opencode
```

OpenCode Mentor was initially developed against OpenCode `1.18.10`.

An OpenCode upgrade must be treated as a compatibility change. The guardrail
validator intentionally fails when the resolved agent surface or permission
model differs from the reviewed baseline.

## Repository Layout

```text
opencode-mentor/
├── AGENTS.md
├── README.md
├── agents/
│   └── lead.md
├── docs/
│   ├── development.md
│   └── project/
│       ├── decisions.md
│       ├── definition.md
│       └── progress.md
├── managed/
│   └── opencode.json
├── scripts/
│   ├── opencode-dev
│   └── validate-opencode-config
├── tests/
│   └── guardrails.sh
├── opencode.json
└── tui.json
```

### `opencode.json`

Contains normal OpenCode preferences that do not require immutable enforcement.

The root configuration must not duplicate managed safety rules.

### `managed/opencode.json`

Contains non-overridable guardrails, including:

* `lead` as the default primary agent;
* disabled `build`, `plan`, and `general` agents;
* deny-by-default permissions;
* source-edit denial;
* permission-gated shell access for `lead`;
* restricted delegation;
* read-only `explore` permissions.

During isolated development, the launcher injects this file at a higher
configuration precedence.

During eventual live deployment, the file will be installed as the Linux managed
OpenCode configuration.

### `AGENTS.md`

Contains stable global operating behaviour shared across workflows.

Detailed workflow procedures do not belong in this file. They will be introduced
later through skills, commands, policies, and constrained tools.

### `agents/lead.md`

Defines `lead`, the only normal user-facing primary agent.

`lead` maintains the main conversation, selects the current workflow, reasons
directly by default, and delegates only when bounded investigation or separate
permissions justify it.

### `scripts/opencode-dev`

Starts OpenCode Mentor in an isolated development environment.

It:

* resolves the configuration repository relative to the script location;
* separates configuration, data, cache, and state directories;
* prevents the live user configuration from loading;
* loads repository components;
* injects managed guardrails;
* disables external plugins with `--pure`;
* rejects `--auto`;
* rejects explicit `--agent` selection;
* validates the resolved configuration before starting OpenCode.

### `scripts/validate-opencode-config`

Validates the effective merged OpenCode configuration.

It fails closed when:

* `lead` is not the default agent;
* modifying built-in agents are enabled;
* `lead` can edit or write files;
* `lead` receives automatically approved Bash access;
* `explore` gains modifying or delegation tools;
* an unexpected agent appears;
* an expected agent disappears;
* an OpenCode change alters the reviewed permission surface.

### `tests/guardrails.sh`

Runs black-box integration tests through the hardened development launcher.

It tests the complete OpenCode Mentor execution path rather than individual
configuration files in isolation.

## Configuration Model

OpenCode Mentor separates ordinary configuration from immutable policy.

```text
normal preferences
└── opencode.json

immutable policy
└── managed/opencode.json
```

The development launcher loads repository configuration and then injects the
managed policy at a higher runtime precedence.

The resolved configuration is validated before the requested OpenCode command is
executed.

This separation prevents harmless preferences and hard safety rules from
becoming one undifferentiated configuration file.

## Permission Model

OpenCode permissions are deny-by-default for configured user-facing agents.

### `lead`

`lead` may use explicitly reviewed capabilities such as:

* questions;
* file reading;
* file discovery and searching;
* permission-gated Bash;
* constrained delegation to `explore`;
* web research;
* task tracking;
* approved skills.

`lead` may not use generic source-editing tools.

Source changes remain proposal-only and must be entered manually by the user.

After the user enters a proposed change, `lead` may reread the affected files,
identify implementation or transcription errors, and provide corrected
fragments. It must not apply those corrections directly.

### `explore`

`explore` is restricted to repository investigation.

It may use:

```text
read
glob
grep
list
```

It may not use:

```text
edit
write
apply_patch
bash
task
webfetch
websearch
skill
```

### Disabled Agents

The following broad built-in agents are disabled:

```text
build
plan
general
```

Hidden OpenCode system agents such as `compaction`, `summary`, and `title` may
remain present because they are internal runtime components rather than normal
user-facing agents.

## Running the Isolated Launcher

The launcher can be invoked from any test workspace:

```bash
$HOME/dev/personal/opencode-mentor/scripts/opencode-dev
```

It can also run OpenCode diagnostic commands:

```bash
$HOME/dev/personal/opencode-mentor/scripts/opencode-dev debug paths
```

```bash
$HOME/dev/personal/opencode-mentor/scripts/opencode-dev debug config
```

```bash
$HOME/dev/personal/opencode-mentor/scripts/opencode-dev agent list
```

```bash
$HOME/dev/personal/opencode-mentor/scripts/opencode-dev debug agent lead
```

```bash
$HOME/dev/personal/opencode-mentor/scripts/opencode-dev debug agent explore
```

The default isolated runtime root is:

```text
~/.local/share/opencode-workflow-dev
```

A different runtime root can be supplied for a single invocation:

```bash
OPENCODE_DEV_RUNTIME=/tmp/opencode-mentor-runtime \
  $HOME/dev/personal/opencode-mentor/scripts/opencode-dev debug config
```

Runtime files must not be stored inside the OpenCode Mentor repository.

## Running Guardrail Tests

From the repository root:

```bash
tests/guardrails.sh
```

The suite currently reports:

```text
All 21 guardrail checks passed.
```

The number may change as tests are added or removed. Every named check and the
final zero exit status matter more than the fixed count.

The suite covers:

1. a clean workspace;
2. the approved agent surface;
3. `lead` permissions;
4. read-only `explore` permissions;
5. hostile project permission overrides;
6. invalid project default-agent settings;
7. re-enabled modifying built-in agents;
8. hostile changes to `lead`;
9. hostile changes to `explore`;
10. injected project-defined primary agents;
11. the prohibited `--auto` option;
12. prohibited explicit agent selection.

## Verifying That Tests Detect Regressions

A temporary intentional regression can be used to prove the suite fails.

For example, change the managed `explore` Bash permission from:

```json
"bash": "deny"
```

to:

```json
"bash": "ask"
```

Then run:

```bash
tests/guardrails.sh
```

The clean-workspace validation must fail.

Restore the original denial immediately and confirm:

```bash
git diff -- managed/opencode.json
tests/guardrails.sh
```

The Git diff for `managed/opencode.json` must be empty, and the complete suite
must pass again.

Intentional regressions must never be committed.

## Development Workflow

Work must happen on a feature branch rather than directly on `main`.

For each coherent implementation unit:

1. inspect the current branch and working tree;
2. make the proposed source changes manually;
3. validate syntax;
4. run the relevant integration tests;
5. inspect the complete diff;
6. stage only related files;
7. inspect the staged diff;
8. create one semantic checkpoint commit.

Minimum validation before a guardrail-related commit:

```bash
jq empty opencode.json
jq empty managed/opencode.json

bash -n scripts/opencode-dev
bash -n scripts/validate-opencode-config
bash -n tests/guardrails.sh

git diff --check
tests/guardrails.sh
```

Before committing:

```bash
git status --short --branch
git diff --stat
git diff
```

After staging:

```bash
git diff --cached --check
git diff --cached --stat
git diff --cached
```

## Expected Failure Behaviour

The launcher and validator are designed to fail closed.

### Unexpected agent

```text
OpenCode guardrail validation failed: unexpected or missing agents
```

Review the resolved agent list before changing the approved baseline.

### Unsafe `lead`

```text
OpenCode guardrail validation failed: lead permissions are unsafe
```

Inspect the resolved `lead` permission order and tool availability.

### Unsafe `explore`

```text
OpenCode guardrail validation failed: explore permissions are unsafe
```

Confirm that Bash, editing, delegation, and unrelated tools remain denied.

### Prohibited auto-approval

```text
Error: --auto is prohibited by the hardened launcher
```

Auto-approval is incompatible with the required permission model.

### Explicit agent selection

```text
Error: agent selection is controlled by the hardened configuration
```

Normal sessions must start through `lead`.

## OpenCode Upgrade Procedure

Before accepting an OpenCode upgrade:

1. install or select the candidate version outside normal live use;
2. run the complete guardrail suite;
3. inspect any changed agent or permission output;
4. determine whether new capabilities should remain denied;
5. update the managed allowlist only after deliberate review;
6. record material policy changes in the decision register;
7. commit compatibility changes separately.

The validator must not be weakened merely to make a new version pass.

## Deferred Live Deployment

Live deployment will be implemented only after OpenCode Mentor reaches an
accepted first version.

The expected deployment sequence is:

1. finish and review the configuration feature branch;
2. merge the accepted revision into `main`;
3. ensure the repository checkout is clean and on `main`;
4. install `managed/opencode.json` under `/etc/opencode/opencode.json`;
5. move the existing live OpenCode configuration to a backup location;
6. link `~/.config/opencode` to the accepted OpenCode Mentor checkout;
7. reinstall the Herdr-managed OpenCode plugin;
8. validate the managed and user configuration layers;
9. run the guardrail suite against the deployed topology;
10. perform controlled live functional testing.

Dotfiles or chezmoi integration belongs to this deployment phase, not to isolated
configuration development.

## Safety Boundary

OpenCode Mentor guardrails enforce configuration precedence, agent availability,
and OpenCode tool permissions.

They are not an operating-system sandbox.

The configuration protects against accidental mutation and project-level
permission weakening within the reviewed OpenCode execution model. It must not be
treated as containment for deliberately malicious native programs, shell
interpreters, or compromised OpenCode binaries.
