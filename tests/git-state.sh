#!/usr/bin/env bash

set -euo pipefail

readonly script_dir="$(
  CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd
)"
readonly repo_root="$(
  CDPATH='' cd -- "$script_dir/.." && pwd
)"
readonly tool_file="$repo_root/tools/git_state.ts"

readonly sandbox="$(mktemp -d)"
readonly runner_file="$sandbox/run-git-state.ts"

result=''
pass_count=0
fail_count=0
case_count=0

cleanup() {
  rm -rf -- "$sandbox"
}
trap cleanup EXIT

pass() {
  printf 'PASS: %s\n' "$1"
  pass_count=$((pass_count + 1))
}

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  fail_count=$((fail_count + 1))
}

fatal() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 ||
    fatal "required command is unavailable: $1"
}

init_repository() {
  local repository="$1"

  mkdir -p -- "$repository"

  git -C "$repository" init -q
  git -C "$repository" config user.name "OpenCode Mentor Tests"
  git -C "$repository" config user.email "tests@opencode-mentor.invalid"

  printf 'initial content\n' >"$repository/tracked.txt"

  git -C "$repository" add -- tracked.txt
  git -C "$repository" commit -q -m "initial commit"
}

run_tool() {
  local directory="$1"

  bun "$runner_file" "$tool_file" "$directory"
}

run_case() {
  local description="$1"
  local directory="$2"
  local assertion="$3"

  local stderr_file

  case_count=$((case_count + 1))
  stderr_file="$sandbox/case-$case_count.stderr"

  if ! result="$(run_tool "$directory" 2>"$stderr_file")"; then
    cat "$stderr_file" >&2
    fail "$description: tool execution failed"
    return
  fi

  if ! jq empty <<<"$result" >/dev/null 2>&1; then
    cat "$stderr_file" >&2
    printf '%s\n' "$result" >&2
    fail "$description: tool output is not valid JSON"
    return
  fi

  if jq -e "$assertion" <<<"$result" >/dev/null; then
    pass "$description"
    return
  fi

  printf '%s\n' "$result" >&2
  fail "$description"
}

for command in bun git jq; do
  require_command "$command"
done

[[ -f "$tool_file" ]] ||
  fatal "git_state tool is unavailable: $tool_file"

cat >"$runner_file" <<'TYPESCRIPT'
import { pathToFileURL } from "node:url"

const toolPath = process.argv[2]
const directory = process.argv[3]

if (!toolPath || !directory) {
  throw new Error("tool path and inspection directory are required")
}

const imported = await import(pathToFileURL(toolPath).href)
const gitState = imported.default

if (!gitState || typeof gitState.execute !== "function") {
  throw new Error("git_state does not export an executable OpenCode tool")
}

const output = await gitState.execute(
  {},
  {
    agent: "git-state-test",
    sessionID: "git-state-test",
    messageID: "git-state-test",
    directory,
    worktree: directory,
  },
)

if (typeof output === "string") {
  process.stdout.write(output)
} else {
  process.stdout.write(JSON.stringify(output))
}
TYPESCRIPT

printf 'Running git_state functional tests\n\n'

# Non-Git directory
readonly non_git_directory="$sandbox/non-git"
mkdir -p -- "$non_git_directory"

run_case \
  "non-Git directory is reported without failure" \
  "$non_git_directory" \
  '
    .version == 1
    and .available == true
    and .repository == false
    and .reason == "not-inside-git-worktree"
  '

# Unborn repository
readonly unborn_repository="$sandbox/unborn"
mkdir -p -- "$unborn_repository"
git -C "$unborn_repository" init -q

run_case \
  "unborn repository is reported correctly" \
  "$unborn_repository" \
  '
    .available == true
    and .repository == true
    and .unborn == true
    and .detached == false
    and .latest_commit == null
    and .clean == true
    and (.warnings | length) == 0
  '

# Clean committed repository
readonly clean_repository="$sandbox/clean"
init_repository "$clean_repository"

run_case \
  "clean repository is reported correctly" \
  "$clean_repository" \
  '
    .available == true
    and .repository == true
    and .unborn == false
    and .detached == false
    and (.branch | type) == "string"
    and .clean == true
    and (.staged | length) == 0
    and (.unstaged | length) == 0
    and (.untracked | length) == 0
    and .latest_commit.subject == "initial commit"
    and (.warnings | length) == 0
  '

# Untracked unusual filename
readonly untracked_repository="$sandbox/untracked"
init_repository "$untracked_repository"
printf 'accidental file\n' >"$untracked_repository/@1"

run_case \
  "unusual untracked filename is returned without inspection" \
  "$untracked_repository" \
  '
    .repository == true
    and .clean == false
    and (.untracked | index("@1")) != null
    and (
      .changes
      | any(
          .path == "@1"
          and .index_status == "?"
          and .worktree_status == "?"
        )
    )
    and (.warnings | length) == 0
  '

# Staged file
readonly staged_repository="$sandbox/staged"
init_repository "$staged_repository"
printf 'staged content\n' >"$staged_repository/staged.txt"
git -C "$staged_repository" add -- staged.txt

run_case \
  "staged path is classified correctly" \
  "$staged_repository" \
  '
    .repository == true
    and .clean == false
    and (.staged | index("staged.txt")) != null
    and (.warnings | length) == 0
  '

# Unstaged tracked file
readonly unstaged_repository="$sandbox/unstaged"
init_repository "$unstaged_repository"
printf 'changed content\n' >>"$unstaged_repository/tracked.txt"

run_case \
  "unstaged path is classified correctly" \
  "$unstaged_repository" \
  '
    .repository == true
    and .clean == false
    and (.unstaged | index("tracked.txt")) != null
    and (.warnings | length) == 0
  '

# Staged rename
readonly rename_repository="$sandbox/rename"
init_repository "$rename_repository"
git -C "$rename_repository" mv -- tracked.txt renamed.txt

run_case \
  "staged rename preserves original and destination paths" \
  "$rename_repository" \
  '
    .repository == true
    and .clean == false
    and (.staged | index("tracked.txt -> renamed.txt")) != null
    and (
      .changes
      | any(
          .path == "renamed.txt"
          and .original_path == "tracked.txt"
          and .index_status == "R"
        )
    )
    and (.warnings | length) == 0
  '

# Detached HEAD
readonly detached_repository="$sandbox/detached"
init_repository "$detached_repository"
git -C "$detached_repository" checkout --detach -q

run_case \
  "detached HEAD is reported explicitly" \
  "$detached_repository" \
  '
    .repository == true
    and .detached == true
    and .unborn == false
    and .branch == null
    and .latest_commit != null
    and (.warnings | length) == 0
  '

# Branch without upstream
readonly no_upstream_repository="$sandbox/no-upstream"
init_repository "$no_upstream_repository"

run_case \
  "missing upstream is reported without guessing divergence" \
  "$no_upstream_repository" \
  '
    .repository == true
    and .branch != null
    and .upstream == null
    and .ahead == null
    and .behind == null
    and (.warnings | length) == 0
  '

# Local upstream with divergence
readonly divergent_repository="$sandbox/divergent"
init_repository "$divergent_repository"

readonly divergent_branch="$(
  git -C "$divergent_repository" symbolic-ref --short HEAD
)"

git -C "$divergent_repository" branch upstream
git -C "$divergent_repository" \
  branch --set-upstream-to=upstream "$divergent_branch" >/dev/null

printf 'ahead content\n' >"$divergent_repository/ahead.txt"
git -C "$divergent_repository" add -- ahead.txt
git -C "$divergent_repository" commit -q -m "ahead commit"

git -C "$divergent_repository" checkout -q upstream
printf 'behind content\n' >"$divergent_repository/behind.txt"
git -C "$divergent_repository" add -- behind.txt
git -C "$divergent_repository" commit -q -m "behind commit"
git -C "$divergent_repository" checkout -q "$divergent_branch"

run_case \
  "local upstream divergence is counted without network access" \
  "$divergent_repository" \
  '
    .repository == true
    and .upstream == "upstream"
    and .ahead == 1
    and .behind == 1
    and (.warnings | length) == 0
  '

# Merge conflict
readonly conflict_repository="$sandbox/conflict"
init_repository "$conflict_repository"

readonly conflict_base_branch="$(
  git -C "$conflict_repository" symbolic-ref --short HEAD
)"

git -C "$conflict_repository" checkout -q -b conflicting-change
printf 'branch content\n' >"$conflict_repository/tracked.txt"
git -C "$conflict_repository" add -- tracked.txt
git -C "$conflict_repository" commit -q -m "conflicting branch change"

git -C "$conflict_repository" checkout -q "$conflict_base_branch"
printf 'base content\n' >"$conflict_repository/tracked.txt"
git -C "$conflict_repository" add -- tracked.txt
git -C "$conflict_repository" commit -q -m "conflicting base change"

git -C "$conflict_repository" \
  merge conflicting-change >/dev/null 2>&1 || true

run_case \
  "merge conflict is reported explicitly" \
  "$conflict_repository" \
  '
    .repository == true
    and .clean == false
    and (.conflicts | index("tracked.txt")) != null
    and (
      .changes
      | any(
          .path == "tracked.txt"
          and (
            (.index_status + .worktree_status) == "UU"
            or (.index_status + .worktree_status) == "AA"
          )
        )
    )
    and (.warnings | length) == 0
  '

# Repository-configured FSMonitor command must not execute
readonly fsmonitor_repository="$sandbox/fsmonitor"
readonly fsmonitor_hook="$sandbox/fsmonitor-hook"
readonly fsmonitor_marker="$sandbox/fsmonitor-invoked"

init_repository "$fsmonitor_repository"

cat >"$fsmonitor_hook" <<EOF
#!/usr/bin/env bash
printf 'invoked\n' >"$fsmonitor_marker"
exit 0
EOF

chmod +x "$fsmonitor_hook"
git -C "$fsmonitor_repository" config core.fsmonitor "$fsmonitor_hook"

run_case \
  "repository FSMonitor configuration is disabled" \
  "$fsmonitor_repository" \
  '
    .repository == true
    and .clean == true
    and (.warnings | length) == 0
  '

if [[ ! -e "$fsmonitor_marker" ]]; then
  pass "repository FSMonitor command was not executed"
else
  fail "repository FSMonitor command was executed"
fi

printf '\ngit_state functional tests: %d passed, %d failed\n' \
  "$pass_count" \
  "$fail_count"

if ((fail_count > 0)); then
  exit 1
fi
