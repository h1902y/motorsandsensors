// mns/faculty/generation.mjs — the generation core (WS3-T1).
//
// A *generation* is an immutable, content-addressed snapshot of the agent's
// pinned faculties (the lockfile). Minting freezes the current faculty state;
// rollback restores any past generation by *content* (we copy each pinned item's
// bytes into generations/snapshots/<id>/ at mint time, so a rollback works even
// for items that were never committed). Identity: Agent → Generation → Run —
// rollback = flip the active pointer + restore content; never `git revert`.
//
// Layout under agent/:
//   generations/active             {active: "gen_NNN"}  — the live pointer
//   generations/<id>.json          the lockfile (content-addressed manifest)
//   generations/snapshots/<id>/<faculty>/...  pinned item bytes (rollback source)

import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import {
  existsSync, readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, renameSync,
} from 'node:fs';
import { reindex } from '../knowledge/index.mjs';

/** Hex sha256 of a string or Buffer. */
export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

const read = (p) => readFileSync(p, 'utf8');
const readJson = (p) => JSON.parse(read(p));
const writeJson = (p, obj) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
};

// --- paths ------------------------------------------------------------------

const generationsDir = (mnsDir) => join(mnsDir, 'generations');
const snapshotsDir = (mnsDir) => join(generationsDir(mnsDir), 'snapshots');
const activePath = (mnsDir) => join(generationsDir(mnsDir), 'active');
const lockfilePath = (mnsDir, id) => join(generationsDir(mnsDir), `${id}.json`);
const mnsJsonPath = (mnsDir) => join(mnsDir, 'mns.json');

// --- faculty file enumeration (the pinned set) ------------------------------
// Each entry: { id, faculty, src (absolute live path), rel (path under the
// faculty snapshot dir), hash }. `rel` is what we mirror into snapshots/<id>/.

function sortDirents(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
}

function knowledgeFiles(mnsDir) {
  const dir = join(mnsDir, 'knowledge', 'items');
  return sortDirents(dir)
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => {
      const src = join(dir, e.name);
      return { id: e.name.replace(/\.md$/, ''), faculty: 'knowledge', src, rel: e.name, hash: sha256(readFileSync(src)) };
    });
}

function actionFiles(mnsDir) {
  const dir = join(mnsDir, 'actions');
  return sortDirents(dir)
    .filter((e) => e.isDirectory() && e.name !== 'inbox' && e.name !== 'proposals')
    .map((e) => {
      const adir = join(dir, e.name);
      // Hash the dir's defining files concatenated (action.json + run.mjs/SKILL.md).
      const parts = ['action.json', 'run.mjs', 'SKILL.md']
        .map((f) => join(adir, f))
        .filter((p) => existsSync(p));
      const concat = Buffer.concat(parts.map((p) => readFileSync(p)));
      return {
        id: e.name, faculty: 'actions', files: parts.map((p) => p.slice(adir.length + 1)),
        adir, hash: parts.length ? sha256(concat) : null,
      };
    });
}

function memoryFiles(mnsDir) {
  const dir = join(mnsDir, 'memory', 'entries');
  return sortDirents(dir)
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => {
      const src = join(dir, e.name);
      return { id: e.name.replace(/\.md$/, ''), faculty: 'memory', src, rel: e.name, hash: sha256(readFileSync(src)) };
    });
}

function registryHash(mnsDir) {
  const dir = join(mnsDir, 'knowledge', 'registry');
  const files = sortDirents(dir).filter((e) => e.isFile() && e.name.endsWith('.json'));
  if (!files.length) return null;
  return sha256(Buffer.concat(files.map((e) => readFileSync(join(dir, e.name)))));
}

function fileHashOrNull(p) {
  return existsSync(p) ? sha256(readFileSync(p)) : null;
}

/**
 * Snapshot the current faculty state → the `faculties` manifest object.
 * Tolerates missing files (empty arrays / null hashes).
 */
export function snapshotFaculties(mnsDir) {
  return {
    knowledge: {
      items: knowledgeFiles(mnsDir).map(({ id, hash }) => ({ id, hash })),
      registryHash: registryHash(mnsDir),
    },
    actions: {
      items: actionFiles(mnsDir).map(({ id, hash }) => ({ id, hash })),
    },
    guardrails: {
      rulesHash: fileHashOrNull(join(mnsDir, 'guardrails', 'rules.json')),
    },
    instructions: {
      projectHash: fileHashOrNull(join(mnsDir, 'instructions', 'project.md')),
    },
    memory: {
      items: memoryFiles(mnsDir).map(({ id, hash }) => ({ id, hash })),
    },
  };
}

// --- agent identity ---------------------------------------------------------

/** Stable agent id derived from the repo root: agt_<first12 of sha256(root)>. */
export function agentId(mnsDir) {
  // mnsDir is the agent/ dir; the repo root is its parent.
  const root = dirname(mnsDir);
  return 'agt_' + sha256(root).slice(0, 12);
}

/** Add/repair the agent block in mns.json (bump to v2), preserving other fields. */
export function ensureAgent(mnsDir) {
  const path = mnsJsonPath(mnsDir);
  const m = existsSync(path) ? readJson(path) : {};
  const id = agentId(mnsDir);
  if (!m.agent || !m.agent.id) {
    m.agent = { id, createdAt: new Date().toISOString() };
  }
  m.version = 2;
  writeJson(path, m);
  return m.agent;
}

// --- generation read/list ---------------------------------------------------

/** The active generation id, or null. */
export function activeGeneration(mnsDir) {
  const p = activePath(mnsDir);
  if (!existsSync(p)) return null;
  try { return readJson(p).active ?? null; } catch { return null; }
}

/** All generation ids in ascending order. */
export function listGenerations(mnsDir) {
  const dir = generationsDir(mnsDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^gen_\d+\.json$/.test(f))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

/** Read one lockfile, or null. */
export function readGeneration(mnsDir, id) {
  const p = lockfilePath(mnsDir, id);
  return existsSync(p) ? readJson(p) : null;
}

/** Item-list faculties carry {id,hash}[]; single-file faculties a *Hash scalar. */
const HASH_KEYS = { knowledge: 'registryHash', instructions: 'projectHash', guardrails: 'rulesHash' };

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
 * Per-faculty diff of generation `id` against its forkedFrom parent (pure).
 * For item-list faculties (knowledge/actions/memory) reports added/changed/removed
 * id lists. For hash-only faculties (guardrails/instructions, and knowledge's
 * registry) reports a `changed` boolean when the scalar hash differs. When there
 * is no parent (forkedFrom null), everything present counts as added.
 * Returns null for an unknown id.
 */
export function diffGenerations(mnsDir, id) {
  const child = readGeneration(mnsDir, id);
  if (!child) return null;
  const parent = child.forkedFrom ? readGeneration(mnsDir, child.forkedFrom) : null;
  const cf = child.faculties || {};
  const pf = parent?.faculties || {};
  const faculties = {};
  for (const f of ['knowledge', 'actions', 'memory']) {
    faculties[f] = diffItems(pf[f]?.items, cf[f]?.items);
    // knowledge also has a registry hash
    if (f === 'knowledge') {
      faculties[f].registryChanged = (cf.knowledge?.registryHash ?? null) !== (pf.knowledge?.registryHash ?? null);
    }
  }
  for (const f of ['guardrails', 'instructions']) {
    const key = HASH_KEYS[f];
    faculties[f] = { changed: (cf[f]?.[key] ?? null) !== (pf[f]?.[key] ?? null) };
  }
  return {
    id,
    forkedFrom: child.forkedFrom ?? null,
    mintedFrom: Array.isArray(child.mintedFrom) ? child.mintedFrom : [],
    mintedAt: child.mintedAt ?? null,
    faculties,
  };
}

function nextGenId(mnsDir) {
  const ids = listGenerations(mnsDir);
  const max = ids.reduce((m, id) => Math.max(m, parseInt(id.slice(4), 10) || 0), 0);
  return 'gen_' + String(max + 1).padStart(3, '0');
}

// --- mint -------------------------------------------------------------------

function copySnapshot(mnsDir, id) {
  const base = join(snapshotsDir(mnsDir), id);
  for (const it of knowledgeFiles(mnsDir)) {
    const dest = join(base, 'knowledge', it.rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, readFileSync(it.src));
  }
  for (const it of memoryFiles(mnsDir)) {
    const dest = join(base, 'memory', it.rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, readFileSync(it.src));
  }
  for (const a of actionFiles(mnsDir)) {
    for (const rel of a.files) {
      const dest = join(base, 'actions', a.id, rel);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, readFileSync(join(a.adir, rel)));
    }
  }
  // single-file faculties
  const rules = join(mnsDir, 'guardrails', 'rules.json');
  if (existsSync(rules)) {
    const dest = join(base, 'guardrails', 'rules.json');
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, readFileSync(rules));
  }
  const proj = join(mnsDir, 'instructions', 'project.md');
  if (existsSync(proj)) {
    const dest = join(base, 'instructions', 'project.md');
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, readFileSync(proj));
  }
}

/**
 * Mint a new generation: freeze the current faculty state into a content-addressed
 * lockfile + a byte-for-byte snapshot, and make it active.
 */
export function mintGeneration(mnsDir, { forkedFrom = null, mintedFrom = [] } = {}) {
  const agent = ensureAgent(mnsDir).id;
  const id = nextGenId(mnsDir);
  const lockfile = {
    id,
    agent,
    mintedAt: new Date().toISOString(),
    forkedFrom,
    mintedFrom,
    faculties: snapshotFaculties(mnsDir),
  };
  copySnapshot(mnsDir, id);
  writeJson(lockfilePath(mnsDir, id), lockfile);
  writeJson(activePath(mnsDir), { active: id });
  return lockfile;
}

// --- rollback ---------------------------------------------------------------

function archive(mnsDir, faculty, src) {
  // Park (never delete) under <faculty>/_rolledback/<basename> — by basename so
  // a restore is a simple, flat audit trail of what the rollback displaced.
  const dest = join(mnsDir, faculty, '_rolledback', src.slice(dirname(src).length + 1));
  mkdirSync(dirname(dest), { recursive: true });
  renameSync(src, dest);
}

/**
 * Restore a past generation by content: write each snapshotted item back to its
 * live faculty path; MOVE (never delete) active items absent from the target into
 * <faculty>/_rolledback/; reindex knowledge; flip the active pointer.
 */
export function rollback(mnsDir, id) {
  const target = readGeneration(mnsDir, id);
  if (!target) throw new Error(`no generation '${id}'`);
  const base = join(snapshotsDir(mnsDir), id);
  let restored = 0;

  // 1) restore snapshotted knowledge items
  const targetKnowledge = new Set((target.faculties.knowledge?.items ?? []).map((i) => i.id));
  for (const i of target.faculties.knowledge?.items ?? []) {
    const snap = join(base, 'knowledge', `${i.id}.md`);
    if (existsSync(snap)) {
      const dest = join(mnsDir, 'knowledge', 'items', `${i.id}.md`);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, readFileSync(snap));
      restored++;
    }
  }
  // archive live knowledge items not in the target
  const kdir = join(mnsDir, 'knowledge', 'items');
  if (existsSync(kdir)) {
    for (const e of readdirSync(kdir, { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith('.md') && !targetKnowledge.has(e.name.replace(/\.md$/, ''))) {
        archive(mnsDir, 'knowledge', join(kdir, e.name));
      }
    }
  }

  // 2) restore snapshotted memory items + archive extras
  const targetMemory = new Set((target.faculties.memory?.items ?? []).map((i) => i.id));
  for (const i of target.faculties.memory?.items ?? []) {
    const snap = join(base, 'memory', `${i.id}.md`);
    if (existsSync(snap)) {
      const dest = join(mnsDir, 'memory', 'entries', `${i.id}.md`);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, readFileSync(snap));
      restored++;
    }
  }
  const mdir = join(mnsDir, 'memory', 'entries');
  if (existsSync(mdir)) {
    for (const e of readdirSync(mdir, { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith('.md') && !targetMemory.has(e.name.replace(/\.md$/, ''))) {
        archive(mnsDir, 'memory', join(mdir, e.name));
      }
    }
  }

  // 3) restore snapshotted actions + archive extras
  const targetActions = new Set((target.faculties.actions?.items ?? []).map((i) => i.id));
  const asnap = join(base, 'actions');
  if (existsSync(asnap)) {
    for (const slugEnt of readdirSync(asnap, { withFileTypes: true })) {
      if (!slugEnt.isDirectory()) continue;
      const sdir = join(asnap, slugEnt.name);
      for (const f of readdirSync(sdir)) {
        const dest = join(mnsDir, 'actions', slugEnt.name, f);
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, readFileSync(join(sdir, f)));
      }
      restored++;
    }
  }
  const adir = join(mnsDir, 'actions');
  if (existsSync(adir)) {
    for (const e of readdirSync(adir, { withFileTypes: true })) {
      if (e.isDirectory() && e.name !== 'inbox' && e.name !== 'proposals' && e.name !== '_rolledback' && !targetActions.has(e.name)) {
        archive(mnsDir, 'actions', join(adir, e.name));
      }
    }
  }

  // 4) restore single-file faculties from the snapshot
  const grules = join(base, 'guardrails', 'rules.json');
  if (existsSync(grules)) {
    const dest = join(mnsDir, 'guardrails', 'rules.json');
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, readFileSync(grules));
    restored++;
  }
  const proj = join(base, 'instructions', 'project.md');
  if (existsSync(proj)) {
    const dest = join(mnsDir, 'instructions', 'project.md');
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, readFileSync(proj));
    restored++;
  }

  // 5) regenerate the derived knowledge index + flip the pointer
  try { reindex(mnsDir); } catch { /* derived index; tolerate absence of node:sqlite features */ }
  writeJson(activePath(mnsDir), { active: id });
  return { ok: true, restored };
}
