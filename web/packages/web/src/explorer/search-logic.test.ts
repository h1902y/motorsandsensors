// Pure logic tests for the Files-panel search (no DOM needed).
import { describe, expect, it } from "vitest";
import { buildFilteredRows, canSearch, shiftRanges } from "./search-logic";

describe("shiftRanges", () => {
  it("returns ranges untouched when there is no leading whitespace", () => {
    expect(shiftRanges({ text: "abc def", ranges: [[4, 7]] })).toEqual([[4, 7]]);
  });

  it("shifts ranges left by the trimmed whitespace", () => {
    expect(shiftRanges({ text: "    abc", ranges: [[4, 7]] })).toEqual([[0, 3]]);
  });

  it("clamps to 0 and drops ranges that collapse inside the trimmed prefix", () => {
    // a match entirely inside the leading whitespace vanishes after trimStart
    expect(shiftRanges({ text: "    x", ranges: [[1, 3]] })).toEqual([]);
    // a match straddling the cut is clamped to start at 0
    expect(shiftRanges({ text: "  ab", ranges: [[1, 4]] })).toEqual([[0, 2]]);
  });
});

describe("canSearch", () => {
  it("requires 2 trimmed characters", () => {
    expect(canSearch("")).toBe(false);
    expect(canSearch("a")).toBe(false);
    expect(canSearch(" a ")).toBe(false);
    expect(canSearch("ab")).toBe(true);
    expect(canSearch("  ab  ")).toBe(true);
  });
});

describe("buildFilteredRows", () => {
  it("nests matching files under their ancestor dirs in DFS order", () => {
    expect(buildFilteredRows(["src/a.ts", "src/sub/b.ts", "README.md"])).toEqual([
      { path: "README.md", name: "README.md", depth: 0, isDir: false },
      { path: "src", name: "src", depth: 0, isDir: true },
      { path: "src/a.ts", name: "a.ts", depth: 1, isDir: false },
      { path: "src/sub", name: "sub", depth: 1, isDir: true },
      { path: "src/sub/b.ts", name: "b.ts", depth: 2, isDir: false },
    ]);
  });
  it("dedupes shared ancestors and handles root-level files", () => {
    const rows = buildFilteredRows(["a/x.ts", "a/y.ts"]);
    expect(rows.filter((r) => r.isDir)).toEqual([{ path: "a", name: "a", depth: 0, isDir: true }]);
    expect(rows.filter((r) => !r.isDir).map((r) => r.path)).toEqual(["a/x.ts", "a/y.ts"]);
  });
  it("returns nothing for no matches", () => {
    expect(buildFilteredRows([])).toEqual([]);
  });
});
