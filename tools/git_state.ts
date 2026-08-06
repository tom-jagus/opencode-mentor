import { tool } from "@opencode-ai/plugin"

type GitCommandResult = {
  stdout: string
  stderr: string
  exitCode: number
}

type FileChange = {
  path: string
  original_path?: string
  index_status: string
  worktree_status: string
}

type ParsedStatus = {
  clean: boolean
  staged: string[]
  unstaged: string[]
  untracked: string[]
  conflicts: string[]
  changes: FileChange[]
}

const conflictCodes = new Set([
  "DD",
  "AU",
  "UD",
  "UA",
  "DU",
  "AA",
  "UU",
])

async function runGit(
  cwd: string,
  args: string[],
): Promise<GitCommandResult> {
  const subprocess = Bun.spawn(
    [
      "git",
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.hooksPath=/dev/null",
      ...args,
    ],
    {
        cwd,
        env: {
          ...Bun.env,
          GIT_OPTIONAL_LOCKS: "0",
          GIT_TERMINAL_PROMPT: "0",
          LANG: "C",
          LC_ALL: "C",
        },
        stdout: "pipe",
        stderr: "pipe",
    },
  )

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
    subprocess.exited,
  ])

  return {
    stdout,
    stderr,
    exitCode,
  }
}

function displayPath(change: FileChange): string {
  if (change.original_path) {
    return `${change.original_path} -> ${change.path}`
  }

  return change.path
}

function parseStatus(output: string): ParsedStatus {
  const records = output.split("\0")
  const changes: FileChange[] = []

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]

    if (!record || record.length < 3) {
      continue
    }

    const code = record.slice(0, 2)
    const path = record.slice(3)

    let originalPath: string | undefined

    if (
      code.includes("R") ||
      code.includes("C")
    ) {
      const nextRecord = records[index + 1]

      if (nextRecord) {
        originalPath = nextRecord
        index += 1
      }
    }

    changes.push({
      path,
      ...(originalPath ? { original_path: originalPath } : {}),
      index_status: code[0] ?? " ",
      worktree_status: code[1] ?? " ",
    })
  }

  const staged = changes
    .filter(
      (change) =>
        change.index_status !== " " &&
        change.index_status !== "?" &&
        change.index_status !== "!",
    )
    .map(displayPath)

  const unstaged = changes
    .filter(
      (change) =>
        change.worktree_status !== " " &&
        change.worktree_status !== "?" &&
        change.worktree_status !== "!",
    )
    .map(displayPath)

  const untracked = changes
    .filter(
      (change) =>
        change.index_status === "?" &&
        change.worktree_status === "?",
    )
    .map((change) => change.path)

  const conflicts = changes
    .filter((change) =>
      conflictCodes.has(
        `${change.index_status}${change.worktree_status}`,
      ),
    )
    .map(displayPath)

  return {
    clean: changes.length === 0,
    staged,
    unstaged,
    untracked,
    conflicts,
    changes,
  }
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

export default tool({
  description:
    "Return deterministic read-only Git repository state. " +
    "Runs only fixed local Git inspection commands and performs no network, " +
    "index, worktree, configuration, reference, or history mutation.",

  args: {},

  async execute(_args, context) {
    const directory = context.directory || context.worktree

    try {
      const rootResult = await runGit(directory, [
        "rev-parse",
        "--show-toplevel",
      ])

      if (rootResult.exitCode !== 0) {
        const error = rootResult.stderr.trim()

        if (/not a git repository/i.test(error)) {
          return json({
            version: 1,
            available: true,
            repository: false,
            directory,
            reason: "not-inside-git-worktree",
          })
        }

        return json({
          version: 1,
          available: false,
          repository: null,
          directory,
          reason: "git-inspection-failed",
          error:
            error ||
            `git rev-parse exited with code ${rootResult.exitCode}`,
        })
      }

      const root = rootResult.stdout.trim()

      const [
        branchResult,
        headResult,
        statusResult,
      ] = await Promise.all([
        runGit(root, [
          "symbolic-ref",
          "--quiet",
          "--short",
          "HEAD",
        ]),
        runGit(root, [
          "rev-parse",
          "--verify",
          "HEAD",
        ]),
        runGit(root, [
          "status",
          "--porcelain=v1",
          "-z",
          "--untracked-files=200",
        ]),
      ])

      const branch =
        branchResult.exitCode === 0
          ? branchResult.stdout.trim()
          : null

      const hasHead = headResult.exitCode === 0
      const detached = hasHead && branch === null
      const unborn = !hasHead

      let upstream: string | null = null
      let ahead: number | null = null
      let behind: number | null = null

      if (hasHead && branch) {
        const upstreamResult = await runGit(root, [
          "rev-parse",
          "--abbrev-ref",
          "--symbolic-full-name",
          "@{upstream}",
        ])

        if (upstreamResult.exitCode === 0) {
          upstream = upstreamResult.stdout.trim()

          const countResult = await runGit(root, [
            "rev-list",
            "--left-right",
            "--count",
            "HEAD...@{upstream}",
          ])

          if (countResult.exitCode === 0) {
            const [aheadValue, behindValue] =
              countResult.stdout.trim().split(/\s+/)

            const parsedAhead = Number.parseInt(aheadValue ?? "", 10)
            const parsedBehind = Number.parseInt(behindValue ?? "", 10)

            ahead = Number.isNaN(parsedAhead)
              ? null
              : parsedAhead

            behind = Number.isNaN(parsedBehind)
              ? null
              : parsedBehind
          }
        }
      }

      let latestCommit: {
        sha: string
        short_sha: string
        subject: string
        committed_at: string
      } | null = null

      if (hasHead) {
        const logResult = await runGit(root, [
          "log",
          "-1",
          "--format=%H%x00%h%x00%s%x00%cI",
        ])

        if (logResult.exitCode === 0) {
          const fields = logResult.stdout
            .replace(/\n$/, "")
            .split("\0")

          if (fields.length >= 4) {
            latestCommit = {
              sha: fields[0] ?? "",
              short_sha: fields[1] ?? "",
              subject: fields[2] ?? "",
              committed_at: fields[3] ?? "",
            }
          }
        }
      }

      const warnings: string[] = []
      let status: ParsedStatus | null = null

      if (statusResult.exitCode === 0) {
        status = parseStatus(statusResult.stdout)
      } else {
        warnings.push(
          statusResult.stderr.trim() ||
            `git status exited with code ${statusResult.exitCode}`,
        )
      }

      return json({
        version: 1,
        available: true,
        repository: true,
        root,
        branch,
        detached,
        unborn,
        upstream,
        ahead,
        behind,
        clean: status?.clean ?? null,
        staged: status?.staged ?? [],
        unstaged: status?.unstaged ?? [],
        untracked: status?.untracked ?? [],
        conflicts: status?.conflicts ?? [],
        changes: status?.changes ?? [],
        latest_commit: latestCommit,
        warnings,
      })
    } catch (error) {
      return json({
        version: 1,
        available: false,
        repository: null,
        directory,
        reason: "git-unavailable",
        error: errorMessage(error),
      })
    }
  },
})
