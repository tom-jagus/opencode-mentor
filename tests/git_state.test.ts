import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { inspectGitState, parseGitStatus } from "../lib/git_state";

describe("parseGitStatus", () => {
  test("parses staged, unstaged, and untracked paths", () => {
    const status = parseGitStatus(
      ["M  staged.ts", " M unstaged.ts", "?? untracked.ts", ""].join("\0"),
    );

    expect(status.clean).toBe(false);
    expect(status.staged).toEqual(["staged.ts"]);
    expect(status.unstaged).toEqual(["unstaged.ts"]);
    expect(status.untracked).toEqual(["untracked.ts"]);
    expect(status.conflicts).toEqual([]);
  });

  test("parses conflicts", () => {
    const status = parseGitStatus(["UU conflicted.ts", ""].join("\0"));

    expect(status.conflicts).toEqual(["conflicted.ts"]);
  });

  test("parses renamed paths", () => {
    const status = parseGitStatus(
      ["R  new-name.ts", "old-name.ts", ""].join("\0"),
    );

    expect(status.staged).toEqual(["old-name.ts -> new-name.ts"]);
    expect(status.changes).toContainEqual({
      path: "new-name.ts",
      original_path: "old-name.ts",
      index_status: "R",
      worktree_status: " ",
    });
  });

  test("reports empty output as clean", () => {
    expect(parseGitStatus("")).toEqual({
      clean: true,
      staged: [],
      unstaged: [],
      untracked: [],
      conflicts: [],
      changes: [],
    });
  });
});

describe("inspectGitState", () => {
  test("inspects the repository through the reusable API", async () => {
    const repositoryRoot = fileURLToPath(
      new URL("..", import.meta.url),
    ).replace(/\/$/, "");

    const state = await inspectGitState(repositoryRoot);

    expect(state.available).toBe(true);
    expect(state.repository).toBe(true);

    if (state.repository) {
      expect(state.root).toBe(repositoryRoot);
      expect(typeof state.detached).toBe("boolean");
      expect(typeof state.unborn).toBe("boolean");
      expect(Array.isArray(state.conflicts)).toBe(true);
      expect(Array.isArray(state.changes)).toBe(true);
    }
  });
});
