#!/usr/bin/env bash

set -euo pipefail

readonly script_dir="$(
  CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd
)"
readonly repo_root="$(
  CDPATH='' cd -- "$script_dir/.." && pwd
)"
readonly state_command_file="$repo_root/commands/state.md"
readonly resume_command_file="$repo_root/commands/resume.md"
readonly develop_command_file="$repo_root/commands/develop.md"
readonly legacy_command_file="$repo_root/commands/status.md"

readonly project_progress_skill_file="$repo_root/skills/project-progress/SKILL.md"
readonly development_skill_file="$repo_root/skills/development/SKILL.md"
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
  "$state_command_file" \
  'state command exists'

assert_absent \
  "$legacy_command_file" \
  'custom status command is not defined'

assert_file \
  "$project_progress_skill_file" \
  'project-progress skill exists'

assert_contains \
  "$state_command_file" \
  'agent: lead' \
  'state command routes through lead'

assert_contains \
  "$state_command_file" \
  'project-progress' \
  'state command loads project-progress'

assert_contains \
  "$state_command_file" \
  'State procedure' \
  'state command selects the State procedure'

assert_contains \
  "$state_command_file" \
  'read-only' \
  'state command declares read-only operation'

assert_contains \
  "$project_progress_skill_file" \
  'name: project-progress' \
  'skill name matches its directory'

assert_contains \
  "$project_progress_skill_file" \
  '## State Procedure' \
  'skill defines the State procedure'

assert_contains \
  "$project_progress_skill_file" \
  '## State Output Contract' \
  'skill defines the State output contract'

assert_contains \
  "$project_progress_skill_file" \
  'docs/project/definition.md' \
  'skill references definition artifact'

assert_contains \
  "$project_progress_skill_file" \
  'docs/project/progress.md' \
  'skill references progress artifact'

assert_contains \
  "$project_progress_skill_file" \
  'docs/project/decisions.md' \
  'skill references decision artifact'

assert_contains \
  "$project_progress_skill_file" \
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
  "$project_progress_skill_file" \
  'Do not inspect the type, metadata, contents, ownership, or purpose' \
  'state procedure does not investigate changed paths'

assert_contains \
  "$project_progress_skill_file" \
  'An unusual filename is not by itself a blocker' \
  'state procedure treats unusual paths as ordinary repository state'

assert_contains \
  "$project_progress_skill_file" \
  'Do not run additional commands or tools to inspect paths' \
  'git state output is sufficient for path reporting'

assert_file \
  "$resume_command_file" \
  'resume command exists'

assert_contains \
  "$resume_command_file" \
  'agent: lead' \
  'resume command routes through lead'

assert_contains \
  "$resume_command_file" \
  'project-progress' \
  'resume command loads project-progress'

assert_contains \
  "$resume_command_file" \
  'Resume procedure' \
  'resume command selects the Resume procedure'

assert_contains \
  "$resume_command_file" \
  'read-only' \
  'resume command declares read-only operation'

assert_contains \
  "$resume_command_file" \
  'accepts no arguments' \
  'resume command rejects arguments'

assert_contains \
  "$resume_command_file" \
  'Do not use Bash' \
  'resume command prohibits Bash'

assert_contains \
  "$resume_command_file" \
  'rather than relying on prior conversation history' \
  'resume reconstructs context from durable state'

assert_contains \
  "$project_progress_skill_file" \
  '## Resume Procedure' \
  'project-progress defines the Resume procedure'

assert_contains \
  "$project_progress_skill_file" \
  '## Resume Output Contract' \
  'project-progress defines the Resume output contract'

assert_contains \
  "$project_progress_skill_file" \
  '## Resume Completion Condition' \
  'project-progress defines Resume completion'

assert_contains \
  "$project_progress_skill_file" \
  'Call the `git_state` tool exactly once.' \
  'Resume requires deterministic Git state inspection'

assert_contains \
  "$project_progress_skill_file" \
  '**ready with issues**' \
  'Resume defines degraded recovery state'

assert_contains \
  "$project_progress_skill_file" \
  'Never present an inferred recommendation as though it were already recorded' \
  'Resume separates recorded state from inference'

assert_file \
  "$develop_command_file" \
  'develop command exists'

assert_file \
  "$development_skill_file" \
  'development skill exists'

assert_contains \
  "$develop_command_file" \
  'agent: lead' \
  'develop command routes through lead'

assert_contains \
  "$develop_command_file" \
  'development' \
  'develop command loads development skill'

assert_contains \
  "$develop_command_file" \
  'Development procedure' \
  'develop command selects the Development procedure'

assert_contains \
  "$develop_command_file" \
  '$ARGUMENTS' \
  'develop command forwards its arguments'

assert_contains \
  "$develop_command_file" \
  'proposal-only' \
  'develop command preserves manual source ownership'

assert_contains \
  "$development_skill_file" \
  'name: development' \
  'development skill name matches its directory'

assert_contains \
  "$development_skill_file" \
  'workflow: development' \
  'development skill declares its workflow metadata'

assert_contains \
  "$development_skill_file" \
  '## Source Ownership Boundary' \
  'development defines source ownership boundary'

assert_contains \
  "$development_skill_file" \
  '## Development Procedure' \
  'development skill defines the Development procedure'

assert_contains \
  "$development_skill_file" \
  '### 9. Stop for manual application' \
  'development stops before user source application'

assert_contains \
  "$development_skill_file" \
  '### 10. Reread the implemented change' \
  'development rereads manually entered source'

assert_contains \
  "$development_skill_file" \
  'transcription issue' \
  'development distinguishes transcription errors'

assert_contains \
  "$development_skill_file" \
  'implementation issue' \
  'development distinguishes implementation errors'

assert_contains \
  "$development_skill_file" \
  '## Development Proposal Output Contract' \
  'development defines proposal output'

assert_contains \
  "$development_skill_file" \
  '## Development Review Output Contract' \
  'development defines review output'

assert_contains \
  "$development_skill_file" \
  '## Debugging Output Contract' \
  'development defines debugging output'

assert_contains \
  "$development_skill_file" \
  'Do not automatically fix failures.' \
  'development keeps validation failures proposal-only'

assert_contains \
  "$development_skill_file" \
  'Development does not stage, commit, or push' \
  'development excludes Git lifecycle mutation'

assert_contains \
  "$development_skill_file" \
  'Bash is permission-gated and validation-only during Development.' \
  'development restricts Bash to validation'

assert_contains \
  "$development_skill_file" \
  'investigating paths outside the active workspace' \
  'development prohibits external-path Bash investigation'

assert_contains \
  "$definition_file" \
  '/resume' \
  'definition contains the resume command'

assert_contains \
  "$definition_file" \
  '/develop' \
  'definition contains the develop command'

assert_contains \
  "$definition_file" \
  'never modify source files' \
  'definition preserves proposal-only Development'

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

if jq -e '.command.resume != null' \
  "$resolved_config" >/dev/null 2>&1; then
  pass 'resume command is discovered at runtime'
else
  fail 'resume command is discovered at runtime'
fi

if jq -e '.command.resume.agent == "lead"' \
  "$resolved_config" >/dev/null 2>&1; then
  pass 'resolved resume command targets lead'
else
  fail 'resolved resume command targets lead'
fi

if jq -e '
  .command.resume.template
  | type == "string"
    and contains("project-progress")
    and contains("Resume procedure")
' "$resolved_config" >/dev/null 2>&1; then
  pass 'resolved resume command selects project-progress Resume'
else
  fail 'resolved resume command selects project-progress Resume'
fi

if jq -e '.command.develop != null' \
  "$resolved_config" >/dev/null 2>&1; then
  pass 'develop command is discovered at runtime'
else
  fail 'develop command is discovered at runtime'
fi

if jq -e '.command.develop.agent == "lead"' \
  "$resolved_config" >/dev/null 2>&1; then
  pass 'resolved develop command targets lead'
else
  fail 'resolved develop command targets lead'
fi

if jq -e '
  .command.develop.template
  | type == "string"
    and contains("development")
    and contains("Development procedure")
' "$resolved_config" >/dev/null 2>&1; then
  pass 'resolved develop command selects Development procedure'
else
  fail 'resolved develop command selects Development procedure'
fi

if jq -e '
  .command.develop.template
  | type == "string"
    and contains("$ARGUMENTS")
' "$resolved_config" >/dev/null 2>&1; then
  pass 'resolved develop command preserves argument placeholder'
else
  fail 'resolved develop command preserves argument placeholder'
fi

printf '\nProject Workflows tests: %d passed, %d failed\n' \
  "$pass_count" \
  "$fail_count"

if ((fail_count > 0)); then
  exit 1
fi
