// Pure logic tests for the status-bar agent chip (no DOM needed).
import { describe, expect, it } from "vitest";
import { agentChipLabel } from "./agent-chip";

describe("agentChipLabel", () => {
  it("shows the active generation and pending count", () => {
    expect(agentChipLabel("gen-0007", 3)).toBe("⟡ gen-0007 · 3 pending");
  });

  it("hides the pending suffix at zero", () => {
    expect(agentChipLabel("gen-0001", 0)).toBe("⟡ gen-0001");
  });

  it("falls back to 'no gen' when no generation is active", () => {
    expect(agentChipLabel(null, 0)).toBe("⟡ no gen");
    expect(agentChipLabel(undefined, 2)).toBe("⟡ no gen · 2 pending");
  });
});
