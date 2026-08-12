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
readonly define_command_file="$repo_root/commands/define.md"
readonly milestone_command_file="$repo_root/commands/milestone.md"
readonly decision_command_file="$repo_root/commands/decision.md"
readonly legacy_command_file="$repo_root/commands/status.md"

readonly lead_agent_file="$repo_root/agents/lead.md"

readonly project_progress_skill_file="$repo_root/skills/project-progress/SKILL.md"
readonly development_skill_file="$repo_root/skills/development/SKILL.md"
readonly project_definition_skill_file="$repo_root/skills/project-definition/SKILL.md"

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

###############################################################################
# Repository surface
###############################################################################

assert_file \
  "$lead_agent_file" \
  'lead agent exists'

assert_file \
  "$state_command_file" \
  'state command exists'

assert_file \
  "$resume_command_file" \
  'resume command exists'

assert_file \
  "$develop_command_file" \
  'develop command exists'

assert_file \
  "$define_command_file" \
  'define command exists'

assert_file \
  "$milestone_command_file" \
  'milestone command exists'

assert_file \
  "$decision_command_file" \
  'decision command exists'

assert_absent \
  "$legacy_command_file" \
  'custom status command is not defined'

assert_file \
  "$project_progress_skill_file" \
  'project-progress skill exists'

assert_file \
  "$development_skill_file" \
  'development skill exists'

assert_file \
  "$project_definition_skill_file" \
  'project-definition skill exists'

###############################################################################
# Lead routing
###############################################################################

assert_contains \
  "$lead_agent_file" \
  '## Workflow Routing' \
  'lead defines workflow routing'

assert_contains \
  "$lead_agent_file" \
  '1. explicit slash command;' \
  'lead routing prioritises explicit slash commands'

assert_contains \
  "$lead_agent_file" \
  '2. explicit wording in the current request;' \
  'lead routing considers explicit wording second'

assert_contains \
  "$lead_agent_file" \
  '3. recorded project state;' \
  'lead routing considers recorded project state'

assert_contains \
  "$lead_agent_file" \
  '4. safe inference;' \
  'lead routing permits safe inference'

assert_contains \
  "$lead_agent_file" \
  '5. safe read-only fallback.' \
  'lead routing defines safe read-only fallback'

assert_contains \
  "$lead_agent_file" \
  '**Project Definition**' \
  'lead routes Project Definition work'

assert_contains \
  "$lead_agent_file" \
  '**Development**' \
  'lead routes Development work'

assert_contains \
  "$lead_agent_file" \
  '**Project Progress / State**' \
  'lead routes State work'

assert_contains \
  "$lead_agent_file" \
  '**Project Progress / Resume**' \
  'lead routes Resume work'

assert_contains \
  "$lead_agent_file" \
  '**Project Progress / Milestone**' \
  'lead routes Milestone work'

assert_contains \
  "$lead_agent_file" \
  '**Project Progress / Decision**' \
  'lead routes Decision work'

###############################################################################
# Project-state bootstrap
###############################################################################

assert_contains \
  "$lead_agent_file" \
  '## Project State Bootstrap' \
  'lead defines project-state bootstrap'

assert_contains \
  "$lead_agent_file" \
  '**uninitialised**' \
  'lead recognises uninitialised project state'

assert_contains \
  "$lead_agent_file" \
  '**partial**' \
  'lead recognises partial project state'

assert_contains \
  "$lead_agent_file" \
  '**established**' \
  'lead recognises established project state'

assert_contains \
  "$lead_agent_file" \
  '**inconsistent**' \
  'lead recognises inconsistent project state'

assert_contains \
  "$lead_agent_file" \
  'Missing project artifacts do not automatically route ordinary repository work to' \
  'missing artifacts do not force Project Definition'

assert_contains \
  "$lead_agent_file" \
  'allow another clearly requested workflow to proceed when the usable recorded' \
  'partial bootstrap permits safe unrelated workflows'

assert_contains \
  "$lead_agent_file" \
  'report the conflicting values and their owning artifacts' \
  'inconsistent bootstrap reports authoritative conflicts'

###############################################################################
# State command and procedure
###############################################################################

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
  "$state_command_file" \
  'accepts no arguments' \
  'state command rejects arguments'

assert_contains \
  "$project_progress_skill_file" \
  'name: project-progress' \
  'project-progress skill name matches its directory'

assert_contains \
  "$project_progress_skill_file" \
  'workflow: project-progress' \
  'project-progress skill declares workflow metadata'

assert_contains \
  "$project_progress_skill_file" \
  '## State Procedure' \
  'project-progress defines State procedure'

assert_contains \
  "$project_progress_skill_file" \
  '## State Output Contract' \
  'project-progress defines State output contract'

assert_contains \
  "$project_progress_skill_file" \
  'Do not inspect the type, metadata, contents, ownership, or purpose' \
  'State does not investigate changed paths automatically'

assert_contains \
  "$project_progress_skill_file" \
  'An unusual filename is not by itself a blocker' \
  'State treats unusual paths as ordinary repository state'

assert_contains \
  "$project_progress_skill_file" \
  'Do not run additional commands or tools to inspect paths' \
  'State treats git_state output as sufficient for path reporting'

###############################################################################
# Resume command and procedure
###############################################################################

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
  'resume command selects Resume procedure'

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
  'project-progress defines Resume procedure'

assert_contains \
  "$project_progress_skill_file" \
  '## Resume Output Contract' \
  'project-progress defines Resume output contract'

assert_contains \
  "$project_progress_skill_file" \
  '## Resume Completion Condition' \
  'project-progress defines Resume completion condition'

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

###############################################################################
# Development command and skill
###############################################################################

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
  'develop command selects Development procedure'

assert_contains \
  "$develop_command_file" \
  '$ARGUMENTS' \
  'develop command forwards arguments'

assert_contains \
  "$develop_command_file" \
  'proposal-only' \
  'develop command preserves manual source ownership'

assert_contains \
  "$develop_command_file" \
  'Bash is validation-only' \
  'develop command restricts Bash to validation'

assert_contains \
  "$development_skill_file" \
  'name: development' \
  'development skill name matches its directory'

assert_contains \
  "$development_skill_file" \
  'workflow: development' \
  'development skill declares workflow metadata'

assert_contains \
  "$development_skill_file" \
  '## Source Ownership Boundary' \
  'development defines source ownership boundary'

assert_contains \
  "$development_skill_file" \
  '## Development Procedure' \
  'development defines Development procedure'

assert_contains \
  "$development_skill_file" \
  '### 9. Stop for manual application' \
  'development stops before manual source application'

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
  'development defines proposal output contract'

assert_contains \
  "$development_skill_file" \
  '## Development Review Output Contract' \
  'development defines review output contract'

assert_contains \
  "$development_skill_file" \
  '## Debugging Output Contract' \
  'development defines debugging output contract'

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
  'development skill restricts Bash to validation'

assert_contains \
  "$development_skill_file" \
  'investigating paths outside the active workspace' \
  'development prohibits external-path Bash investigation'

###############################################################################
# Project Definition command and skill
###############################################################################

assert_contains \
  "$define_command_file" \
  'agent: lead' \
  'define command routes through lead'

assert_contains \
  "$define_command_file" \
  'project-definition' \
  'define command loads project-definition skill'

assert_contains \
  "$define_command_file" \
  'Project Definition procedure' \
  'define command selects Project Definition procedure'

assert_contains \
  "$define_command_file" \
  '$ARGUMENTS' \
  'define command forwards arguments'

assert_contains \
  "$define_command_file" \
  'proposal-only' \
  'define command declares proposal-only operation'

assert_contains \
  "$define_command_file" \
  'Do not use Bash' \
  'define command prohibits Bash'

assert_contains \
  "$project_definition_skill_file" \
  'name: project-definition' \
  'project-definition skill name matches its directory'

assert_contains \
  "$project_definition_skill_file" \
  'workflow: project-definition' \
  'project-definition skill declares workflow metadata'

assert_contains \
  "$project_definition_skill_file" \
  '### Initial Definition' \
  'project-definition defines Initial Definition mode'

assert_contains \
  "$project_definition_skill_file" \
  '### Material Re-entry' \
  'project-definition defines Material Re-entry mode'

assert_contains \
  "$project_definition_skill_file" \
  'For Material Re-entry against an established approved project definition' \
  'definition classification is scoped to established project state'

assert_contains \
  "$project_definition_skill_file" \
  '## Initial Project Artifact Templates' \
  'project-definition embeds initial artifact templates'

assert_contains \
  "$project_definition_skill_file" \
  'title: <project-name> Project Definition' \
  'definition template is present'

assert_contains \
  "$project_definition_skill_file" \
  'active_milestone: <milestone-id>' \
  'progress template is present'

assert_contains \
  "$project_definition_skill_file" \
  '# Decision Register' \
  'decision-register template is present'

assert_contains \
  "$project_definition_skill_file" \
  'accepted | rejected | proposed' \
  'decision template supports durable decision statuses'

assert_contains \
  "$project_definition_skill_file" \
  '## Project Definition Procedure' \
  'project-definition defines Project Definition procedure'

assert_contains \
  "$project_definition_skill_file" \
  'Use Initial Definition when approved coordinated project state has not yet been' \
  'Project Definition supports project bootstrap'

assert_contains \
  "$project_definition_skill_file" \
  'Use Material Re-entry when an approved coordinated project artifact set already' \
  'Project Definition separates re-entry from partial bootstrap'

assert_contains \
  "$project_definition_skill_file" \
  'For Initial Definition, use the Initial Project Artifact Templates as the' \
  'Initial Definition uses embedded artifact templates'

assert_contains \
  "$project_definition_skill_file" \
  'Approved `definition.md` exists but the coordinated artifact set is partial' \
  'Project Definition handles approved partial bootstrap state'

assert_contains \
  "$project_definition_skill_file" \
  'Do not use Bash.' \
  'project-definition skill prohibits Bash'

assert_contains \
  "$project_definition_skill_file" \
  'Do not modify project artifacts.' \
  'project-definition remains proposal-only'

###############################################################################
# Milestone command and procedure
###############################################################################

assert_contains \
  "$milestone_command_file" \
  'agent: lead' \
  'milestone command routes through lead'

assert_contains \
  "$milestone_command_file" \
  'project-progress' \
  'milestone command loads project-progress'

assert_contains \
  "$milestone_command_file" \
  'Milestone procedure' \
  'milestone command selects Milestone procedure'

assert_contains \
  "$milestone_command_file" \
  '$ARGUMENTS' \
  'milestone command forwards arguments'

assert_contains \
  "$milestone_command_file" \
  'proposal-only' \
  'milestone command declares proposal-only operation'

assert_contains \
  "$milestone_command_file" \
  'Do not use Bash' \
  'milestone command prohibits Bash'

assert_contains \
  "$milestone_command_file" \
  'docs/project/progress.md' \
  'milestone command owns progress artifact changes'

assert_contains \
  "$project_progress_skill_file" \
  'proposal-only **Milestone**' \
  'project-progress activates proposal-only Milestone'

assert_contains \
  "$project_progress_skill_file" \
  '## Milestone Procedure' \
  'project-progress defines Milestone procedure'

assert_contains \
  "$project_progress_skill_file" \
  '## Milestone Output Contract' \
  'project-progress defines Milestone output contract'

assert_contains \
  "$project_progress_skill_file" \
  '**Start**' \
  'Milestone defines Start transition'

assert_contains \
  "$project_progress_skill_file" \
  '**Complete**' \
  'Milestone defines Complete transition'

assert_contains \
  "$project_progress_skill_file" \
  '**Block**' \
  'Milestone defines Block transition'

assert_contains \
  "$project_progress_skill_file" \
  '**Unblock**' \
  'Milestone defines Unblock transition'

assert_contains \
  "$project_progress_skill_file" \
  '**Cancel**' \
  'Milestone defines Cancel transition'

assert_contains \
  "$project_progress_skill_file" \
  'A cancelled milestone must not remain recorded as active.' \
  'Milestone keeps cancelled state internally consistent'

###############################################################################
# Decision command and procedure
###############################################################################

assert_contains \
  "$decision_command_file" \
  'agent: lead' \
  'decision command routes through lead'

assert_contains \
  "$decision_command_file" \
  'project-progress' \
  'decision command loads project-progress'

assert_contains \
  "$decision_command_file" \
  'Decision procedure' \
  'decision command selects Decision procedure'

assert_contains \
  "$decision_command_file" \
  '$ARGUMENTS' \
  'decision command forwards arguments'

assert_contains \
  "$decision_command_file" \
  'proposal-only' \
  'decision command declares proposal-only operation'

assert_contains \
  "$decision_command_file" \
  'Do not use Bash' \
  'decision command prohibits Bash'

assert_contains \
  "$decision_command_file" \
  'docs/project/decisions.md' \
  'decision command owns decision-register changes'

assert_contains \
  "$project_progress_skill_file" \
  'proposal-only **Decision**' \
  'project-progress activates proposal-only Decision'

assert_contains \
  "$project_progress_skill_file" \
  '## Decision Procedure' \
  'project-progress defines Decision procedure'

assert_contains \
  "$project_progress_skill_file" \
  '## Decision Output Contract' \
  'project-progress defines Decision output contract'

assert_contains \
  "$project_progress_skill_file" \
  '**New accepted decision**' \
  'Decision supports accepted decisions'

assert_contains \
  "$project_progress_skill_file" \
  '**New rejected decision**' \
  'Decision supports rejected decisions'

assert_contains \
  "$project_progress_skill_file" \
  '**Supersede**' \
  'Decision supports supersession'

assert_contains \
  "$project_progress_skill_file" \
  '**Partial supersession**' \
  'Decision supports partial supersession'

assert_contains \
  "$project_progress_skill_file" \
  '- date;' \
  'Decision proposal records decision date'

assert_contains \
  "$project_progress_skill_file" \
  '- related milestone;' \
  'Decision proposal can record related milestone'

###############################################################################
# Obsolete workflow state must be gone
###############################################################################

assert_not_contains \
  "$project_progress_skill_file" \
  'Milestone transitions and decision recording remain inactive' \
  'Milestone and Decision are no longer marked inactive'

###############################################################################
# Authoritative project artifacts
###############################################################################

assert_contains \
  "$definition_file" \
  '/state' \
  'definition contains state command'

assert_contains \
  "$definition_file" \
  '/resume' \
  'definition contains resume command'

assert_contains \
  "$definition_file" \
  '/develop' \
  'definition contains develop command'

assert_contains \
  "$definition_file" \
  '/define' \
  'definition contains define command'

assert_contains \
  "$definition_file" \
  '/milestone' \
  'definition contains milestone command'

assert_contains \
  "$definition_file" \
  '/decision' \
  'definition contains decision command'

assert_not_contains \
  "$definition_file" \
  '/status' \
  'definition no longer specifies custom status command'

assert_contains \
  "$definition_file" \
  'never modify source files' \
  'definition preserves proposal-only Development'

assert_contains \
  "$decisions_file" \
  'DEC-040' \
  'decision register records state-command rename'

assert_contains \
  "$decisions_file" \
  'DEC-041' \
  'decision register records deterministic git_state tool'

assert_contains \
  "$progress_file" \
  'active_milestone: project-workflows' \
  'progress identifies Project Workflows as active milestone'

assert_contains \
  "$progress_file" \
  'integrated validation of the completed' \
  'progress records integrated validation as pending'

assert_contains \
  "$progress_file" \
  'expand and reconcile the Project Workflows automated test suite' \
  'progress records current testing action'

###############################################################################
# Runtime discovery
###############################################################################

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

skills_raw="$runtime_root/resolved-skills.raw"
skills_json="$runtime_root/resolved-skills.json"
skills_stderr="$runtime_root/resolved-skills.stderr"

if OPENCODE_DEV_RUNTIME="$runtime_root/runtime" \
  "$launcher" debug skill >"$skills_raw" 2>"$skills_stderr"; then
  pass 'development launcher resolves skills'
else
  fail 'development launcher resolves skills'
  cat "$skills_stderr" >&2
fi

# The launcher validator may print text before OpenCode emits JSON.
# Retain everything beginning with the first JSON array.
awk '
  found || /^[[:space:]]*\[/ {
    found = 1
    print
  }
' "$skills_raw" >"$skills_json"

if jq empty "$skills_json" >/dev/null 2>&1; then
  pass 'resolved OpenCode skills are valid JSON'
else
  fail 'resolved OpenCode skills are valid JSON'
fi

if jq -e '
  type == "array"
  and any(.[]; .name == "project-progress")
' "$skills_json" >/dev/null 2>&1; then
  pass 'project-progress skill is discovered at runtime'
else
  fail 'project-progress skill is discovered at runtime'
fi

if jq -e '
  type == "array"
  and any(.[]; .name == "development")
' "$skills_json" >/dev/null 2>&1; then
  pass 'development skill is discovered at runtime'
else
  fail 'development skill is discovered at runtime'
fi

if jq -e '
  type == "array"
  and any(.[]; .name == "project-definition")
' "$skills_json" >/dev/null 2>&1; then
  pass 'project-definition skill is discovered at runtime'
else
  fail 'project-definition skill is discovered at runtime'
fi

# The launcher validator may print text before OpenCode emits JSON.
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

###############################################################################
# Runtime command discovery: State
###############################################################################

if jq -e '.command.state != null' \
  "$resolved_config" >/dev/null 2>&1; then
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
    and contains("State procedure")
' "$resolved_config" >/dev/null 2>&1; then
  pass 'resolved state command selects project-progress State'
else
  fail 'resolved state command selects project-progress State'
fi

###############################################################################
# Runtime command discovery: Resume
###############################################################################

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

###############################################################################
# Runtime command discovery: Develop
###############################################################################

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

###############################################################################
# Runtime command discovery: Define
###############################################################################

if jq -e '.command.define != null' \
  "$resolved_config" >/dev/null 2>&1; then
  pass 'define command is discovered at runtime'
else
  fail 'define command is discovered at runtime'
fi

if jq -e '.command.define.agent == "lead"' \
  "$resolved_config" >/dev/null 2>&1; then
  pass 'resolved define command targets lead'
else
  fail 'resolved define command targets lead'
fi

if jq -e '
  .command.define.template
  | type == "string"
    and contains("project-definition")
    and contains("Project Definition procedure")
' "$resolved_config" >/dev/null 2>&1; then
  pass 'resolved define command selects Project Definition procedure'
else
  fail 'resolved define command selects Project Definition procedure'
fi

if jq -e '
  .command.define.template
  | type == "string"
    and contains("$ARGUMENTS")
' "$resolved_config" >/dev/null 2>&1; then
  pass 'resolved define command preserves argument placeholder'
else
  fail 'resolved define command preserves argument placeholder'
fi

###############################################################################
# Runtime command discovery: Milestone
###############################################################################

if jq -e '.command.milestone != null' \
  "$resolved_config" >/dev/null 2>&1; then
  pass 'milestone command is discovered at runtime'
else
  fail 'milestone command is discovered at runtime'
fi

if jq -e '.command.milestone.agent == "lead"' \
  "$resolved_config" >/dev/null 2>&1; then
  pass 'resolved milestone command targets lead'
else
  fail 'resolved milestone command targets lead'
fi

if jq -e '
  .command.milestone.template
  | type == "string"
    and contains("project-progress")
    and contains("Milestone procedure")
' "$resolved_config" >/dev/null 2>&1; then
  pass 'resolved milestone command selects project-progress Milestone'
else
  fail 'resolved milestone command selects project-progress Milestone'
fi

if jq -e '
  .command.milestone.template
  | type == "string"
    and contains("$ARGUMENTS")
' "$resolved_config" >/dev/null 2>&1; then
  pass 'resolved milestone command preserves argument placeholder'
else
  fail 'resolved milestone command preserves argument placeholder'
fi

###############################################################################
# Runtime command discovery: Decision
###############################################################################

if jq -e '.command.decision != null' \
  "$resolved_config" >/dev/null 2>&1; then
  pass 'decision command is discovered at runtime'
else
  fail 'decision command is discovered at runtime'
fi

if jq -e '.command.decision.agent == "lead"' \
  "$resolved_config" >/dev/null 2>&1; then
  pass 'resolved decision command targets lead'
else
  fail 'resolved decision command targets lead'
fi

if jq -e '
  .command.decision.template
  | type == "string"
    and contains("project-progress")
    and contains("Decision procedure")
' "$resolved_config" >/dev/null 2>&1; then
  pass 'resolved decision command selects project-progress Decision'
else
  fail 'resolved decision command selects project-progress Decision'
fi

if jq -e '
  .command.decision.template
  | type == "string"
    and contains("$ARGUMENTS")
' "$resolved_config" >/dev/null 2>&1; then
  pass 'resolved decision command preserves argument placeholder'
else
  fail 'resolved decision command preserves argument placeholder'
fi

###############################################################################
# Result
###############################################################################

printf '\nProject Workflows tests: %d passed, %d failed\n' \
  "$pass_count" \
  "$fail_count"

if ((fail_count > 0)); then
  exit 1
fi
