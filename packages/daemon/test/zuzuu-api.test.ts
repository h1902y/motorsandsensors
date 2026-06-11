import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runZuzuu, createZuzuuApi } from "../src/zuzuu-api.js";

let root: string;
// realpath the temp root: resolveSafe requires an already-realpath'd root (the
// daemon does this at startup); on macOS /var → /private/var would else 403.
beforeEach(() => { root = realpathSync(mkdtempSync(path.join(tmpdir(), "zw-"))); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

function fixtureHome(r: string) {
  const agent = path.join(r, "agent");
  for (const f of ["knowledge", "memory", "actions", "instructions", "guardrails"])
    mkdirSync(path.join(agent, f, "proposals"), { recursive: true });
  mkdirSync(path.join(agent, "knowledge", "items"), { recursive: true });
  mkdirSync(path.join(agent, "generations"), { recursive: true });
  mkdirSync(path.join(agent, ".live"), { recursive: true });
  writeFileSync(path.join(agent, "sessions.json"), JSON.stringify({ version: 1, sessions: [{ id: "s1", host: "claude-code" }] }));
  writeFileSync(path.join(agent, "knowledge", "items", "k1.json"), JSON.stringify({ id: "k1", body: "fact one" }));
  writeFileSync(path.join(agent, "knowledge", "proposals", "p1.json"),
    JSON.stringify({ id: "p1", candidate: { body: "use node:sqlite" } }));
  writeFileSync(path.join(agent, ".live", "digest.md"), "# zuzuu faculty digest\n");
  return agent;
}

function jsonStub(r: string, payload: string) {
  const stub = path.join(r, "zuzuu-stub.sh");
  writeFileSync(stub, `#!/bin/sh\necho '${payload}'\n`);
  chmodSync(stub, 0o755);
  return stub;
}

describe("runZuzuu", () => {
  it("returns null when the binary is absent", async () => {
    const out = await runZuzuu(root, ["status"], { binary: "definitely-not-a-real-binary-zzz" });
    expect(out).toBeNull();
  });
  it("parses JSON stdout from a stub binary", async () => {
    const stub = jsonStub(root, '{"ok":true}');
    const out = await runZuzuu(root, ["status"], { binary: stub });
    expect(out).toEqual({ ok: true });
  });
});

describe("createZuzuuApi file routes", () => {
  it("GET /health reports home + bin presence", async () => {
    fixtureHome(root);
    const app = createZuzuuApi(() => root, { binary: "definitely-not-real-zzz" });
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ home: true, zuzuuBin: false });
  });
  it("missing agent/ → /health home:false (no throw)", async () => {
    const app = createZuzuuApi(() => root, { binary: "x" });
    expect((await (await app.request("/health")).json()).home).toBe(false);
  });
  it("GET /faculties lists the five with counts", async () => {
    fixtureHome(root);
    const app = createZuzuuApi(() => root, { binary: "x" });
    const body = await (await app.request("/faculties")).json();
    expect(body.faculties).toHaveLength(5);
    const k = body.faculties.find((f: { key: string }) => f.key === "knowledge");
    expect(k.count).toBe(1);
    expect(k.pending).toBe(1);
  });
  it("GET /faculty/:key returns items + proposals; rejects unknown", async () => {
    fixtureHome(root);
    const app = createZuzuuApi(() => root, { binary: "x" });
    const body = await (await app.request("/faculty/knowledge")).json();
    expect(body.items[0].id).toBe("k1");
    expect(body.proposals[0].title).toMatch(/node:sqlite/);
    expect((await app.request("/faculty/bogus")).status).toBe(404);
  });
  it("GET /sessions returns the index", async () => {
    fixtureHome(root);
    const app = createZuzuuApi(() => root, { binary: "x" });
    const body = await (await app.request("/sessions")).json();
    expect(body.sessions[0].id).toBe("s1");
  });
  it("GET /generations reads lockfiles + active pointer", async () => {
    const agent = fixtureHome(root);
    writeFileSync(path.join(agent, "generations", "gen_001.json"), JSON.stringify({ id: "gen_001", mintedAt: "2026-06-12", mintedFrom: ["p1"] }));
    writeFileSync(path.join(agent, "generations", "active"), JSON.stringify({ active: "gen_001" }));
    const app = createZuzuuApi(() => root, { binary: "x" });
    const body = await (await app.request("/generations")).json();
    expect(body.active).toBe("gen_001");
    expect(body.generations[0].id).toBe("gen_001");
  });
  it("GET /digest reads the live digest", async () => {
    fixtureHome(root);
    const app = createZuzuuApi(() => root, { binary: "x" });
    expect((await (await app.request("/digest")).json()).text).toMatch(/faculty digest/);
  });
  it("path escape is rejected (no traversal)", async () => {
    fixtureHome(root);
    const app = createZuzuuApi(() => root, { binary: "x" });
    expect((await app.request("/faculty/..%2f..%2fetc")).status).toBe(404);
  });
});

describe("createZuzuuApi computed routes", () => {
  it("GET /status uses zuzuu --json when available", async () => {
    fixtureHome(root);
    const stub = jsonStub(root, '{"home":true,"activeGeneration":"gen_001","pending":{"knowledge":2},"drift":{"dirty":false,"items":[]}}');
    const app = createZuzuuApi(() => root, { binary: stub });
    const body = await (await app.request("/status")).json();
    expect(body.activeGeneration).toBe("gen_001");
    expect(body.pending.knowledge).toBe(2);
  });
  it("GET /status falls back to file-reads when zuzuu is absent", async () => {
    fixtureHome(root);
    const app = createZuzuuApi(() => root, { binary: "definitely-not-real-zzz" });
    const body = await (await app.request("/status")).json();
    expect(body.home).toBe(true);
    expect(body.pending.knowledge).toBe(1);  // computed from the proposal file
  });
  it("GET /inbox falls back to file-reads when zuzuu is absent", async () => {
    fixtureHome(root);
    const app = createZuzuuApi(() => root, { binary: "definitely-not-real-zzz" });
    const body = await (await app.request("/inbox")).json();
    expect(body.total).toBe(1);
    expect(body.pending[0].faculty).toBe("knowledge");
  });
});
