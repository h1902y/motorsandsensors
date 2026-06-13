// /api/zuzuu/* — observe + act routes over a project's zuzuu `.zuzuu/` home.
// Reads: raw data (proposals, per-module generations, checkpoints, sessions,
// digest) comes from disk; computed views (status, inbox, eval, generation diff)
// shell out to `zuzuu <cmd> --json` (the spawn layer lives in zuzuu-cli.ts) and
// fall back to file-reads when the binary is absent.
// Writes: mutations (approve/reject, per-module mint/rollback, checkpoint
// mint/rollback) are CLI-ONLY — the daemon never reimplements module writes; no
// CLI → 503. Mirrors fs-api.ts.
//
// Generations are PER-MODULE atoms (W2.5 Phase 2): each module owns its lineage
// under .zuzuu/<module>/generations/; a checkpoint (.zuzuu/checkpoints/) composes
// the per-module actives for whole-brain coherence.

import fsp from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import type { Context } from "hono";
import { PathError, resolveSafe } from "./safe-path.js";
import { binAvailable, runZuzuu, runZuzuuMut } from "./zuzuu-cli.js";

const MODULES = ["knowledge", "memory", "actions", "instructions", "guardrails"] as const;

/** Ids/slugs/generation-ids that may ride into a zuzuu argv. Validated BEFORE any spawn. */
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
const MAX_REASON_LEN = 500;

interface ApiOpts { binary?: string; }

// ── Module Standard envelope listing ────────────────────────────────────
// The CLI is the parser of record (`zuzuu module items <f> --json` returns
// the full envelopes incl. payload/body). When it's absent we degrade to a
// count-only frontmatter PEEK: read the items dir, lift the tiny top-level
// scalar lines (title:/status:/kind:) best-effort — counts still render,
// detail degrades. Never a re-implementation of the envelope grammar.

/** Flat envelope item dirs per module; actions are dir-shaped (ACTION.md). */
const ITEM_DIRS: Record<string, string[]> = {
  knowledge: ["knowledge", "items"],
  memory: ["memory", "entries"],
  instructions: ["instructions", "items"],
  guardrails: ["guardrails", "items"],
};

const PEEK_KEYS = new Set(["id", "module", "kind", "title", "status", "created_at", "updated_at"]);

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
async function peekModuleItems(agent: string, key: string): Promise<Record<string, string>[]> {
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
    items.push({ kind: "?", ...fm, id: fm.id ?? id, module: key, title: fm.title ?? id });
  }
  return items;
}

interface EnvelopeListing {
  items: unknown[];
  errors: { file: string; error: string }[];
  degraded: boolean;
}

/** One module's envelope items: CLI first (full envelopes), peek fallback. */
async function moduleEnvelopeItems(root: string, agent: string, key: string, binary?: string): Promise<EnvelopeListing> {
  const viaCli = await runZuzuu(root, ["module", "items", key], { binary }) as
    { items?: unknown[]; errors?: { file: string; error: string }[] } | null;
  if (viaCli && Array.isArray(viaCli.items))
    return { items: viaCli.items, errors: Array.isArray(viaCli.errors) ? viaCli.errors : [], degraded: false };
  return { items: await peekModuleItems(agent, key), errors: [], degraded: true };
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

  app.get("/modules", async (c) => {
    const agent = await agentDir();
    const modules = await Promise.all(MODULES.map(async (key) => {
      const [{ items }, proposals] = await Promise.all([
        moduleEnvelopeItems(root, agent, key, opts.binary),
        proposalsOf(agent, key),
      ]);
      return { key, count: items.length, pending: proposals.length };
    }));
    return c.json({ modules });
  });

  // The batched module surface: ONE `zuzuu module overview --json` spawn
  // covers all modules (manifest ui descriptors + counts + top titles +
  // pending) — replaces the 5-spawn-per-cycle /modules pattern for the
  // panel root. CLI absent → peek fallback (counts survive, ui descriptors
  // degrade to the web kit's built-in metadata).
  app.get("/overview", async (c) => {
    const viaCli = await runZuzuu(root, ["module", "overview"], { binary: opts.binary }) as
      { modules?: unknown[] } | null;
    if (viaCli && Array.isArray(viaCli.modules)) return c.json(viaCli);
    const agent = await agentDir();
    const modules = await Promise.all(MODULES.map(async (id) => {
      const [items, proposals] = await Promise.all([peekModuleItems(agent, id), proposalsOf(agent, id)]);
      return {
        id,
        title: id.charAt(0).toUpperCase() + id.slice(1),
        counts: { items: items.length, pending: proposals.length, errors: 0 },
        top: items.slice(0, 3).map((it) => String(it.title ?? it.id)),
        declarative: false,
      };
    }));
    return c.json({ modules, degraded: true });
  });

  app.get("/module/:key", async (c) => {
    const key = c.req.param("key");
    if (!MODULES.includes(key as typeof MODULES[number])) return c.json({ error: "unknown module" }, 404);
    const agent = await agentDir();
    const { items, errors, degraded } = await moduleEnvelopeItems(root, agent, key, opts.binary);
    const proposals = (await proposalsOf(agent, key)).map((p) => ({ id: String(p.id ?? "?"), module: key, title: proposalTitle(p) }));
    return c.json({ key, items, proposals, errors, ...(degraded ? { degraded: true } : {}) });
  });

  app.get("/module/:key/schema", async (c) => {
    const key = c.req.param("key");
    if (!MODULES.includes(key as typeof MODULES[number])) return c.json({ error: "unknown module" }, 404);
    const viaCli = await runZuzuu(root, ["module", "schema", key], { binary: opts.binary });
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

  // Per-module generation lineage (W2.5 Phase 2). Generations are per-module
  // atoms now; this lists ONE module's lineage + active. CLI-first; falls back
  // to reading that module's generations/ dir directly.
  app.get("/module/:key/generations", async (c) => {
    const key = c.req.param("key");
    if (!MODULES.includes(key as typeof MODULES[number])) return c.json({ error: "unknown module" }, 404);
    const viaCli = await runZuzuu(root, ["module", key, "generations"], { binary: opts.binary });
    if (viaCli) return c.json(viaCli);
    const agent = await agentDir();
    const gens = (await readJsonDir(path.join(agent, key, "generations")))
      .filter((g) => typeof g.id === "string" && /^gen_\d+$/.test(g.id as string));
    let active: string | null = null;
    try { active = (JSON.parse(await fsp.readFile(path.join(agent, key, "generations", "active"), "utf8")).active) ?? null; } catch { active = null; }
    return c.json({
      module: key,
      active,
      generations: gens.map((g) => ({ id: String(g.id), mintedAt: (g.mintedAt as string) ?? null, mintedFrom: (g.mintedFrom as string[]) ?? [] })),
    });
  });

  // Whole-brain checkpoints (compose per-module actives). CLI-first; falls back
  // to reading the checkpoints/ dir.
  app.get("/checkpoints", async (c) => {
    const viaCli = await runZuzuu(root, ["checkpoint", "list"], { binary: opts.binary });
    if (viaCli) return c.json(viaCli);
    const agent = await agentDir();
    const cps = (await readJsonDir(path.join(agent, "checkpoints")))
      .filter((cp) => typeof cp.id === "string" && /^cp_\d+$/.test(cp.id as string));
    return c.json({
      checkpoints: cps.map((cp) => ({
        id: String(cp.id),
        createdAt: (cp.createdAt as string) ?? null,
        label: (cp.label as string) ?? null,
        pins: (cp.pins as Record<string, string>) ?? {},
      })),
    });
  });

  // Sessions list: CLI-first (`zuzuu sessions --json` — state-labelled:
  // active|completed|abandoned|crashed|captured); falls back to the raw
  // sessions.json index (no state labels) when the CLI is absent.
  app.get("/sessions", async (c) => {
    const viaCli = await runZuzuu(root, ["sessions"], { binary: opts.binary }) as
      { sessions?: unknown[] } | null;
    if (viaCli && Array.isArray(viaCli.sessions)) return c.json(viaCli);
    const agent = await agentDir();
    try {
      const idx = JSON.parse(await fsp.readFile(path.join(agent, "sessions.json"), "utf8"));
      return c.json({ sessions: idx.sessions ?? [] });
    } catch { return c.json({ sessions: [] }); }
  });

  // One session's observability document (`zuzuu session inspect <id> --json`:
  // trace summary + per-module mined signals + warnings). CLI-only — the
  // daemon never re-mines transcripts; absent → 503, failed → 502.
  app.get("/session-inspect/:id", async (c) => {
    const id = c.req.param("id");
    if (!SAFE_ID.test(id)) return c.json({ error: "bad id" }, 400);
    const r = await runZuzuuMut(root, ["session", "inspect", id], { binary: opts.binary });
    if (!r.ok) {
      return r.code === "absent"
        ? c.json({ error: "zuzuu CLI required" }, 503)
        : c.json({ error: "zuzuu command failed", stderr: r.stderr ?? "", data: r.data ?? null }, 502);
    }
    return c.json(r.data as Record<string, unknown>);
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
    for (const key of MODULES) pending[key] = (await proposalsOf(agent, key)).length;
    const generations: Record<string, string | null> = {};
    for (const key of MODULES) {
      try { generations[key] = (JSON.parse(await fsp.readFile(path.join(agent, key, "generations", "active"), "utf8")).active) ?? null; } catch { generations[key] = null; }
    }
    let checkpoints = 0;
    try { checkpoints = (await readJsonDir(path.join(agent, "checkpoints"))).filter((cp) => /^cp_\d+$/.test(String(cp.id))).length; } catch { checkpoints = 0; }
    return c.json({ home: existsSync(agent), generations, checkpoints, pending, drift: { dirty: false, items: [] } });
  });

  app.get("/inbox", async (c) => {
    const viaCli = await runZuzuu(root, ["inbox"], { binary: opts.binary });
    if (viaCli) return c.json(viaCli);
    const agent = await agentDir();
    const pending = [];
    for (const key of MODULES)
      for (const p of await proposalsOf(agent, key)) pending.push({ id: String(p.id ?? "?"), module: key, title: proposalTitle(p) });
    return c.json({ pending, total: pending.length });
  });

  // Per-module generation diff (show). CLI-only (the diff needs the parser).
  app.get("/module/:key/generation/:id", async (c) => {
    const key = c.req.param("key");
    if (!MODULES.includes(key as typeof MODULES[number])) return c.json({ error: "unknown module" }, 404);
    const id = c.req.param("id");
    if (!SAFE_ID.test(id)) return c.json({ error: "bad id" }, 400);
    const viaCli = await runZuzuu(root, ["module", key, "generation", "show", id], { binary: opts.binary });
    if (viaCli) return c.json(viaCli);
    return c.json({ error: "generation diff needs the zuzuu CLI" }, 503);
  });

  // ── Write side: mutations are CLI-only — every route below shells out to
  // `zuzuu … --json` via runZuzuuMut and never touches module files itself.

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
  const isModule = (f: unknown): f is typeof MODULES[number] =>
    typeof f === "string" && (MODULES as readonly string[]).includes(f);

  app.post("/proposals/:id/approve", async (c) => {
    const id = c.req.param("id");
    if (!SAFE_ID.test(id)) return c.json({ error: "bad id" }, 400);
    const { module } = await readBody(c);
    if (!isModule(module)) return c.json({ error: "bad module" }, 400);
    return mutate(c, ["proposals", "approve", id, "--module", module]);
  });

  app.post("/proposals/:id/reject", async (c) => {
    const id = c.req.param("id");
    if (!SAFE_ID.test(id)) return c.json({ error: "bad id" }, 400);
    const { module, reason } = await readBody(c);
    if (!isModule(module)) return c.json({ error: "bad module" }, 400);
    if (reason !== undefined && (typeof reason !== "string" || reason.length > MAX_REASON_LEN))
      return c.json({ error: "bad reason" }, 400);
    // reason rides as ONE argv element — spawn arrays make shell-meta inert
    return mutate(c, ["proposals", "reject", id, "--module", module, ...(reason ? ["--reason", reason] : [])]);
  });

  for (const verb of ["approve", "reject"] as const) {
    app.post(`/actions/:slug/${verb}`, async (c) => {
      const slug = c.req.param("slug");
      if (!SAFE_ID.test(slug)) return c.json({ error: "bad slug" }, 400);
      return mutate(c, ["act", verb, slug]);
    });
  }

  // Per-module mint (freeze ONE module's current items into its next gen). The
  // review ceremony does this automatically; this is the explicit/web surface.
  app.post("/module/:key/generation/mint", async (c) => {
    const key = c.req.param("key");
    if (!isModule(key)) return c.json({ error: "bad module" }, 400);
    const { from } = await readBody(c);
    if (from !== undefined &&
        (!Array.isArray(from) || from.length > 200 || !from.every((f) => typeof f === "string" && SAFE_ID.test(f))))
      return c.json({ error: "bad from ids" }, 400);
    const fromIds = (from as string[] | undefined) ?? [];
    return mutate(c, ["module", key, "generation", "mint", ...(fromIds.length ? ["--from", fromIds.join(",")] : [])]);
  });

  // Per-module rollback (restore ONE module's bytes + active to a past gen).
  app.post("/module/:key/generation/:id/rollback", async (c) => {
    const key = c.req.param("key");
    if (!isModule(key)) return c.json({ error: "bad module" }, 400);
    const id = c.req.param("id");
    if (!SAFE_ID.test(id)) return c.json({ error: "bad id" }, 400);
    return mutate(c, ["module", key, "generation", "rollback", id]);
  });

  // Checkpoint mint (pin current per-module actives) + rollback (restore all).
  app.post("/checkpoint/mint", async (c) => {
    const { label } = await readBody(c);
    if (label !== undefined && (typeof label !== "string" || label.length > MAX_REASON_LEN))
      return c.json({ error: "bad label" }, 400);
    return mutate(c, ["checkpoint", "mint", ...(label ? ["--label", label as string] : [])]);
  });

  app.post("/checkpoint/:id/rollback", async (c) => {
    const id = c.req.param("id");
    if (!SAFE_ID.test(id)) return c.json({ error: "bad id" }, 400);
    return mutate(c, ["checkpoint", "rollback", id]);
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
    for (const key of MODULES)
      for (const p of await proposalsOf(agent, key))
        ranked.push({ id: String(p.id ?? "?"), module: key, title: proposalTitle(p), score: null, confidence: null, rationale: null });
    return c.json({ ranked });
  });

  app.get("/hosts", async (c) => {
    const data = await runZuzuu(root, ["status"], { binary: opts.binary });
    const hosts = (data as { hosts?: { name: string }[] } | null)?.hosts ?? [];
    return c.json({ hosts, cliAbsent: data === null });
  });

  return app;
}
