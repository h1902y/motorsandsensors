// Pure logic tests for the agent sidebar panel + status-bar chip (no DOM needed).
import { describe, expect, it } from "vitest";
import { agentChipLabel, digestPeek, facultyQuickLinks } from "./agent-panel-logic";

describe("digestPeek", () => {
  it("returns short text whole, not truncated", () => {
    expect(digestPeek("a\nb\nc", 20)).toEqual({ text: "a\nb\nc", truncated: false });
  });

  it("clamps to the first N lines and flags truncation", () => {
    const text = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n");
    const peek = digestPeek(text, 20);
    expect(peek.truncated).toBe(true);
    expect(peek.text.split("\n")).toHaveLength(20);
    expect(peek.text.startsWith("line 1\n")).toBe(true);
    expect(peek.text.endsWith("line 20")).toBe(true);
  });

  it("treats exactly N lines as not truncated", () => {
    const text = Array.from({ length: 20 }, (_, i) => `l${i}`).join("\n");
    expect(digestPeek(text, 20).truncated).toBe(false);
  });

  it("handles the empty digest", () => {
    expect(digestPeek("", 20)).toEqual({ text: "", truncated: false });
  });
});

describe("agentChipLabel", () => {
  it("shows the active generation and pending count", () => {
    expect(agentChipLabel("gen-0007", 3)).toBe("⟡ gen-0007 · 3 pending");
  });

  it("falls back to 'no gen' when no generation is active", () => {
    expect(agentChipLabel(null, 0)).toBe("⟡ no gen");
    expect(agentChipLabel(undefined, 2)).toBe("⟡ no gen · 2 pending");
  });
});

describe("facultyQuickLinks", () => {
  it("lists the 5 faculties in anatomy order, each with its README", () => {
    const rows = facultyQuickLinks();
    expect(rows.map((r) => r.faculty)).toEqual([
      "knowledge", "memory", "actions", "instructions", "guardrails",
    ]);
    for (const row of rows) {
      expect(row.readme).toEqual({ label: "README", path: `.zuzuu/${row.faculty}/README.md` });
    }
  });

  it("adds the pinned project.md steering file under instructions only", () => {
    for (const row of facultyQuickLinks()) {
      expect(row.extras.map((l) => l.path)).toEqual(
        row.faculty === "instructions" ? [".zuzuu/instructions/project.md"] : [],
      );
    }
  });
});
