// zuzuu/module/generation/read.mjs — the PER-MODULE generation READ side
// (W2.5 Phase 2, 2026-06-13). Generations went modular: each module owns its
// own lineage, and a *checkpoint* (checkpoint.mjs) composes the per-module
// actives for whole-brain coherence.
//
// A *module generation* is an immutable, content-addressed snapshot of ONE
// module's pinned items (the lockfile). Minting freezes that module's current
// items; rollback restores any past generation by *content* (we copy each
// pinned item's bytes into <module>/generations/snapshots/<id>/ at mint time,
// so a rollback works even for items that were never committed). Module
// independence is law: a read or write of one module never touches another.
//
// Layout under .zuzuu/<module>/:
//   generations/active             {active: "gen_NNN"}  — that module's pointer
//   generations/<id>.json          the lockfile {id, module, agent, mintedAt,
//                                   forkedFrom, mintedFrom:[ids], items:[{id,hash}]}
//   generations/snapshots/<id>/…   pinned item bytes (the rollback source)

import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

/** Hex sha256 of a string or Buffer. */
export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

const read = (p) => readFileSync(p, 'utf8');
export const readJson = (p) => JSON.parse(read(p));

// --- per-module paths -------------------------------------------------------

export const moduleGenerationsDir = (agentDir, module) => join(agentDir, module, 'generations');
export const moduleSnapshotsDir = (agentDir, module) => join(moduleGenerationsDir(agentDir, module), 'snapshots');
export const moduleActivePath = (agentDir, module) => join(moduleGenerationsDir(agentDir, module), 'active');
export const moduleLockfilePath = (agentDir, module, id) => join(moduleGenerationsDir(agentDir, module), `${id}.json`);
export const agentJsonPath = (agentDir) => join(agentDir, 'agent.json');

// --- module file enumeration (the pinned set) ------------------------------
// Each entry: { id, module, src (absolute live path), rel (path under the
// module snapshot dir), hash }. `rel` is what we mirror into snapshots/<id>/.
// Actions are dir-shaped: { id, module, files:[rel…], adir, hash }.

function sortDirents(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
}

export function knowledgeFiles(agentDir) {
  const dir = join(agentDir, 'knowledge', 'items');
  return sortDirents(dir)
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => {
      const src = join(dir, e.name);
      return { id: e.name.replace(/\.md$/, ''), module: 'knowledge', src, rel: e.name, hash: sha256(readFileSync(src)) };
    });
}

export function actionFiles(agentDir) {
  const dir = join(agentDir, 'actions');
  return sortDirents(dir)
    .filter((e) => e.isDirectory() && e.name !== 'inbox' && e.name !== 'proposals' && e.name !== '_rolledback' && e.name !== 'generations')
    .map((e) => {
      const adir = join(dir, e.name);
      // Hash the dir's defining files concatenated: the ACTION.md envelope
      // (W24) + sibling scripts (*.mjs — run.mjs and any payload.exec module).
      const parts = sortDirents(adir)
        .filter((f) => f.isFile() && (f.name === 'ACTION.md' || f.name === 'action.json' || f.name.endsWith('.mjs')))
        .map((f) => join(adir, f.name));
      const concat = Buffer.concat(parts.map((p) => readFileSync(p)));
      return {
        id: e.name, module: 'actions', files: parts.map((p) => p.slice(adir.length + 1)),
        adir, hash: parts.length ? sha256(concat) : null,
      };
    });
}

/** Flat envelope-item modules share one enumerator. */
function mdItemFiles(agentDir, module, ...segments) {
  const dir = join(agentDir, ...segments);
  return sortDirents(dir)
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => {
      const src = join(dir, e.name);
      return { id: e.name.replace(/\.md$/, ''), module, src, rel: e.name, hash: sha256(readFileSync(src)) };
    });
}

export const guardrailFiles = (agentDir) => mdItemFiles(agentDir, 'guardrails', 'guardrails', 'items');
export const instructionFiles = (agentDir) => mdItemFiles(agentDir, 'instructions', 'instructions', 'items');

export function memoryFiles(agentDir) {
  return mdItemFiles(agentDir, 'memory', 'memory', 'entries');
}

/** One module → its live item enumerator (the pinned-set source). */
const ENUMERATORS = {
  knowledge: knowledgeFiles,
  memory: memoryFiles,
  actions: actionFiles,
  guardrails: guardrailFiles,
  instructions: instructionFiles,
};

/** The live item files for ONE module (absolute, with hashes). [] for unknown. */
export function moduleItemFiles(agentDir, module) {
  const fn = ENUMERATORS[module];
  return fn ? fn(agentDir) : [];
}

export function registryHash(agentDir) {
  const dir = join(agentDir, 'knowledge', 'registry');
  const files = sortDirents(dir).filter((e) => e.isFile() && e.name.endsWith('.json'));
  if (!files.length) return null;
  return sha256(Buffer.concat(files.map((e) => readFileSync(join(dir, e.name)))));
}

/** The `items` manifest array for ONE module ({id,hash}[]); tolerant of absence. */
export function snapshotModuleItems(agentDir, module) {
  return moduleItemFiles(agentDir, module).map(({ id, hash }) => ({ id, hash }));
}

// --- agent identity ---------------------------------------------------------

/** Stable agent id derived from the repo root: agt_<first12 of sha256(root)>. */
export function agentId(agentDir) {
  // agentDir is the .zuzuu/ dir; the repo root is its parent.
  const root = dirname(agentDir);
  return 'agt_' + sha256(root).slice(0, 12);
}

// --- per-module generation read/list ---------------------------------------

/** The active generation id for ONE module, or null. Fail-soft. */
export function activeModuleGeneration(agentDir, module) {
  const p = moduleActivePath(agentDir, module);
  if (!existsSync(p)) return null;
  try { return readJson(p).active ?? null; } catch { return null; }
}

/** All generation ids for ONE module, ascending. */
export function listModuleGenerations(agentDir, module) {
  const dir = moduleGenerationsDir(agentDir, module);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^gen_\d+\.json$/.test(f))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

/** Read ONE module lockfile, or null. Fail-soft (corrupt → null). */
export function readModuleGeneration(agentDir, module, id) {
  const p = moduleLockfilePath(agentDir, module, id);
  if (!existsSync(p)) return null;
  try { return readJson(p); } catch { return null; }
}

/** Diff two item-manifest arrays → {added, changed, removed} (sorted id lists). */
function diffItems(parentItems = [], childItems = []) {
  const p = new Map(parentItems.map((i) => [i.id, i.hash]));
  const c = new Map(childItems.map((i) => [i.id, i.hash]));
  const added = [], changed = [], removed = [];
  for (const [id, hash] of c) {
    if (!p.has(id)) added.push(id);
    else if (p.get(id) !== hash) changed.push(id);
  }
  for (const id of p.keys()) if (!c.has(id)) removed.push(id);
  return { added: added.sort(), changed: changed.sort(), removed: removed.sort() };
}

/**
 * Per-module diff of generation `a` against `b` (both ids of the SAME module).
 * When `b` is omitted, diffs `a` against its forkedFrom parent. Returns null for
 * an unknown `a`. The shape mirrors the old global diff for one module:
 *   { id, module, forkedFrom, mintedFrom, mintedAt, added, changed, removed }
 */
export function diffModuleGenerations(agentDir, module, a, b = undefined) {
  const child = readModuleGeneration(agentDir, module, a);
  if (!child) return null;
  const parentId = b !== undefined ? b : child.forkedFrom;
  const parent = parentId ? readModuleGeneration(agentDir, module, parentId) : null;
  const d = diffItems(parent?.items, child.items);
  return {
    id: a,
    module,
    forkedFrom: child.forkedFrom ?? null,
    against: parentId ?? null,
    mintedFrom: Array.isArray(child.mintedFrom) ? child.mintedFrom : [],
    mintedAt: child.mintedAt ?? null,
    ...d,
  };
}

/** List + active for ONE module — the porcelain + daemon source. */
export function moduleGenerations(agentDir, module) {
  const active = activeModuleGeneration(agentDir, module);
  const generations = listModuleGenerations(agentDir, module).map((id) => {
    const lf = readModuleGeneration(agentDir, module, id) ?? {};
    return { id, mintedAt: lf.mintedAt ?? null, mintedFrom: Array.isArray(lf.mintedFrom) ? lf.mintedFrom : [] };
  });
  return { module, active, generations };
}
