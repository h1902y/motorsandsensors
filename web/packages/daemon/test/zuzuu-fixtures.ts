// Shared fixtures for the zuzuu daemon tests: a synthetic .zuzuu/ home and
// the stub-binary pattern (a tiny shell script standing in for the zuzuu CLI
// so route tests never depend on the real binary).
import { mkdirSync, writeFileSync, chmodSync } from "node:fs";
import path from "node:path";

/** A Module Standard envelope item (strict frontmatter + prose body). */
export function envelope(fields: Record<string, string>, body = ""): string {
  const fm = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("\n");
  return `---\n${fm}\n---\n${body}`;
}

/** Seed a minimal .zuzuu/ home under `r`: five modules, one knowledge item,
 *  one pending proposal, a sessions index and a live digest. */
export function fixtureHome(r: string): string {
  const agent = path.join(r, ".zuzuu");
  for (const f of ["knowledge", "memory", "actions", "instructions", "guardrails"])
    mkdirSync(path.join(agent, f, "proposals"), { recursive: true });
  mkdirSync(path.join(agent, "knowledge", "items"), { recursive: true });
  mkdirSync(path.join(agent, "generations"), { recursive: true });
  mkdirSync(path.join(agent, ".live"), { recursive: true });
  writeFileSync(path.join(agent, "sessions.json"), JSON.stringify({ version: 1, sessions: [{ id: "s1", host: "claude-code" }] }));
  writeFileSync(path.join(agent, "knowledge", "items", "k1.md"),
    envelope({ id: "k1", module: "knowledge", kind: "fact", title: '"fact one"', status: "active", created_at: "2026-06-12T00:00:00Z" }, "fact one\n"));
  writeFileSync(path.join(agent, "knowledge", "proposals", "p1.json"),
    JSON.stringify({
      id: "p1",
      payload: { type: "fact", body: "use node:sqlite" },
      evidence: { occurrences: 12, sessions: 3, failures: 0 },
      analysis: { er: { verdict: "new" } },
      score: { score: 0.775, confidence: "high", rationale: "recurring + cross-session" },
    }));
  writeFileSync(path.join(agent, ".live", "digest.md"), "# zuzuu module digest\n");
  return agent;
}

/** A stub zuzuu binary that prints `payload` on stdout and exits 0. */
export function jsonStub(r: string, payload: string): string {
  const stub = path.join(r, "zuzuu-stub.sh");
  writeFileSync(stub, `#!/bin/sh\necho '${payload}'\n`);
  chmodSync(stub, 0o755);
  return stub;
}

/** A stub that exits non-zero after writing to stderr. */
export function failStub(r: string, msg = "boom: module not found"): string {
  const stub = path.join(r, "zuzuu-fail.sh");
  writeFileSync(stub, `#!/bin/sh\necho '${msg}' >&2\nexit 1\n`);
  chmodSync(stub, 0o755);
  return stub;
}

/** A stub that creates a marker file when executed — for asserting NO spawn happened. */
export function markerStub(r: string): { stub: string; marker: string } {
  const marker = path.join(r, "spawned.marker");
  const stub = path.join(r, "zuzuu-marker.sh");
  writeFileSync(stub, `#!/bin/sh\ntouch '${marker}'\necho '{}'\n`);
  chmodSync(stub, 0o755);
  return { stub, marker };
}

/** A stub that echoes its argv as JSON — shows exactly what reached the CLI. */
export function argvStub(r: string, name = "zuzuu-argv.sh"): string {
  const stub = path.join(r, name);
  writeFileSync(stub, `#!/bin/sh\nprintf '{"argv":"'\nprintf '%s|' "$@"\nprintf '"}'\n`);
  chmodSync(stub, 0o755);
  return stub;
}
