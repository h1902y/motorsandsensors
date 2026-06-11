import os from "node:os";
import { afterAll, describe, expect, it } from "vitest";
import { shellQuote } from "@zuzuu-web/protocol";
import { SessionManager } from "../src/sessions.js";

describe("shellQuote", () => {
  it("wraps plain paths", () => {
    expect(shellQuote("/a/b c")).toBe("'/a/b c'");
  });
  it("escapes embedded single quotes", () => {
    expect(shellQuote("it's here")).toBe(`'it'\\''s here'`);
  });
  it("neutralizes shell metacharacters", () => {
    expect(shellQuote("$(rm -rf ~)`x`;&|")).toBe("'$(rm -rf ~)`x`;&|'");
  });
});

describe("asciicast recording", () => {
  const manager = new SessionManager(os.tmpdir());

  afterAll(() => manager.shutdown());

  it("serializes a valid v2 cast with output events and no input events", async () => {
    const session = manager.create(undefined, 80, 24);
    session.write("echo cast-test-marker\r");
    // wait for the shell to produce output
    await new Promise((r) => setTimeout(r, 1200));
    const cast = session.recording();
    const lines = cast.trim().split("\n");

    const header = JSON.parse(lines[0]!);
    expect(header.version).toBe(2);
    expect(header.width).toBe(80);
    expect(header.height).toBe(24);
    expect(typeof header.timestamp).toBe("number");

    const events = lines.slice(1).map((l) => JSON.parse(l) as [number, string, string]);
    expect(events.length).toBeGreaterThan(0);
    for (const [t, code] of events) {
      expect(typeof t).toBe("number");
      expect(["o", "r"]).toContain(code); // never "i"
    }
    // elapsed times are monotonically non-decreasing
    for (let i = 1; i < events.length; i++) {
      expect(events[i]![0]).toBeGreaterThanOrEqual(events[i - 1]![0]);
    }
    expect(events.some(([, , data]) => data.includes("cast-test-marker"))).toBe(true);
  }, 10_000);

  it("records resizes as r events", async () => {
    const session = manager.create(undefined, 80, 24);
    session.resize(120, 40);
    const cast = session.recording();
    const events = cast.trim().split("\n").slice(1).map((l) => JSON.parse(l));
    expect(events.some(([, code, data]) => code === "r" && data === "120x40")).toBe(true);
  });
});
