// Pure logic tests for the Start-agent-session host rows (no DOM needed).
import { describe, expect, it } from "vitest";
import { buildHostRows } from "./host-launch";

describe("buildHostRows", () => {
  it("lists the four known hosts plus the always-available bundled OpenCode", () => {
    const rows = buildHostRows([]);
    expect(rows.map((r) => r.command)).toEqual(["claude", "gemini", "codex", "pi", "zuzuu code"]);
    expect(rows.at(-1)).toEqual({ label: "OpenCode (bundled)", command: "zuzuu code", detected: true });
  });

  it("marks only detected hosts launchable; OpenCode stays launchable regardless", () => {
    const rows = buildHostRows([{ name: "claude" }, { name: "gemini-cli" }]);
    expect(rows.map((r) => [r.command, r.detected])).toEqual([
      ["claude", true],
      ["gemini", true],
      ["codex", false],
      ["pi", false],
      ["zuzuu code", true],
    ]);
  });

  it("matches on the daemon's host name, not the command (gemini-cli → gemini)", () => {
    const rows = buildHostRows([{ name: "gemini" }]); // wrong key — not the daemon's name
    expect(rows.find((r) => r.command === "gemini")!.detected).toBe(false);
  });

  it("ignores unknown host names instead of adding rows", () => {
    const rows = buildHostRows([{ name: "cursor" }, { name: "pi" }]);
    expect(rows).toHaveLength(5);
    expect(rows.find((r) => r.command === "pi")!.detected).toBe(true);
  });
});
