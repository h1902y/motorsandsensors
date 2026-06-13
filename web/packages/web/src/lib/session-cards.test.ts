// Pure logic tests for the session-surface card-state machine (no DOM needed).
import { describe, expect, it } from "vitest";
import type { SessionCloseResult, SessionGitStatus } from "@zuzuu-web/protocol";
import {
  blockReceipt,
  centerCard,
  endCard,
  fmtDuration,
  hasAliveAgent,
  receiptForCommand,
} from "./session-cards";

const leftover: SessionGitStatus = {
  enabled: true,
  mainBranch: "main",
  active: { branch: "zz/session-abc", checkpoints: 3, dirty: false, noNetChanges: false },
  onSessionBranch: false,
};

describe("centerCard (none / recovery — starting moved to the composer)", () => {
  it("shows nothing while sessions exist", () => {
    expect(centerCard(2, undefined)).toEqual({ kind: "none" });
    expect(centerCard(1, leftover)).toEqual({ kind: "none" }); // tabs win over leftover
  });

  it("shows nothing with zero sessions (the composer is the start surface)", () => {
    expect(centerCard(0, undefined)).toEqual({ kind: "none" });
  });

  it("shows recovery for a leftover session branch on load", () => {
    expect(centerCard(0, leftover)).toEqual({
      kind: "recovery",
      branch: "zz/session-abc",
      checkpoints: 3,
    });
  });

  it("treats on-branch / disabled / cli-absent / branchless states as none, not recovery", () => {
    expect(centerCard(0, { ...leftover, onSessionBranch: true })).toEqual({ kind: "none" });
    expect(centerCard(0, { ...leftover, enabled: false })).toEqual({ kind: "none" });
    expect(centerCard(0, { ...leftover, cliAbsent: true })).toEqual({ kind: "none" });
    expect(centerCard(0, { ...leftover, active: null })).toEqual({ kind: "none" });
  });
});

describe("hasAliveAgent (single-active-agent v1 rule)", () => {
  it("is true only for an alive type:'agent' tab", () => {
    expect(hasAliveAgent([])).toBe(false);
    expect(hasAliveAgent([{ type: "shell", alive: true }])).toBe(false);
    expect(hasAliveAgent([{ type: "agent", alive: false }])).toBe(false);
    expect(hasAliveAgent([{ type: "agent", alive: true }])).toBe(true);
    expect(
      hasAliveAgent([
        { type: "shell", alive: true },
        { type: "agent", alive: false },
        { type: "agent", alive: true },
      ]),
    ).toBe(true);
  });
});

describe("endCard (agent exit outcome → card variant)", () => {
  const merged: SessionCloseResult = {
    ok: true,
    merge: { ok: true, mergedAs: "abc123", mergedTo: "main", commits: 4, branch: "zz/session-abc" },
  };

  it("keeps the plain banner for shell sessions and unknown outcomes", () => {
    expect(endCard("shell", undefined, merged)).toEqual({ kind: "banner" });
    expect(endCard(undefined, undefined, merged)).toEqual({ kind: "banner" });
    expect(endCard("agent", "claude", undefined)).toEqual({ kind: "banner" });
  });

  it("merged → checkpoint count from the merge result", () => {
    expect(endCard("agent", "claude", merged)).toEqual({ kind: "merged", commits: 4 });
  });

  it("merged with no commit count defaults to 1", () => {
    expect(
      endCard("agent", "claude", { ok: true, merge: { ok: true, mergedAs: "abc123" } }),
    ).toEqual({ kind: "merged", commits: 1 });
  });

  it("clean exit with nothing to merge → no-changes", () => {
    expect(
      endCard("agent", "claude", { ok: true, merge: { ok: true, mergedAs: null } }),
    ).toEqual({ kind: "no-changes" });
  });

  it("absent CLI → install hint", () => {
    expect(endCard("agent", "claude", { cliAbsent: true })).toEqual({ kind: "cli-absent" });
  });

  it("empty-squash refusal → no-net-changes with retained checkpoint count", () => {
    expect(
      endCard("agent", "claude", {
        ok: false,
        refusal: { reason: "empty-squash-with-checkpoints", commits: 3 },
      }),
    ).toEqual({ kind: "no-net-changes", checkpoints: 3 });
    // count may be absent from the refusal payload
    expect(
      endCard("agent", "claude", { ok: false, refusal: { reason: "empty-squash-with-checkpoints" } }),
    ).toEqual({ kind: "no-net-changes", checkpoints: null });
    // ...or arrive inside an exit-0 merge result
    expect(
      endCard("agent", "claude", {
        ok: true,
        merge: { ok: false, reason: "empty-squash-with-checkpoints", commits: 2 },
      }),
    ).toEqual({ kind: "no-net-changes", checkpoints: 2 });
  });

  it("no-session-branch refusal reads as a plain clean end", () => {
    expect(
      endCard("agent", "claude", { ok: false, refusal: { reason: "no-session-branch" } }),
    ).toEqual({ kind: "no-changes" });
  });

  it("conflicts → conflict card (both refusal and merge-result shapes)", () => {
    expect(endCard("agent", "claude", { ok: false, refusal: { conflict: true } })).toEqual({ kind: "conflict" });
    expect(
      endCard("agent", "claude", { ok: true, merge: { ok: false, conflict: true } }),
    ).toEqual({ kind: "conflict" });
  });

  it("other failures carry an honest message (stderr preferred)", () => {
    expect(endCard("agent", "claude", { ok: false, stderr: "fatal: boom\n" })).toEqual({
      kind: "failed",
      message: "fatal: boom",
    });
    expect(endCard("agent", "claude", { ok: false, refusal: { reason: "weird" } })).toEqual({
      kind: "failed",
      message: "weird",
    });
    expect(endCard("agent", "claude", { ok: false })).toEqual({
      kind: "failed",
      message: "session merge failed",
    });
  });

  it("host 'zuzuu' (utility run: init / enable) → utility card, unconditionally", () => {
    // outcome pending (closeResult not fetched yet) — still utility, no spinner story
    expect(endCard("agent", "zuzuu", undefined)).toEqual({ kind: "utility" });
    // any merge outcome is irrelevant for utility runs
    expect(endCard("agent", "zuzuu", merged)).toEqual({ kind: "utility" });
    expect(endCard("agent", "zuzuu", { cliAbsent: true })).toEqual({ kind: "utility" });
    expect(
      endCard("agent", "zuzuu", { ok: false, refusal: { reason: "no-session-branch" } }),
    ).toEqual({ kind: "utility" });
    // other hosts spawned via the zuzuu CLI (host 'opencode') keep the merge story
    expect(endCard("agent", "opencode", merged)).toEqual({ kind: "merged", commits: 4 });
  });
});

describe("fmtDuration (mono meta chip)", () => {
  it("renders sub-second in ms and seconds with one decimal", () => {
    expect(fmtDuration(0)).toBe("0ms");
    expect(fmtDuration(245)).toBe("245ms");
    expect(fmtDuration(999)).toBe("999ms");
    expect(fmtDuration(1000)).toBe("1.0s");
    expect(fmtDuration(2500)).toBe("2.5s");
  });
  it("returns null for null/negative durations (running / unknown)", () => {
    expect(fmtDuration(null)).toBeNull();
    expect(fmtDuration(-1)).toBeNull();
  });
});

describe("receiptForCommand (humanize a command into a sans label + glyph)", () => {
  it("editor commands become 'Edited <file>' with the edit glyph", () => {
    expect(receiptForCommand("nvim src/store.mjs")).toEqual({ label: "Edited store.mjs", glyph: "edit" });
    expect(receiptForCommand("code packages/web/src/app/SessionPane.tsx")).toEqual({
      label: "Edited SessionPane.tsx",
      glyph: "edit",
    });
    expect(receiptForCommand("vim")).toEqual({ label: "Opened an editor", glyph: "edit" });
  });
  it("classifies git / search / destructive verbs by their glyph", () => {
    expect(receiptForCommand("git commit -m wip")).toEqual({ label: "git commit -m wip", glyph: "git" });
    expect(receiptForCommand("rg TODO src")).toEqual({ label: "rg TODO src", glyph: "search" });
    expect(receiptForCommand("rm -rf build")).toEqual({ label: "rm -rf build", glyph: "guardrail" });
  });
  it("everything else is a plain run, first line only", () => {
    expect(receiptForCommand("npm test\n# second line")).toEqual({ label: "npm test", glyph: "run" });
    expect(receiptForCommand("   ")).toEqual({ label: "(empty command)", glyph: "run" });
  });
});

describe("blockReceipt (command block → receipt shape)", () => {
  it("running block: no meta, default tone", () => {
    expect(blockReceipt({ command: "npm test", exitCode: null, durationMs: null })).toEqual({
      label: "npm test",
      meta: null,
      tone: "default",
      glyph: "run",
      running: true,
    });
  });
  it("clean exit: ok tone, duration in the mono meta", () => {
    expect(blockReceipt({ command: "npm test", exitCode: 0, durationMs: 2500 })).toEqual({
      label: "npm test",
      meta: "2.5s",
      tone: "ok",
      glyph: "run",
      running: false,
    });
  });
  it("failed exit: bad tone, duration + exit code in the meta", () => {
    expect(blockReceipt({ command: "npm test", exitCode: 1, durationMs: 800 })).toEqual({
      label: "npm test",
      meta: "800ms · exit 1",
      tone: "bad",
      glyph: "run",
      running: false,
    });
  });
  it("failed exit without a duration still shows the exit code", () => {
    expect(blockReceipt({ command: "false", exitCode: 2, durationMs: null })).toEqual({
      label: "false",
      meta: "exit 2",
      tone: "bad",
      glyph: "run",
      running: false,
    });
  });
});
