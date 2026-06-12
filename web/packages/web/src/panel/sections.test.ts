// Panel-v3 section logic: needs-you grouping, session split + state labels,
// the graduated-from-session provenance filter, duration formatting.
import { describe, expect, it } from "vitest";
import type { FacultyItem, FacultyOverviewEntry, ZuzuuSessionEntry } from "@zuzuu-web/protocol";
import {
  fmtDuration, graduatedFromSession, needsYouGroups, pendingTotal,
  sessionStateMeta, shortSessionId, splitSessions,
} from "./sections";

const entry = (id: string, pending: number, items = 0): FacultyOverviewEntry => ({
  id,
  title: id.charAt(0).toUpperCase() + id.slice(1),
  counts: { items, pending, errors: 0 },
  top: [],
});

describe("needsYouGroups (§1)", () => {
  it("groups only faculties with pending > 0, in overview order", () => {
    const groups = needsYouGroups([
      entry("knowledge", 3), entry("memory", 0), entry("actions", 1),
      entry("instructions", 0), entry("guardrails", 0),
    ]);
    expect(groups).toEqual([
      { id: "knowledge", title: "Knowledge", pending: 3 },
      { id: "actions", title: "Actions", pending: 1 },
    ]);
  });
  it("empty when nothing is pending → 'all caught up'", () => {
    expect(needsYouGroups([entry("knowledge", 0, 5)])).toEqual([]);
  });
  it("pendingTotal sums across faculties (the Review CTA count)", () => {
    expect(pendingTotal([entry("knowledge", 3), entry("actions", 1)])).toBe(4);
    expect(pendingTotal([])).toBe(0);
  });
});

const ses = (id: string, state?: string): ZuzuuSessionEntry =>
  ({ id, ...(state !== undefined ? { state } : {}) });

describe("splitSessions (§2 — active pinned)", () => {
  it("pins the active session and keeps the rest in order", () => {
    const a = ses("a", "captured");
    const b = ses("b", "active");
    const c = ses("c", "completed");
    expect(splitSessions([a, b, c])).toEqual({ active: b, rest: [a, c] });
  });
  it("no active session → null pin, list untouched", () => {
    const list = [ses("a", "captured"), ses("b", "abandoned")];
    expect(splitSessions(list)).toEqual({ active: null, rest: list });
  });
  it("only the FIRST active pins (defensive — one live session is the rule)", () => {
    const [x, y] = [ses("x", "active"), ses("y", "active")];
    const { active, rest } = splitSessions([x!, y!]);
    expect(active).toBe(x);
    expect(rest).toEqual([y]);
  });
});

describe("sessionStateMeta (state labelling)", () => {
  it("labels every lifecycle state with a tone", () => {
    expect(sessionStateMeta("active")).toEqual({ label: "active", tone: "ok", pulse: true });
    expect(sessionStateMeta("opening")).toEqual({ label: "opening", tone: "idle", pulse: true });
    expect(sessionStateMeta("completed")).toEqual({ label: "completed", tone: "ok", pulse: false });
    expect(sessionStateMeta("abandoned")).toEqual({ label: "abandoned", tone: "warn", pulse: false });
    expect(sessionStateMeta("crashed")).toEqual({ label: "crashed", tone: "danger", pulse: false });
    expect(sessionStateMeta("captured")).toEqual({ label: "captured", tone: "idle", pulse: false });
  });
  it("unknown/absent state (CLI-less fallback) degrades to a neutral dash", () => {
    expect(sessionStateMeta(undefined)).toEqual({ label: "—", tone: "idle", pulse: false });
    expect(sessionStateMeta("future-state").label).toBe("future-state");
  });
});

describe("graduatedFromSession (provenance filter)", () => {
  const item = (id: string, provenance?: Record<string, string>[]): FacultyItem =>
    ({ id, faculty: "knowledge", kind: "fact", title: id, ...(provenance ? { provenance } : {}) });

  it("keeps items whose provenance cites the session id", () => {
    const hit = item("k1", [{ session: "ses_abc", ref: "occurrences=2" }]);
    const other = item("k2", [{ session: "ses_zzz" }]);
    const none = item("k3");
    expect(graduatedFromSession([hit, other, none], "ses_abc")).toEqual([hit]);
  });
  it("matches any provenance entry, not just the first", () => {
    const multi = item("k1", [{ source: "distill" }, { session: "ses_abc" }]);
    expect(graduatedFromSession([multi], "ses_abc")).toEqual([multi]);
  });
  it("empty id or no provenance → no matches (degraded peek items)", () => {
    expect(graduatedFromSession([item("k1")], "ses_abc")).toEqual([]);
    expect(graduatedFromSession([item("k1", [{ session: "s" }])], "")).toEqual([]);
  });
});

describe("fmtDuration + shortSessionId", () => {
  it("formats the s → m → h ladder", () => {
    expect(fmtDuration(4552)).toBe("5s");
    expect(fmtDuration(330_000)).toBe("5.5m");
    expect(fmtDuration(7_440_000)).toBe("2h 4m");
  });
  it("null for missing/invalid durations", () => {
    expect(fmtDuration(null)).toBeNull();
    expect(fmtDuration(undefined)).toBeNull();
    expect(fmtDuration(-1)).toBeNull();
  });
  it("shortens ids to 8 chars", () => {
    expect(shortSessionId("20410eef-3e0b-43c3")).toBe("20410eef");
  });
});
