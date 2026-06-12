// Pure logic tests for the Files-panel search (no DOM needed).
import { describe, expect, it } from "vitest";
import { canSearch, shiftRanges } from "./search-logic";

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
