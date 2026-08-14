import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import type { EffectiveGitPolicyResolution } from "./git_policy";

export function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Canonical JSON cannot contain non-finite numbers");
    }

    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;

    const entries = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);

    return `{${entries.join(",")}}`;
  }

  throw new Error(`Unsupported canonical JSON value: ${typeof value}`);
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function gitProjectKey(projectRoot: string): string {
  const rawName = basename(projectRoot) || "project";

  const safeName =
    rawName.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") ||
    "project";

  const pathHash = sha256(projectRoot).slice(0, 12);

  return `${safeName}-${pathHash}`;
}

export function policyResolutionChecksum(
  resolution: EffectiveGitPolicyResolution,
): string {
  return sha256(
    canonicalJson({
      sources: resolution.sources,
      effective_policy: resolution.effective_policy,
    }),
  );
}

export function mentorStateRoot(): string {
  const configured = Bun.env.XDG_STATE_HOME;

  const stateHome =
    configured && isAbsolute(configured)
      ? configured
      : join(homedir(), ".local", "state");

  return join(stateHome, "opencode-mentor");
}
