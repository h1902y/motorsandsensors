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
  | { ok: false; code: "absent" | "failed"; stderr?: string; data?: unknown };

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
      if (code !== 0) {
        // zuzuu prints structured JSON even on refusals (exit 1, e.g.
        // empty-squash-with-checkpoints) — keep it so the UI can act on reason.
        try {
          const parsed: unknown = JSON.parse(out);
          return finish({ ok: false, code: "failed", stderr: err.slice(-STDERR_TAIL), data: parsed });
        } catch {
          return finish({ ok: false, code: "failed", stderr: err.slice(-STDERR_TAIL) });
        }
      }
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

// ── Faculty Standard envelope listing ────────────────────────────────────
// The CLI is the parser of record (`zuzuu faculty items <f> --json` returns
// the full envelopes incl. payload/body). When it's absent we degrade to a
// count-only frontmatter PEEK: read the items dir, lift the tiny top-level
// scalar lines (title:/status:/kind:) best-effort — counts still render,
// detail degrades. Never a re-implementation of the envelope grammar.

/** Flat envelope item dirs per faculty; actions are dir-shaped (ACTION.md). */
const ITEM_DIRS: Record<string, string[]> = {
  knowledge: ["knowledge", "items"],
  memory: ["memory", "entries"],
  instructions: ["instructions", "items"],
  guardrails: ["guardrails", "items"],
};

const PEEK_KEYS = new Set(["id", "faculty", "kind", "title", "status", "created_at", "updated_at"]);

function unquoteScalar(s: string): string {
  const t = s.trim();
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) {
    try { return JSON.parse(t) as string; } catch { return t.slice(1, -1); }
  }
  if (t.startsWith("'") && t.endsWith("'") && t.length >= 2) return t.slice(1, -1);
  return t;
}

/** Best-effort peek at an envelope's top-level frontmatter scalars. */
function peekFrontmatter(text: string): Record<string, string> {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const raw of (m[1] ?? "").split("\n")) {
    if (/^\s/.test(raw)) continue; // indented = provenance/payload children
    const kv = raw.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (kv && PEEK_KEYS.has(kv[1]!)) out[kv[1]!] = unquoteScalar(kv[2] ?? "");
  }
  return out;
}

/** CLI-less fallback: degraded envelope items (no payload/body) from disk. */
async function peekFacultyItems(agent: string, key: string): Promise<Record<string, string>[]> {
  const files: { id: string; file: string }[] = [];
  if (key === "actions") {
    const base = path.join(agent, "actions");
    let names: string[] = [];
    try { names = (await fsp.readdir(base)).sort(); } catch { return []; }
    for (const n of names) {
      if (n === "inbox" || n === "proposals" || n === "_rolledback") continue;
      files.push({ id: n, file: path.join(base, n, "ACTION.md") });
    }
  } else {
    const rel = ITEM_DIRS[key];
    if (!rel) return [];
    const dir = path.join(agent, ...rel);
    let names: string[] = [];
    try { names = (await fsp.readdir(dir)).sort(); } catch { return []; }
    for (const n of names) {
      if (!n.endsWith(".md") || n === "README.md") continue;
      files.push({ id: n.replace(/\.md$/, ""), file: path.join(dir, n) });
    }
  }
  const items: Record<string, string>[] = [];
  for (const { id, file } of files) {
    let fm: Record<string, string>;
    try { fm = peekFrontmatter(await fsp.readFile(file, "utf8")); } catch { continue; }
    items.push({ kind: "?", ...fm, id: fm.id ?? id, faculty: key, title: fm.title ?? id });
  }
  return items;
}

interface EnvelopeListing {
  items: unknown[];
  errors: { file: string; error: string }[];
  degraded: boolean;
}

/** One faculty's envelope items: CLI first (full envelopes), peek fallback. */
async function facultyEnvelopeItems(root: string, agent: string, key: string, binary?: string): Promise<EnvelopeListing> {
  const viaCli = await runZuzuu(root, ["faculty", "items", key], { binary }) as
    { items?: unknown[]; errors?: { file: string; error: string }[] } | null;
  if (viaCli && Array.isArray(viaCli.items))
    return { items: viaCli.items, errors: Array.isArray(viaCli.errors) ? viaCli.errors : [], degraded: false };
  return { items: await peekFacultyItems(agent, key), errors: [], degraded: true };
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
    const faculties = await Promise.all(FACULTIES.map(async (key) => {
      const [{ items }, proposals] = await Promise.all([
        facultyEnvelopeItems(root, agent, key, opts.binary),
        proposalsOf(agent, key),
      ]);
      return { key, count: items.length, pending: proposals.length };
    }));
    return c.json({ faculties });
  });

  app.get("/faculty/:key", async (c) => {
    const key = c.req.param("key");
    if (!FACULTIES.includes(key as typeof FACULTIES[number])) return c.json({ error: "unknown faculty" }, 404);
    const agent = await agentDir();
    const { items, errors, degraded } = await facultyEnvelopeItems(root, agent, key, opts.binary);
    const proposals = (await proposalsOf(agent, key)).map((p) => ({ id: String(p.id ?? "?"), faculty: key, title: proposalTitle(p) }));
    return c.json({ key, items, proposals, errors, ...(degraded ? { degraded: true } : {}) });
  });

  app.get("/faculty/:key/schema", async (c) => {
    const key = c.req.param("key");
    if (!FACULTIES.includes(key as typeof FACULTIES[number])) return c.json({ error: "unknown faculty" }, 404);
    const viaCli = await runZuzuu(root, ["faculty", "schema", key], { binary: opts.binary });
    if (viaCli) return c.json({ key, schema: viaCli, source: "cli" });
    // CLI absent → the seeded payload schema in the home (zuzuu init writes it)
    const agent = await agentDir();
    try {
      const schema: unknown = JSON.parse(await fsp.readFile(path.join(agent, key, "schema.json"), "utf8"));
      return c.json({ key, schema, source: "home" });
    } catch {
      return c.json({ key, schema: null, source: "absent" });
    }
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
        : c.json({ error: "zuzuu command failed", stderr: r.stderr ?? "", data: r.data ?? null }, 502);
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

  // ── Session-git (the invisible zz/session-* branch) — CLI-only, no
  // file-read fallback: branch state lives in git, only the CLI computes it.

  app.get("/session", async (c) => {
    const viaCli = await runZuzuu(root, ["session", "status"], { binary: opts.binary });
    if (viaCli) return c.json(viaCli);
    return c.json({ enabled: false, cliAbsent: true });
  });

  app.post("/session/merge", (c) => mutate(c, ["session", "merge"]));
  app.post("/session/continue", (c) => mutate(c, ["session", "continue"]));
  // --yes rides server-side: the SPA's confirm dialog is the human gate
  app.post("/session/discard", (c) => mutate(c, ["session", "discard", "--yes"]));

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
