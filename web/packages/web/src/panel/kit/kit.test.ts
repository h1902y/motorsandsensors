// Pure tests for the panel kit's logic: card status mapping, kind→icon
// totality over every envelope kind, relative-time formatting.
import { describe, expect, it } from "vitest";
import {
  ALL_ENVELOPE_KINDS, DEFAULT_KIND_ICON, FACULTY_META, FACULTY_ORDER,
  KIND_ICONS, cardStatus, kindIcon, latestUpdate, relativeTime,
} from "./kit";

describe("cardStatus (the 3px status bar)", () => {
  it("empty: no items, nothing pending", () => {
    expect(cardStatus(0, 0)).toBe("empty");
  });
  it("ok: items > 0 and pending = 0", () => {
    expect(cardStatus(1, 0)).toBe("ok");
    expect(cardStatus(42, 0)).toBe("ok");
  });
  it("pending wins whenever pending > 0 — even with zero items", () => {
    expect(cardStatus(0, 1)).toBe("pending");
    expect(cardStatus(5, 2)).toBe("pending");
  });
});

describe("kind→icon map", () => {
  it("is total over every envelope kind", () => {
    for (const kind of ALL_ENVELOPE_KINDS) {
      expect(KIND_ICONS[kind], `missing icon for kind '${kind}'`).toBeTruthy();
      expect(kindIcon(kind)).toBe(KIND_ICONS[kind]);
    }
  });
  it("falls back for unknown kinds (knowledge's set is open) and undefined", () => {
    expect(kindIcon("brand-new-registry-kind")).toBe(DEFAULT_KIND_ICON);
    expect(kindIcon(undefined)).toBe(DEFAULT_KIND_ICON);
  });
  it("every icon is a distinct-enough non-empty path", () => {
    for (const d of Object.values(KIND_ICONS)) expect(d.length).toBeGreaterThan(8);
  });
});

describe("faculty metadata", () => {
  it("covers the five faculties in display order with teaching copy", () => {
    expect(FACULTY_ORDER).toEqual(["knowledge", "memory", "actions", "instructions", "guardrails"]);
    for (const key of FACULTY_ORDER) {
      const meta = FACULTY_META[key];
      expect(meta.label).toBeTruthy();
      expect(meta.icon).toBeTruthy();
      expect(meta.emptyHeadline).toMatch(/^No /);
      // ONE teaching sentence
      expect(meta.teach.trim().endsWith(".")).toBe(true);
      expect(meta.teach.split(". ").length).toBe(1);
    }
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-06-13T12:00:00Z");
  it("null for missing or unparseable input", () => {
    expect(relativeTime(null, now)).toBeNull();
    expect(relativeTime(undefined, now)).toBeNull();
    expect(relativeTime("not-a-date", now)).toBeNull();
  });
  it("formats the ladder: just now → m → h → d → mo → y", () => {
    expect(relativeTime("2026-06-13T11:59:30Z", now)).toBe("just now");
    expect(relativeTime("2026-06-13T11:45:00Z", now)).toBe("15m ago");
    expect(relativeTime("2026-06-13T10:00:00Z", now)).toBe("2h ago");
    expect(relativeTime("2026-06-10T12:00:00Z", now)).toBe("3d ago");
    expect(relativeTime("2026-04-01T12:00:00Z", now)).toBe("2mo ago");
    expect(relativeTime("2024-05-01T12:00:00Z", now)).toBe("2y ago");
  });
  it("clamps future timestamps (clock skew) to just now", () => {
    expect(relativeTime("2026-06-13T13:00:00Z", now)).toBe("just now");
  });
  it("accepts date-only ISO (envelope created_at may omit time)", () => {
    expect(relativeTime("2026-06-11", now)).toMatch(/d ago$/);
  });
});

describe("latestUpdate", () => {
  it("picks the newest updated_at ?? created_at across items", () => {
    expect(latestUpdate([
      { created_at: "2026-06-10T00:00:00Z" },
      { created_at: "2026-06-01T00:00:00Z", updated_at: "2026-06-12T00:00:00Z" },
      { created_at: "2026-06-11T00:00:00Z" },
    ])).toBe("2026-06-12T00:00:00Z");
  });
  it("null when no item carries a timestamp (degraded peek)", () => {
    expect(latestUpdate([])).toBeNull();
    expect(latestUpdate([{}, { updated_at: "garbage" }])).toBeNull();
  });
});
