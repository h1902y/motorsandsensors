// Pure logic tests for the Start-agent-session host rows (no DOM needed).
import { describe, expect, it } from "vitest";
import { agentTabTitle, buildHostRows, composerDefaultHost, hostSpawnSpec } from "./host-launch";

describe("buildHostRows", () => {
  it("lists the four known hosts plus the always-available bundled OpenCode", () => {
    const rows = buildHostRows([]);
    expect(rows.map((r) => r.command)).toEqual(["claude", "gemini", "codex", "pi", "zuzuu code"]);
    expect(rows.at(-1)).toEqual({ label: "OpenCode (bundled)", command: "zuzuu code", detected: true });
  });

  it("marks only detected hosts launchable; OpenCode stays launchable regardless", () => {
    const rows = buildHostRows([{ name: "claude-code" }, { name: "gemini-cli" }]);
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

describe("hostSpawnSpec (row command → direct-spawn argv)", () => {
  it("maps plain host binaries to themselves with empty args", () => {
    expect(hostSpawnSpec("claude")).toEqual({ command: "claude", args: [], host: "claude" });
    expect(hostSpawnSpec("gemini")).toEqual({ command: "gemini", args: [], host: "gemini" });
    expect(hostSpawnSpec("codex")).toEqual({ command: "codex", args: [], host: "codex" });
    expect(hostSpawnSpec("pi")).toEqual({ command: "pi", args: [], host: "pi" });
  });

  it("maps bundled OpenCode to `zuzuu code` (argv, never a shell string)", () => {
    expect(hostSpawnSpec("zuzuu code")).toEqual({ command: "zuzuu", args: ["code"], host: "opencode" });
  });

  it("covers every row buildHostRows can emit", () => {
    for (const row of buildHostRows([])) {
      expect(hostSpawnSpec(row.command)).not.toBeNull();
    }
  });

  it("returns null for unknown commands", () => {
    expect(hostSpawnSpec("cursor")).toBeNull();
    expect(hostSpawnSpec("zuzuu")).toBeNull(); // only the full "zuzuu code" row maps
  });
});

describe("agentTabTitle", () => {
  it("titles agent tabs by host display name", () => {
    expect(agentTabTitle("claude")).toBe("Claude Code");
    expect(agentTabTitle("gemini")).toBe("Gemini CLI");
    expect(agentTabTitle("opencode")).toBe("OpenCode");
    expect(agentTabTitle("pi")).toBe("pi");
  });

  it("falls back to the raw host id, then to 'agent'", () => {
    expect(agentTabTitle("somefuturehost")).toBe("somefuturehost");
    expect(agentTabTitle(undefined)).toBe("agent");
  });
});

describe("composerDefaultHost (Enter = first detected, in menu order)", () => {
  it("picks the first detected row in menu order", () => {
    const rows = buildHostRows([{ name: "codex" }, { name: "claude-code" }]);
    expect(composerDefaultHost(rows)?.command).toBe("claude"); // menu order, not detection order
  });

  it("falls back to bundled OpenCode when no host CLI is detected", () => {
    const rows = buildHostRows([]);
    expect(composerDefaultHost(rows)?.command).toBe("zuzuu code");
  });

  it("keeps undetected hosts out of the default (they render greyed)", () => {
    const rows = buildHostRows([{ name: "pi" }]);
    expect(composerDefaultHost(rows)?.command).toBe("pi");
    // ordering invariant: rows stay in menu order with detection flags
    expect(rows.map((r) => `${r.command}:${r.detected ? 1 : 0}`)).toEqual([
      "claude:0", "gemini:0", "codex:0", "pi:1", "zuzuu code:1",
    ]);
  });

  it("null only for an empty row set (defensive)", () => {
    expect(composerDefaultHost([])).toBeNull();
  });
});
