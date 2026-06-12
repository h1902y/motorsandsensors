import { describe, expect, it } from "vitest";
import type { SessionGitStatus } from "@zuzuu-web/protocol";
import { mergeRefusalReason, sessionIndicator } from "./session-git";
import { ZuzuuApiError } from "../lib/zuzuu-api";

const active = (checkpoints: number) => ({
  branch: "zz/session-abc",
  checkpoints,
  dirty: false,
  noNetChanges: false,
});

describe("sessionIndicator", () => {
  it("renders nothing while the status is still loading", () => {
    expect(sessionIndicator(undefined)).toEqual({ kind: "none" });
  });

  it("renders nothing when session-git is disabled or the CLI is absent", () => {
    expect(sessionIndicator({ enabled: false, cliAbsent: true })).toEqual({ kind: "none" });
    expect(sessionIndicator({ enabled: false })).toEqual({ kind: "none" });
  });

  it("renders nothing when enabled but no session branch exists", () => {
    const status: SessionGitStatus = { enabled: true, mainBranch: "main", active: null, onSessionBranch: false };
    expect(sessionIndicator(status)).toEqual({ kind: "none" });
  });

  it("shows the checkpoint count while on the session branch (singular/plural)", () => {
    const base: SessionGitStatus = { enabled: true, mainBranch: "main", onSessionBranch: true, active: active(1) };
    expect(sessionIndicator(base)).toEqual({ kind: "active", label: "● session · 1 checkpoint" });
    expect(sessionIndicator({ ...base, active: active(4) })).toEqual({
      kind: "active",
      label: "● session · 4 checkpoints",
    });
  });

  it("flags a leftover session branch that isn't checked out", () => {
    const status: SessionGitStatus = { enabled: true, mainBranch: "main", onSessionBranch: false, active: active(2) };
    expect(sessionIndicator(status)).toEqual({ kind: "leftover", label: "◌ unfinished session" });
  });
});

describe("mergeRefusalReason", () => {
  it("extracts the structured reason from a 502 refusal", () => {
    const err = new ZuzuuApiError(502, "zuzuu command failed", "", {
      ok: false,
      reason: "empty-squash-with-checkpoints",
    });
    expect(mergeRefusalReason(err)).toBe("empty-squash-with-checkpoints");
  });

  it("returns null for plain errors, missing data, and non-string reasons", () => {
    expect(mergeRefusalReason(new Error("boom"))).toBeNull();
    expect(mergeRefusalReason(new ZuzuuApiError(502, "failed", "stderr tail"))).toBeNull();
    expect(mergeRefusalReason(new ZuzuuApiError(502, "failed", "", null))).toBeNull();
    expect(mergeRefusalReason(new ZuzuuApiError(502, "failed", "", { reason: 7 }))).toBeNull();
    expect(mergeRefusalReason(new ZuzuuApiError(502, "failed", "", { reason: "" }))).toBeNull();
  });
});
