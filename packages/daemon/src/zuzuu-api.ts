// /api/zuzuu/* — read-only observe routes over a project's zuzuu `.zuzuu/` home.
// Raw data (proposals, generations, sessions, digest) is read from disk; computed
// views (status, inbox, generation diff) shell out to `zuzuu <cmd> --json` and
// fall back to file-reads when the binary is absent. Mirrors fs-api.ts.

import fsp from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { Hono } from "hono";
import { PathError, resolveSafe } from "./safe-path.js";

const FACULTIES = ["knowledge", "memory", "actions", "instructions", "guardrails"] as const;

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
    child.on("error", () => { clearTimeout(timer); finish({ ok: false, code: "absent" }); });
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

  return app;
}
