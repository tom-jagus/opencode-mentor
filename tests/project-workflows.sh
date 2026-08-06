#!/usr/bin/env bash

set -euo pipefail

readonly script_dir="$(
  CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd
)"
readonly repo_root="$(
  CDPATH='' cd -- "$script_dir/.." && pwd
)"

readonly command_file="$repo_root/commands/state.md"
readonly legacy_command_file="$repo_root/commands/status.md"
readonly skill_file="$repo_root/skills/project-progress/SKILL.md"
readonly definition_file="$repo_root/docs/project/definition.md"
readonly progress_file="$repo_root/docs/project/progress.md"
readonly decisions_file="$repo_root/docs/project/decisions.md"
readonly launcher="$repo_root/scripts/opencode-dev"

pass_count=0
fail_count=0

pass() {
  printf 'PASS: %s\n' "$1"
  pass_count=$((pass_count + 1))
}

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  fail_count=$((fail_count + 1))
}

assert_file() {
  local path="$1"
  local description="$2"

  if [[ -f "$path" ]]; then
    pass "$description"
  else
    fail "$description"
  fi
}

assert_absent() {
  local path="$1"
  local description="$2"

  if [[ ! -e "$path" ]]; then
    pass "$description"
  else
    fail "$description"
  fi
}

assert_contains() {
  local path="$1"
  local expected="$2"
  local description="$3"

  if [[ -f "$path" ]] && grep -Fq -- "$expected" "$path"; then
    pass "$description"
  else
    fail "$description"
  fi
}

assert_not_contains() {
  local path="$1"
  local unexpected="$2"
  local description="$3"

  if [[ -f "$path" ]] && ! grep -Fq -- "$unexpected" "$path"; then
    pass "$description"
  else
    fail "$description"
  fi
}

printf 'Running Project Workflows tests\n\n'

assert_file \
  "$command_file" \
  'state command exists'

assert_absent \
  "$legacy_command_file" \
  'custom status command is not defined'

assert_file \
  "$skill_file" \
  'project-progress skill exists'

assert_contains \
  "$command_file" \
  'agent: lead' \
  'state command routes through lead'

assert_contains \
  "$command_file" \
  'project-progress' \
  'state command loads project-progress'

assert_contains \
  "$command_file" \
  'State procedure' \
  'state command selects the State procedure'

assert_contains \
  "$command_file" \
  'read-only' \
  'state command declares read-only operation'

assert_contains \
  "$skill_file" \
  'name: project-progress' \
  'skill name matches its directory'

assert_contains \
  "$skill_file" \
  '## State Procedure' \
  'skill defines the State procedure'

assert_contains \
  "$skill_file" \
  '## State Output Contract' \
  'skill defines the State output contract'

assert_contains \
  "$skill_file" \
  'docs/project/definition.md' \
  'skill references definition artifact'

assert_contains \
  "$skill_file" \
  'docs/project/progress.md' \
  'skill references progress artifact'

assert_contains \
  "$skill_file" \
  'docs/project/decisions.md' \
  'skill references decision artifact'

assert_contains \
  "$skill_file" \
  'Milestone transitions and decision recording remain inactive' \
  'skill keeps mutating procedures inactive'

assert_contains \
  "$definition_file" \
  '/state' \
  'definition contains the state command'

assert_not_contains \
  "$definition_file" \
  '/status' \
  'definition no longer specifies the status command'

assert_contains \
  "$decisions_file" \
  'DEC-040' \
  'decision register records the state-command rename'

assert_contains \
  "$progress_file" \
  'active_milestone: project-workflows' \
  'progress frontmatter identifies Project Workflows'

assert_contains \
  "$skill_file" \
  'Do not inspect the type, metadata, contents, ownership, or purpose' \
  'state procedure does not investigate changed paths'

assert_contains \
  "$skill_file" \
  'An unusual filename is not by itself a blocker' \
  'state procedure treats unusual paths as ordinary repository state'

assert_contains \
  "$skill_file" \
  'Do not run additional commands or tools to inspect paths' \
  'git state output is sufficient for path reporting'

runtime_root="$(mktemp -d)"
trap 'rm -rf -- "$runtime_root"' EXIT

raw_config="$runtime_root/resolved-config.raw"
resolved_config="$runtime_root/resolved-config.json"
config_stderr="$runtime_root/resolved-config.stderr"

if OPENCODE_DEV_RUNTIME="$runtime_root/runtime" \
  "$launcher" debug config >"$raw_config" 2>"$config_stderr"; then
  pass 'development launcher resolves configuration'
else
  fail 'development launcher resolves configuration'
  cat "$config_stderr" >&2
fi

# The launcher validator prints its PASS message before OpenCode emits JSON.
# Retain everything beginning with the first JSON object.
awk '
  found || /^[[:space:]]*\{/ {
    found = 1
    print
  }
' "$raw_config" >"$resolved_config"

if jq empty "$resolved_config" >/dev/null 2>&1; then
  pass 'resolved OpenCode configuration is valid JSON'
else
  fail 'resolved OpenCode configuration is valid JSON'
fi

if jq -e '.command.state != null' "$resolved_config" >/dev/null 2>&1; then
  pass 'state command is discovered at runtime'
else
  fail 'state command is discovered at runtime'
fi

if jq -e '.command.state.agent == "lead"' \
  "$resolved_config" >/dev/null 2>&1; then
  pass 'resolved state command targets lead'
else
  fail 'resolved state command targets lead'
fi

if jq -e '
  .command.state.template
  | type == "string"
    and contains("project-progress")
' "$resolved_config" >/dev/null 2>&1; then
  pass 'resolved state command loads project-progress'
else
  fail 'resolved state command loads project-progress'
fi

printf '\nProject Workflows tests: %d passed, %d failed\n' \
  "$pass_count" \
  "$fail_count"

if ((fail_count > 0)); then
  exit 1
fi
