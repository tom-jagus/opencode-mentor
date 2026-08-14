import { describe, expect, test } from "bun:test";
import {
  canonicalJson,
  gitProjectKey,
  sha256,
} from "../lib/git_lifecycle_proposal";

describe("Git lifecycle proposal helpers", () => {
  test("canonicalizes object keys deterministically", () => {
    expect(
      canonicalJson({
        z: 3,
        a: {
          second: true,
          first: "value",
        },
        omitted: undefined,
      }),
    ).toBe('{"a":{"first":"value","second":true},"z":3}');
  });

  test("preserves array order", () => {
    expect(canonicalJson(["second", "first"])).toBe('["second","first"]');
  });

  test("rejects unsupported numeric values", () => {
    expect(() => canonicalJson(Number.NaN)).toThrow(
      "Canonical JSON cannot contain non-finite numbers",
    );
  });

  test("produces stable SHA-256 checksums", () => {
    expect(sha256("checkpoint")).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256("checkpoint")).toBe(sha256("checkpoint"));
  });

  test("produces stable path-bound project keys", () => {
    const first = gitProjectKey("/workspace/My Project");
    const second = gitProjectKey("/workspace/My Project");
    const other = gitProjectKey("/other/My Project");

    expect(first).toMatch(/^My-Project-[0-9a-f]{12}$/);
    expect(first).toBe(second);
    expect(first).not.toBe(other);
  });
});
