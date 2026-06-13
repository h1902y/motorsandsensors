import { describe, it, expect } from "vitest";
import { genLadderLabel, nextGenRemaining } from "./progression";

describe("progression", () => {
  it("labels the path to the next generation with the concrete requirement", () => {
    expect(genLadderLabel(3, "approved proposals", 4)).toBe("3 more approved proposals → Gen 4");
  });
  it("uses singular when one remains", () => {
    expect(genLadderLabel(1, "approved proposals", 4)).toBe("1 more approved proposal → Gen 4");
  });
  it("celebrates readiness when nothing remains", () => {
    expect(genLadderLabel(0, "approved proposals", 4)).toBe("Ready to mint Gen 4");
  });
  it("computes remaining from a threshold, clamped at zero", () => {
    expect(nextGenRemaining(2, 5)).toBe(3);
    expect(nextGenRemaining(7, 5)).toBe(0);
  });
});
