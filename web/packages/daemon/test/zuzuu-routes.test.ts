// The /api/zuzuu/* routes (zuzuu-routes.ts): CLI-first reads with file-read
// fallbacks, CLI-only mutations (503/502 mapping), and argv-injection gates —
// all through stub binaries (see zuzuu-fixtures.ts).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, realpathSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createZuzuuApi } from "../src/zuzuu-routes.js";
import { envelope, fixtureHome, jsonStub, failStub, markerStub, argvStub } from "./zuzuu-fixtures.js";

let root: string;
// realpath the temp root: resolveSafe requires an already-realpath'd root (the
// daemon does this at startup); on macOS /var → /private/var would else 403.
beforeEach(() => { root = realpathSync(mkdtempSync(path.join(tmpdir(), "zw-"))); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

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
  it("GET /faculties lists the five with counts (CLI absent → envelope peek)", async () => {
    fixtureHome(root);
    const app = createZuzuuApi(() => root, { binary: "definitely-not-a-real-binary-zzz" });
    const body = await (await app.request("/faculties")).json();
    expect(body.faculties).toHaveLength(5);
    const k = body.faculties.find((f: { key: string }) => f.key === "knowledge");
    expect(k.count).toBe(1);
    expect(k.pending).toBe(1);
  });
  it("GET /faculties counts dir-shaped actions (ACTION.md) in the peek", async () => {
    const agent = fixtureHome(root);
    mkdirSync(path.join(agent, "actions", "deploy"), { recursive: true });
    mkdirSync(path.join(agent, "actions", "inbox"), { recursive: true }); // never an item
    writeFileSync(path.join(agent, "actions", "deploy", "ACTION.md"),
      envelope({ id: "deploy", faculty: "actions", kind: "runbook", title: "Deploy it" }));
    const app = createZuzuuApi(() => root, { binary: "definitely-not-a-real-binary-zzz" });
    const body = await (await app.request("/faculties")).json();
    expect(body.faculties.find((f: { key: string }) => f.key === "actions").count).toBe(1);
  });
  it("GET /faculty/:key peek degrades to frontmatter fields; rejects unknown", async () => {
    fixtureHome(root);
    const app = createZuzuuApi(() => root, { binary: "definitely-not-a-real-binary-zzz" });
    const body = await (await app.request("/faculty/knowledge")).json();
    expect(body.degraded).toBe(true);
    expect(body.items[0]).toMatchObject({ id: "k1", faculty: "knowledge", kind: "fact", title: "fact one", status: "active" });
    expect(body.items[0].payload).toBeUndefined(); // detail degrades, counts survive
    expect(body.proposals[0].title).toMatch(/node:sqlite/);
    expect((await app.request("/faculty/bogus")).status).toBe(404);
  });
  it("GET /faculty/:key passes the CLI's envelopes through whole (payload + body)", async () => {
    fixtureHome(root);
    const item = {
      id: "k1", faculty: "knowledge", kind: "command", title: "Test command",
      status: "active", created_at: "2026-06-12T00:00:00Z",
      provenance: [{ session: "ses_abc", ref: "occurrences=12" }],
      payload: { type: "command", attributes: { command: "npm test" } },
      body: "Run the suite.",
    };
    const stub = jsonStub(root, JSON.stringify({ faculty: "knowledge", count: 1, items: [item], errors: [] }));
    const app = createZuzuuApi(() => root, { binary: stub });
    const body = await (await app.request("/faculty/knowledge")).json();
    expect(body.degraded).toBeUndefined();
    expect(body.items[0]).toEqual(item); // THE ENVELOPE, untouched
    expect(body.errors).toEqual([]);
  });
  it("GET /faculties uses the CLI envelope listing when available", async () => {
    fixtureHome(root);
    const stub = jsonStub(root, JSON.stringify({ faculty: "x", count: 2, items: [{ id: "a" }, { id: "b" }], errors: [] }));
    const app = createZuzuuApi(() => root, { binary: stub });
    const body = await (await app.request("/faculties")).json();
    for (const f of body.faculties) expect(f.count).toBe(2);
  });
  it("GET /faculty/:key/schema: CLI → builtin/home schema; absent CLI → seeded file; else null", async () => {
    const agent = fixtureHome(root);
    const schema = { type: "object", required: ["type"] };
    const viaCli = createZuzuuApi(() => root, { binary: jsonStub(root, JSON.stringify(schema)) });
    expect(await (await viaCli.request("/faculty/knowledge/schema")).json())
      .toEqual({ key: "knowledge", schema, source: "cli" });

    const absent = createZuzuuApi(() => root, { binary: "definitely-not-a-real-binary-zzz" });
    expect(await (await absent.request("/faculty/knowledge/schema")).json())
      .toEqual({ key: "knowledge", schema: null, source: "absent" });

    writeFileSync(path.join(agent, "knowledge", "schema.json"), JSON.stringify(schema));
    expect(await (await absent.request("/faculty/knowledge/schema")).json())
      .toEqual({ key: "knowledge", schema, source: "home" });
    expect((await absent.request("/faculty/bogus/schema")).status).toBe(404);
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
  ["/session/merge", {}, { ok: true, mergedAs: "abc12345", mergedTo: "main", commits: 2, branch: "zz/session-ab" }],
  ["/session/continue", {}, { ok: true, branch: "zz/session-ab" }],
  ["/session/discard", {}, { ok: true, branch: "zz/session-ab" }],
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
    const app = createZuzuuApi(() => root, { binary: argvStub(root) });
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

describe("createZuzuuApi session-git routes", () => {
  it("GET /session proxies zuzuu session status --json", async () => {
    fixtureHome(root);
    const payload = {
      enabled: true,
      mainBranch: "main",
      active: { branch: "zz/session-ab", checkpoints: 2, dirty: false, noNetChanges: false },
      onSessionBranch: true,
    };
    const app = createZuzuuApi(() => root, { binary: jsonStub(root, JSON.stringify(payload)) });
    const res = await app.request("/session");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(payload);
  });
  it("GET /session → {enabled:false, cliAbsent:true} when zuzuu is absent", async () => {
    fixtureHome(root);
    const app = createZuzuuApi(() => root, { binary: "definitely-not-a-real-binary-zzz" });
    expect(await (await app.request("/session")).json()).toEqual({ enabled: false, cliAbsent: true });
  });
  it("POST /session/discard always rides --yes (the SPA confirm is the gate)", async () => {
    fixtureHome(root);
    const app = createZuzuuApi(() => root, { binary: argvStub(root, "zuzuu-argv2.sh") });
    const res = await post(app, "/session/discard");
    expect(res.status).toBe(200);
    expect((await res.json()).argv).toBe("session|discard|--yes|--json|");
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
