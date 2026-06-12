// /api/zuzuu/* — observe + act routes over a project's zuzuu `.zuzuu/` home.
// Reads: raw data (proposals, generations, sessions, digest) comes from disk;
// computed views (status, inbox, eval, generation diff) shell out to
// `zuzuu <cmd> --json` and fall back to file-reads when the binary is absent.
// Writes: mutations (approve/reject, mint, rollback) are CLI-ONLY — the daemon
// never reimplements faculty writes; no CLI → 503. Mirrors fs-api.ts.

import fsp from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { Hono } from "hono";
import type { Context } from "hono";
import { PathError, resolveSafe } from "./safe-path.js";

const FACULTIES = ["knowledge", "memory", "actions", "instructions", "guardrails"] as const;

/** Ids/slugs/generation-ids that may ride into a zuzuu argv. Validated BEFORE any spawn. */
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
const MAX_REASON_LEN = 500;

interface RunOpts { binary?: string; timeoutMs?: number; }
interface ApiOpts { binary?: string; }

/** Spawn `zuzuu <args> --json` in `root`. Returns parsed JSON, or null on any
 *  failure (binary absent, non-zero exit, unparseable). Read-only + time-boxed. */
export function runZuzuu(root: string, args: string[], opts: RunOpts = {}): Promise<unknown | null> {
  const binary = opts.binary ?? "zuzuu";
  const timeoutMs = opts.timeoutMs ?? 5000;
  return new Promise((resolve) => {
    let out = "";
    let done = false;
    const finish = (v: unknown | null) => { if (!done) { done = true; resolve(v); } };
    let child;
    try {
      child = spawn(binary, [...args, "--json"], { cwd: root, stdio: ["ignore", "pipe", "ignore"] });
    } catch { finish(null); return; }
    const timer = setTimeout(() => { try { child!.kill(); } catch { /* noop */ } finish(null); }, timeoutMs);
    child.stdout?.on("data", (b) => { out += b.toString(); });
    child.on("error", () => { clearTimeout(timer); finish(null); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return finish(null);
      try { finish(JSON.parse(out)); } catch { finish(null); }
    });
  });
}

export type ZuzuuMutResult =
  | { ok: true; data: unknown }
  | { ok: false; code: "absent" | "failed"; stderr?: string };

const STDERR_TAIL = 2048;

/** Spawn `zuzuu <args> --json` for a MUTATION. Unlike runZuzuu, failures are
 *  distinguished: binary absent vs command failed (with a stderr tail), so
 *  routes can answer 503 vs 502. Stdout must parse as JSON on success. */
export function runZuzuuMut(root: string, args: string[], opts: RunOpts = {}): Promise<ZuzuuMutResult> {
  const binary = opts.binary ?? "zuzuu";
  const timeoutMs = opts.timeoutMs ?? 10_000;
  return new Promise((resolve) => {
    let out = "";
    let err = "";
    let done = false;
    const finish = (v: ZuzuuMutResult) => { if (!done) { done = true; resolve(v); } };
    let child;
    try {
      child = spawn(binary, [...args, "--json"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    } catch { finish({ ok: false, code: "absent" }); return; }
    const timer = setTimeout(() => {
      try { child!.kill(); } catch { /* noop */ }
      finish({ ok: false, code: "failed", stderr: "zuzuu timed out" });
    }, timeoutMs);
    child.stdout?.on("data", (b) => { out += b.toString(); });
    child.stderr?.on("data", (b) => {
      err += b.toString();
      if (err.length > STDERR_TAIL) err = err.slice(-STDERR_TAIL);
    });
    child.on("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (e.code === "ENOENT") finish({ ok: false, code: "absent" });
      else finish({ ok: false, code: "failed", stderr: e.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return finish({ ok: false, code: "failed", stderr: err.slice(-STDERR_TAIL) });
      try { finish({ ok: true, data: JSON.parse(out) }); }
      catch { finish({ ok: false, code: "failed", stderr: "unparseable JSON from zuzuu" }); }
    });
  });
}

/** Best-effort: is the zuzuu binary runnable? */
function binAvailable(binary: string): boolean {
  try {
    const r = spawnSync(binary, ["version"], { stdio: "ignore", timeout: 3000 });
    return !r.error && r.status === 0;
  } catch { return false; }
}

/** Read every *.json in a dir into objects; missing dir → [], corrupt file → skipped. */
async function readJsonDir(dir: string): Promise<Record<string, unknown>[]> {
  let names: string[] = [];
  try { names = (await fsp.readdir(dir)).filter((n) => n.endsWith(".json")); } catch { return []; }
  const out: Record<string, unknown>[] = [];
  for (const n of names) {
    try { out.push(JSON.parse(await fsp.readFile(path.join(dir, n), "utf8"))); } catch { /* skip corrupt */ }
  }
  return out;
}

const firstLine = (s: unknown, n = 80) => (String(s ?? "").split("\n")[0] ?? "").slice(0, n);

/** A proposal's best-effort one-line title (file-read fallback; the CLI inbox uses adapters). */
function proposalTitle(p: Record<string, unknown>): string {
  const cand = p.candidate as { body?: string } | undefined;
  const payload = p.payload as { body?: string } | undefined;
  return firstLine(cand?.body ?? payload?.body ?? p.id);
}

/** The conventional item dir for a faculty, or null (heterogeneous faculties → counted as 0 for the MVP). */
function itemsDirOf(agent: string, key: string): string | null {
  if (key === "knowledge") return path.join(agent, "knowledge", "items");
  if (key === "memory") return path.join(agent, "memory", "entries");
  return null;
}

export function createZuzuuApi(getRoot: () => string, opts: ApiOpts = {}): Hono {
  const app = new Hono();
  let root = getRoot();
  app.use("*", async (_c, next) => { root = getRoot(); await next(); });
  app.onError((err, c) => {
    if (err instanceof PathError) return c.json({ error: err.message }, 403);
    return c.json({ error: "internal error" }, 500);
  });

  const agentDir = () => resolveSafe(root, ".zuzuu");
  const proposalsOf = async (agent: string, key: string) => readJsonDir(path.join(agent, key, "proposals"));

  app.get("/health", async (c) => {
    const agent = await agentDir();
    return c.json({ home: existsSync(agent), zuzuuBin: binAvailable(opts.binary ?? "zuzuu") });
  });

  app.get("/faculties", async (c) => {
    const agent = await agentDir();
    const faculties = [];
    for (const key of FACULTIES) {
      const itemsDir = itemsDirOf(agent, key);
      const count = itemsDir ? (await readJsonDir(itemsDir)).length : 0;
      const pending = (await proposalsOf(agent, key)).length;
      faculties.push({ key, count, pending });
    }
    return c.json({ faculties });
  });

  app.get("/faculty/:key", async (c) => {
    const key = c.req.param("key");
    if (!FACULTIES.includes(key as typeof FACULTIES[number])) return c.json({ error: "unknown faculty" }, 404);
    const agent = await agentDir();
    const itemsDir = itemsDirOf(agent, key);
    const items = itemsDir
      ? (await readJsonDir(itemsDir)).map((it) => ({ id: String(it.id ?? "?"), title: firstLine(it.body ?? it.id) }))
      : [];
    const proposals = (await proposalsOf(agent, key)).map((p) => ({ id: String(p.id ?? "?"), faculty: key, title: proposalTitle(p) }));
    return c.json({ key, items, proposals });
  });

  app.get("/generations", async (c) => {
    const agent = await agentDir();
    const gens = (await readJsonDir(path.join(agent, "generations")))
      .filter((g) => typeof g.id === "string" && /^gen_\d+$/.test(g.id as string));
    let active: string | null = null;
    try { active = (JSON.parse(await fsp.readFile(path.join(agent, "generations", "active"), "utf8")).active) ?? null; } catch { active = null; }
    return c.json({
      active,
      generations: gens.map((g) => ({ id: String(g.id), mintedAt: (g.mintedAt as string) ?? null, mintedFrom: (g.mintedFrom as string[]) ?? [] })),
    });
  });

  app.get("/sessions", async (c) => {
    const agent = await agentDir();
    try {
      const idx = JSON.parse(await fsp.readFile(path.join(agent, "sessions.json"), "utf8"));
      return c.json({ sessions: idx.sessions ?? [] });
    } catch { return c.json({ sessions: [] }); }
  });

  app.get("/digest", async (c) => {
    const agent = await agentDir();
    try { return c.json({ text: await fsp.readFile(path.join(agent, ".live", "digest.md"), "utf8") }); }
    catch { return c.json({ text: "" }); }
  });

  app.get("/status", async (c) => {
    const viaCli = await runZuzuu(root, ["status"], { binary: opts.binary });
    if (viaCli) return c.json(viaCli);
    const agent = await agentDir();
    const pending: Record<string, number> = {};
    for (const key of FACULTIES) pending[key] = (await proposalsOf(agent, key)).length;
    let active: string | null = null;
    try { active = (JSON.parse(await fsp.readFile(path.join(agent, "generations", "active"), "utf8")).active) ?? null; } catch { active = null; }
    return c.json({ home: existsSync(agent), activeGeneration: active, pending, drift: { dirty: false, items: [] } });
  });

  app.get("/inbox", async (c) => {
    const viaCli = await runZuzuu(root, ["inbox"], { binary: opts.binary });
    if (viaCli) return c.json(viaCli);
    const agent = await agentDir();
    const pending = [];
    for (const key of FACULTIES)
      for (const p of await proposalsOf(agent, key)) pending.push({ id: String(p.id ?? "?"), faculty: key, title: proposalTitle(p) });
    return c.json({ pending, total: pending.length });
  });

  app.get("/generation/:id", async (c) => {
    const id = c.req.param("id");
    if (!/^[A-Za-z0-9_-]+$/.test(id)) return c.json({ error: "bad id" }, 400);
    const viaCli = await runZuzuu(root, ["generation", "show", id], { binary: opts.binary });
    if (viaCli) return c.json(viaCli);
    return c.json({ error: "generation diff needs the zuzuu CLI" }, 503);
  });

  // ── Write side: mutations are CLI-only — every route below shells out to
  // `zuzuu … --json` via runZuzuuMut and never touches faculty files itself.

  const readBody = async (c: Context): Promise<Record<string, unknown>> => {
    try { const b = await c.req.json(); return b && typeof b === "object" ? b as Record<string, unknown> : {}; }
    catch { return {}; }
  };
  /** Run a mutation and map the result: absent → 503, failed → 502, success → 200 + CLI JSON. */
  const mutate = async (c: Context, args: string[]) => {
    const r = await runZuzuuMut(root, args, { binary: opts.binary });
    if (!r.ok) {
      return r.code === "absent"
        ? c.json({ error: "zuzuu CLI required" }, 503)
        : c.json({ error: "zuzuu command failed", stderr: r.stderr ?? "" }, 502);
    }
    return c.json(r.data as Record<string, unknown>);
  };
  const isFaculty = (f: unknown): f is typeof FACULTIES[number] =>
    typeof f === "string" && (FACULTIES as readonly string[]).includes(f);

  app.post("/proposals/:id/approve", async (c) => {
    const id = c.req.param("id");
    if (!SAFE_ID.test(id)) return c.json({ error: "bad id" }, 400);
    const { faculty } = await readBody(c);
    if (!isFaculty(faculty)) return c.json({ error: "bad faculty" }, 400);
    return mutate(c, ["proposals", "approve", id, "--faculty", faculty]);
  });

  app.post("/proposals/:id/reject", async (c) => {
    const id = c.req.param("id");
    if (!SAFE_ID.test(id)) return c.json({ error: "bad id" }, 400);
    const { faculty, reason } = await readBody(c);
    if (!isFaculty(faculty)) return c.json({ error: "bad faculty" }, 400);
    if (reason !== undefined && (typeof reason !== "string" || reason.length > MAX_REASON_LEN))
      return c.json({ error: "bad reason" }, 400);
    // reason rides as ONE argv element — spawn arrays make shell-meta inert
    return mutate(c, ["proposals", "reject", id, "--faculty", faculty, ...(reason ? ["--reason", reason] : [])]);
  });

  for (const verb of ["approve", "reject"] as const) {
    app.post(`/actions/:slug/${verb}`, async (c) => {
      const slug = c.req.param("slug");
      if (!SAFE_ID.test(slug)) return c.json({ error: "bad slug" }, 400);
      return mutate(c, ["act", verb, slug]);
    });
  }

  app.post("/generation/mint", async (c) => {
    const { from } = await readBody(c);
    if (from !== undefined &&
        (!Array.isArray(from) || from.length > 200 || !from.every((f) => typeof f === "string" && SAFE_ID.test(f))))
      return c.json({ error: "bad from ids" }, 400);
    const fromIds = (from as string[] | undefined) ?? [];
    return mutate(c, ["generation", "mint", ...(fromIds.length ? ["--from", fromIds.join(",")] : [])]);
  });

  app.post("/generation/:id/rollback", async (c) => {
    const id = c.req.param("id");
    if (!SAFE_ID.test(id)) return c.json({ error: "bad id" }, 400);
    return mutate(c, ["generation", "rollback", id]);
  });

  app.get("/eval", async (c) => {
    const viaCli = await runZuzuu(root, ["eval"], { binary: opts.binary });
    if (viaCli) return c.json(viaCli);
    // Fallback: pending proposals, unranked (no CLI → no scoring).
    const agent = await agentDir();
    const ranked = [];
    for (const key of FACULTIES)
      for (const p of await proposalsOf(agent, key))
        ranked.push({ id: String(p.id ?? "?"), faculty: key, title: proposalTitle(p), score: null, confidence: null, rationale: null });
    return c.json({ ranked });
  });

  app.get("/hosts", async (c) => {
    const data = await runZuzuu(root, ["status"], { binary: opts.binary });
    const hosts = (data as { hosts?: { name: string }[] } | null)?.hosts ?? [];
    return c.json({ hosts, cliAbsent: data === null });
  });

  return app;
}
