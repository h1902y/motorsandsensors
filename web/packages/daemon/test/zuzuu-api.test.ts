import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync, realpathSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { runZuzuu, runZuzuuMut, createZuzuuApi } from "../src/zuzuu-api.js";

let root: string;
// realpath the temp root: resolveSafe requires an already-realpath'd root (the
// daemon does this at startup); on macOS /var → /private/var would else 403.
beforeEach(() => { root = realpathSync(mkdtempSync(path.join(tmpdir(), "zw-"))); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

function fixtureHome(r: string) {
  const agent = path.join(r, ".zuzuu");
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

/** A stub that exits non-zero after writing to stderr. */
function failStub(r: string, msg = "boom: faculty not found") {
  const stub = path.join(r, "zuzuu-fail.sh");
  writeFileSync(stub, `#!/bin/sh\necho '${msg}' >&2\nexit 1\n`);
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

/** A stub that creates a marker file when executed — for asserting NO spawn happened. */
function markerStub(r: string) {
  const marker = path.join(r, "spawned.marker");
  const stub = path.join(r, "zuzuu-marker.sh");
  writeFileSync(stub, `#!/bin/sh\ntouch '${marker}'\necho '{}'\n`);
  chmodSync(stub, 0o755);
  return { stub, marker };
}

describe("runZuzuuMut", () => {
  it("absent binary → {ok:false, code:'absent'}", async () => {
    const r = await runZuzuuMut(root, ["proposals", "approve", "p1"], { binary: "definitely-not-a-real-binary-zzz" });
    expect(r).toEqual({ ok: false, code: "absent" });
  });
  it("stub success → {ok:true, data} with parsed stdout JSON", async () => {
    const stub = jsonStub(root, '{"ok":true,"action":"approve","itemIds":["k2"],"warnings":[]}');
    const r = await runZuzuuMut(root, ["proposals", "approve", "p1"], { binary: stub });
    expect(r).toEqual({ ok: true, data: { ok: true, action: "approve", itemIds: ["k2"], warnings: [] } });
  });
  it("non-zero exit → {ok:false, code:'failed'} with stderr tail", async () => {
    const stub = failStub(root, "no such proposal: p9");
    const r = await runZuzuuMut(root, ["proposals", "approve", "p9"], { binary: stub });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("failed");
      expect(r.stderr).toMatch(/no such proposal: p9/);
    }
  });
  it("unparseable stdout on exit 0 → 'failed'", async () => {
    const stub = jsonStub(root, "not json at all");
    const r = await runZuzuuMut(root, ["generation", "mint"], { binary: stub });
    expect(r).toMatchObject({ ok: false, code: "failed" });
  });
  it("non-ENOENT spawn error (EACCES) → {ok:false, code:'failed'} not 'absent'", async () => {
    // Skip on Windows: chmod is a no-op there and EACCES isn't raised the same way.
    if (process.platform === "win32") return;
    const notExec = path.join(root, "not-executable");
    writeFileSync(notExec, "#!/bin/sh\necho '{}'\n");
    chmodSync(notExec, 0o644); // readable but not executable → EACCES on spawn
    const r = await runZuzuuMut(root, ["any"], { binary: notExec });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("failed");
      expect(r.stderr).toBeTruthy();
    }
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
  it("missing .zuzuu/ → /health home:false (no throw)", async () => {
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

const post = (app: ReturnType<typeof createZuzuuApi>, p: string, body?: unknown) =>
  app.request(p, {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

// Every mutation route: [path, request body, stub success payload]
const MUTATIONS: [string, unknown, Record<string, unknown>][] = [
  ["/proposals/p1/approve", { faculty: "knowledge" }, { ok: true, action: "approve", itemIds: ["k2"], warnings: [] }],
  ["/proposals/p1/reject", { faculty: "knowledge", reason: "dup of k1" }, { ok: true, id: "p1" }],
  ["/actions/my-slug/approve", {}, { ok: true, action: "approve", slug: "my-slug" }],
  ["/actions/my-slug/reject", {}, { ok: true, action: "reject", slug: "my-slug" }],
  ["/generation/mint", { from: ["p1", "p2"] }, { id: "gen_002", mintedFrom: ["p1", "p2"], forkedFrom: "gen_001" }],
  ["/generation/gen_001/rollback", {}, { ok: true, restored: 3, active: "gen_001" }],
];

describe("createZuzuuApi mutation routes", () => {
  for (const [route, body, payload] of MUTATIONS) {
    it(`POST ${route} → 200 with the CLI's JSON on stub success`, async () => {
      fixtureHome(root);
      const app = createZuzuuApi(() => root, { binary: jsonStub(root, JSON.stringify(payload)) });
      const res = await post(app, route, body);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(payload);
    });
    it(`POST ${route} → 502 + stderr tail when the CLI fails`, async () => {
      fixtureHome(root);
      const app = createZuzuuApi(() => root, { binary: failStub(root, "kaboom from zuzuu") });
      const res = await post(app, route, body);
      expect(res.status).toBe(502);
      const j = await res.json();
      expect(j.error).toBe("zuzuu command failed");
      expect(j.stderr).toMatch(/kaboom from zuzuu/);
    });
    it(`POST ${route} → 503 when the binary is absent`, async () => {
      fixtureHome(root);
      const app = createZuzuuApi(() => root, { binary: "definitely-not-a-real-binary-zzz" });
      const res = await post(app, route, body);
      expect(res.status).toBe(503);
      expect((await res.json()).error).toBe("zuzuu CLI required");
    });
  }

  it("traversal id ../x → 400, and the binary is NEVER spawned", async () => {
    fixtureHome(root);
    const { stub, marker } = markerStub(root);
    const app = createZuzuuApi(() => root, { binary: stub });
    for (const route of [
      "/proposals/..%2fx/approve",
      "/proposals/..%2fx/reject",
      "/actions/..%2fx/approve",
      "/actions/..%2fx/reject",
      "/generation/..%2fx/rollback",
    ]) {
      const res = await post(app, route, { faculty: "knowledge" });
      expect(res.status).toBe(400);
    }
    expect(existsSync(marker)).toBe(false);
  });
  it("shell-meta id a;rm → 400 without spawn", async () => {
    fixtureHome(root);
    const { stub, marker } = markerStub(root);
    const app = createZuzuuApi(() => root, { binary: stub });
    expect((await post(app, "/proposals/a;rm/approve", { faculty: "knowledge" })).status).toBe(400);
    expect((await post(app, "/actions/a;rm/reject", {})).status).toBe(400);
    expect(existsSync(marker)).toBe(false);
  });
  it("bogus faculty → 400 without spawn", async () => {
    fixtureHome(root);
    const { stub, marker } = markerStub(root);
    const app = createZuzuuApi(() => root, { binary: stub });
    expect((await post(app, "/proposals/p1/approve", { faculty: "bogus" })).status).toBe(400);
    expect((await post(app, "/proposals/p1/reject", { faculty: "bogus" })).status).toBe(400);
    expect((await post(app, "/proposals/p1/approve", {})).status).toBe(400);
    expect(existsSync(marker)).toBe(false);
  });
  it("over-long reject reason → 400 without spawn", async () => {
    fixtureHome(root);
    const { stub, marker } = markerStub(root);
    const app = createZuzuuApi(() => root, { binary: stub });
    const res = await post(app, "/proposals/p1/reject", { faculty: "knowledge", reason: "x".repeat(501) });
    expect(res.status).toBe(400);
    expect(existsSync(marker)).toBe(false);
  });
  it("200-char id → 400 without spawn (SAFE_ID length cap)", async () => {
    fixtureHome(root);
    const { stub, marker } = markerStub(root);
    const app = createZuzuuApi(() => root, { binary: stub });
    const longId = "a".repeat(200);
    expect((await post(app, `/proposals/${longId}/approve`, { faculty: "knowledge" })).status).toBe(400);
    expect(existsSync(marker)).toBe(false);
  });
  it("mint with 201-element from[] → 400 without spawn", async () => {
    fixtureHome(root);
    const { stub, marker } = markerStub(root);
    const app = createZuzuuApi(() => root, { binary: stub });
    const ids = Array.from({ length: 201 }, (_, i) => `id${i}`);
    expect((await post(app, "/generation/mint", { from: ids })).status).toBe(400);
    expect(existsSync(marker)).toBe(false);
  });
  it("reject reason rides as one argv element (shell-meta inert)", async () => {
    fixtureHome(root);
    // a stub that echoes its argv as JSON so we can see exactly what was passed
    const stub = path.join(root, "zuzuu-argv.sh");
    writeFileSync(stub, `#!/bin/sh\nprintf '{"argv":"'\nprintf '%s|' "$@"\nprintf '"}'\n`);
    chmodSync(stub, 0o755);
    const app = createZuzuuApi(() => root, { binary: stub });
    const res = await post(app, "/proposals/p1/reject", { faculty: "knowledge", reason: "dup; $(rm -rf) of k1" });
    expect(res.status).toBe(200);
    expect((await res.json()).argv).toBe("proposals|reject|p1|--faculty|knowledge|--reason|dup; $(rm -rf) of k1|--json|");
  });
  it("mint with a bad from-id → 400 without spawn; mint with no body → 200", async () => {
    fixtureHome(root);
    const { stub, marker } = markerStub(root);
    const app = createZuzuuApi(() => root, { binary: stub });
    expect((await post(app, "/generation/mint", { from: ["ok-id", "../evil"] })).status).toBe(400);
    expect((await post(app, "/generation/mint", { from: "p1" })).status).toBe(400);
    expect(existsSync(marker)).toBe(false);
    const ok = createZuzuuApi(() => root, { binary: jsonStub(root, '{"id":"gen_002","mintedFrom":[],"forkedFrom":null}') });
    expect((await post(ok, "/generation/mint")).status).toBe(200);
  });
});

describe("createZuzuuApi eval + hosts", () => {
  it("GET /eval uses zuzuu eval --json when available", async () => {
    fixtureHome(root);
    const payload = { ranked: [{ id: "p1", faculty: "knowledge", title: "t", score: 0.9, confidence: "high", rationale: "r" }] };
    const app = createZuzuuApi(() => root, { binary: jsonStub(root, JSON.stringify(payload)) });
    const res = await app.request("/eval");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(payload);
  });
  it("GET /eval falls back to pending proposals with null scores when zuzuu is absent", async () => {
    fixtureHome(root);
    const app = createZuzuuApi(() => root, { binary: "definitely-not-real-zzz" });
    const body = await (await app.request("/eval")).json();
    expect(body.ranked).toHaveLength(1);
    expect(body.ranked[0]).toMatchObject({ id: "p1", faculty: "knowledge", score: null, confidence: null, rationale: null });
    expect(body.ranked[0].title).toMatch(/node:sqlite/);
  });
  it("GET /hosts surfaces hosts from zuzuu status", async () => {
    fixtureHome(root);
    const app = createZuzuuApi(() => root, { binary: jsonStub(root, '{"home":true,"hosts":[{"name":"claude-code"},{"name":"opencode"}]}') });
    const body = await (await app.request("/hosts")).json();
    expect(body).toEqual({ hosts: [{ name: "claude-code" }, { name: "opencode" }], cliAbsent: false });
  });
  it("GET /hosts → cliAbsent:true with empty hosts when zuzuu is absent", async () => {
    fixtureHome(root);
    const app = createZuzuuApi(() => root, { binary: "definitely-not-real-zzz" });
    const body = await (await app.request("/hosts")).json();
    expect(body).toEqual({ hosts: [], cliAbsent: true });
  });
});
