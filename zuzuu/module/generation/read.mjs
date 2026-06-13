// zuzuu/module/generation/read.mjs — the generation READ side (WS3-T1, split
// per the 2026-06-13 overhaul): paths, the pinned-set enumerators, snapshot
// hashing, list/show/diff. Minting + rollback live in write.mjs.
//
// A *generation* is an immutable, content-addressed snapshot of the agent's
// pinned modules (the lockfile). Minting freezes the current module state;
// rollback restores any past generation by *content* (we copy each pinned item's
// bytes into generations/snapshots/<id>/ at mint time, so a rollback works even
// for items that were never committed). Identity: Agent → Generation → Run —
// rollback = flip the active pointer + restore content; never `git revert`.
//
// Layout under .zuzuu/:
//   generations/active             {active: "gen_NNN"}  — the live pointer
//   generations/<id>.json          the lockfile (content-addressed manifest)
//   generations/snapshots/<id>/<module>/...  pinned item bytes (rollback source)

import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

/** Hex sha256 of a string or Buffer. */
export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

const read = (p) => readFileSync(p, 'utf8');
export const readJson = (p) => JSON.parse(read(p));

// --- paths ------------------------------------------------------------------

export const generationsDir = (agentDir) => join(agentDir, 'generations');
export const snapshotsDir = (agentDir) => join(generationsDir(agentDir), 'snapshots');
export const activePath = (agentDir) => join(generationsDir(agentDir), 'active');
export const lockfilePath = (agentDir, id) => join(generationsDir(agentDir), `${id}.json`);
export const agentJsonPath = (agentDir) => join(agentDir, 'agent.json');

// --- module file enumeration (the pinned set) ------------------------------
// Each entry: { id, module, src (absolute live path), rel (path under the
// module snapshot dir), hash }. `rel` is what we mirror into snapshots/<id>/.

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
    .filter((e) => e.isDirectory() && e.name !== 'inbox' && e.name !== 'proposals' && e.name !== '_rolledback')
    .map((e) => {
      const adir = join(dir, e.name);
      // Hash the dir's defining files concatenated: the ACTION.md envelope
      // (W24) + sibling scripts (*.mjs — run.mjs and any payload.exec module).
      const parts = sortDirents(adir)
        .filter((f) => f.isFile() && (f.name === 'ACTION.md' || f.name.endsWith('.mjs')))
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
  const dir = join(agentDir, 'memory', 'entries');
  return sortDirents(dir)
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => {
      const src = join(dir, e.name);
      return { id: e.name.replace(/\.md$/, ''), module: 'memory', src, rel: e.name, hash: sha256(readFileSync(src)) };
    });
}

export function registryHash(agentDir) {
  const dir = join(agentDir, 'knowledge', 'registry');
  const files = sortDirents(dir).filter((e) => e.isFile() && e.name.endsWith('.json'));
  if (!files.length) return null;
  return sha256(Buffer.concat(files.map((e) => readFileSync(join(dir, e.name)))));
}

/**
 * Snapshot the current module state → the `modules` manifest object.
 * Tolerates missing files (empty arrays / null hashes).
 */
export function snapshotModules(agentDir) {
  return {
    knowledge: {
      items: knowledgeFiles(agentDir).map(({ id, hash }) => ({ id, hash })),
      registryHash: registryHash(agentDir),
    },
    actions: {
      items: actionFiles(agentDir).map(({ id, hash }) => ({ id, hash })),
    },
    guardrails: {
      items: guardrailFiles(agentDir).map(({ id, hash }) => ({ id, hash })),
    },
    instructions: {
      items: instructionFiles(agentDir).map(({ id, hash }) => ({ id, hash })),
    },
    memory: {
      items: memoryFiles(agentDir).map(({ id, hash }) => ({ id, hash })),
    },
  };
}

// --- agent identity ---------------------------------------------------------

/** Stable agent id derived from the repo root: agt_<first12 of sha256(root)>. */
export function agentId(agentDir) {
  // agentDir is the .zuzuu/ dir; the repo root is its parent.
  const root = dirname(agentDir);
  return 'agt_' + sha256(root).slice(0, 12);
}

// --- generation read/list ---------------------------------------------------

/** The active generation id, or null. */
export function activeGeneration(agentDir) {
  const p = activePath(agentDir);
  if (!existsSync(p)) return null;
  try { return readJson(p).active ?? null; } catch { return null; }
}

/** All generation ids in ascending order. */
export function listGenerations(agentDir) {
  const dir = generationsDir(agentDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^gen_\d+\.json$/.test(f))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

/** Read one lockfile, or null. */
export function readGeneration(agentDir, id) {
  const p = lockfilePath(agentDir, id);
  return existsSync(p) ? readJson(p) : null;
}

/** Diff two item-manifest arrays → {added, changed, removed} (id lists). */
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
 * Per-module diff of generation `id` against its forkedFrom parent (pure).
 * ALL five modules are item lists under the Module Standard (W24) —
 * added/changed/removed id lists per module; knowledge additionally reports
 * registryChanged. When there is no parent (forkedFrom null), everything
 * present counts as added. Returns null for an unknown id.
 */
export function diffGenerations(agentDir, id) {
  const child = readGeneration(agentDir, id);
  if (!child) return null;
  const parent = child.forkedFrom ? readGeneration(agentDir, child.forkedFrom) : null;
  const cf = child.modules || {};
  const pf = parent?.modules || {};
  const modules = {};
  for (const f of ['knowledge', 'actions', 'memory', 'guardrails', 'instructions']) {
    modules[f] = diffItems(pf[f]?.items, cf[f]?.items);
    // knowledge also has a registry hash
    if (f === 'knowledge') {
      modules[f].registryChanged = (cf.knowledge?.registryHash ?? null) !== (pf.knowledge?.registryHash ?? null);
    }
  }
  return {
    id,
    forkedFrom: child.forkedFrom ?? null,
    mintedFrom: Array.isArray(child.mintedFrom) ? child.mintedFrom : [],
    mintedAt: child.mintedAt ?? null,
    modules,
  };
}
