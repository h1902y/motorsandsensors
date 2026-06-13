// zuzuu/module/generation/write.mjs — the PER-MODULE generation WRITE side
// (W2.5 Phase 2, 2026-06-13): agent identity repair, per-module minting (freeze
// one module's items + snapshot + flip its active) and per-module rollback
// (restore one module's bytes, archive displaced items, flip its active).
//
// Module independence is law: mintModuleGeneration / rollbackModule read and
// write ONLY the named module's tree (its items + its generations/ dir). They
// never touch a sibling module. Checkpoints (checkpoint.mjs) compose these.

import { join, dirname } from 'node:path';
import {
  existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync, renameSync,
} from 'node:fs';
import { reindex } from '../../knowledge/index.mjs';
import {
  moduleSnapshotsDir, moduleActivePath, moduleLockfilePath, agentJsonPath, readJson,
  moduleItemFiles, snapshotModuleItems, agentId, listModuleGenerations, readModuleGeneration,
  activeModuleGeneration,
} from './read.mjs';

const writeJson = (p, obj) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
};

/** Add/repair the agent block in agent.json (bump to v2), preserving other fields. */
export function ensureAgent(agentDir) {
  const path = agentJsonPath(agentDir);
  const m = existsSync(path) ? readJson(path) : {};
  const id = agentId(agentDir);
  if (!m.agent || !m.agent.id) {
    m.agent = { id, createdAt: new Date().toISOString() };
  }
  m.version = 2;
  writeJson(path, m);
  return m.agent;
}

/** Next per-module generation id (gen_NNN), one past that module's current max. */
function nextModuleGenId(agentDir, module) {
  const ids = listModuleGenerations(agentDir, module);
  const max = ids.reduce((m, id) => Math.max(m, parseInt(id.slice(4), 10) || 0), 0);
  return 'gen_' + String(max + 1).padStart(3, '0');
}

// --- mint -------------------------------------------------------------------

/** Copy ONE module's live item bytes into snapshots/<id>/ (byte-for-byte). */
function copyModuleSnapshot(agentDir, module, id) {
  const base = join(moduleSnapshotsDir(agentDir, module), id);
  for (const it of moduleItemFiles(agentDir, module)) {
    if (module === 'actions') {
      // dir-shaped: copy each defining file under <id>/<slug>/<rel>
      for (const rel of it.files) {
        const dest = join(base, it.id, rel);
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, readFileSync(join(it.adir, rel)));
      }
    } else {
      const dest = join(base, it.rel);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, readFileSync(it.src));
    }
  }
}

/**
 * Mint a new generation for ONE module: freeze its current items into a
 * content-addressed lockfile + a byte-for-byte snapshot, and make it active.
 * Reads/writes ONLY this module's tree. forkedFrom defaults to that module's
 * current active.
 */
export function mintModuleGeneration(agentDir, module, { forkedFrom = undefined, mintedFrom = [] } = {}) {
  const agent = ensureAgent(agentDir).id;
  const id = nextModuleGenId(agentDir, module);
  // Default the lineage parent to the module's ACTIVE generation — NOT its
  // max-numbered one. After a rollback-then-mint, the active is an older gen,
  // and forking from the max-numbered gen would record the wrong parent (garbage
  // diffs). An explicit forkedFrom always wins.
  const parent = forkedFrom !== undefined
    ? forkedFrom
    : (activeModuleGeneration(agentDir, module) ?? null);
  const lockfile = {
    id,
    module,
    agent,
    mintedAt: new Date().toISOString(),
    forkedFrom: parent,
    mintedFrom,
    items: snapshotModuleItems(agentDir, module),
  };
  copyModuleSnapshot(agentDir, module, id);
  writeJson(moduleLockfilePath(agentDir, module, id), lockfile);
  writeJson(moduleActivePath(agentDir, module), { active: id });
  return lockfile;
}

// --- rollback ---------------------------------------------------------------

/** Park (never delete) a displaced live item under <module>/_rolledback/<basename>.
 *  If a prior rollback already parked something by that name (a file overwrite is
 *  fine, but a non-empty dir rename would throw), suffix to a fresh name so we
 *  never lose bytes and never crash mid-rollback. */
function archive(agentDir, module, src) {
  const base = src.slice(dirname(src).length + 1);
  const parkDir = join(agentDir, module, '_rolledback');
  mkdirSync(parkDir, { recursive: true });
  let dest = join(parkDir, base);
  if (existsSync(dest)) {
    // collision: keep both — append a short timestamp before any extension.
    const dot = base.indexOf('.');
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot) : '';
    dest = join(parkDir, `${stem}.${Date.now().toString(36)}${ext}`);
  }
  renameSync(src, dest);
}

/** The live directory + filename convention for a flat-item module. */
const LIVE_ITEM_DIR = {
  knowledge: ['knowledge', 'items'],
  memory: ['memory', 'entries'],
  guardrails: ['guardrails', 'items'],
  instructions: ['instructions', 'items'],
};

/**
 * Restore a past generation of ONE module by content: write each snapshotted
 * item back to its live path; MOVE (never delete) active items absent from the
 * target into <module>/_rolledback/; flip that module's active pointer. For
 * knowledge, the derived index is regenerated. Reads/writes ONLY this module.
 */
export function rollbackModule(agentDir, module, id) {
  const target = readModuleGeneration(agentDir, module, id);
  if (!target) throw new Error(`no ${module} generation '${id}'`);
  const base = join(moduleSnapshotsDir(agentDir, module), id);
  const targetItems = target.items ?? [];
  const targetIds = new Set(targetItems.map((i) => i.id));
  const expected = targetItems.length;
  let restored = 0;

  if (module === 'actions') {
    // dir-shaped: restore each pinned slug's files from its snapshot dir. A slug
    // counts as restored only if its snapshot dir is present (else it's missing).
    for (const i of targetItems) {
      const sdir = join(base, i.id);
      if (!existsSync(sdir)) continue;
      for (const f of readdirSync(sdir)) {
        const dest = join(agentDir, 'actions', i.id, f);
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, readFileSync(join(sdir, f)));
      }
      restored++;
    }
    const adir = join(agentDir, 'actions');
    if (existsSync(adir)) {
      for (const e of readdirSync(adir, { withFileTypes: true })) {
        if (e.isDirectory() && !['inbox', 'proposals', '_rolledback', 'generations'].includes(e.name) && !targetIds.has(e.name)) {
          archive(agentDir, 'actions', join(adir, e.name));
        }
      }
    }
  } else {
    const liveSeg = LIVE_ITEM_DIR[module];
    if (!liveSeg) throw new Error(`unknown module '${module}'`);
    // 1) restore snapshotted items
    for (const i of targetItems) {
      const snap = join(base, `${i.id}.md`);
      if (existsSync(snap)) {
        const dest = join(agentDir, ...liveSeg, `${i.id}.md`);
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, readFileSync(snap));
        restored++;
      }
    }
    // 2) archive live items not in the target (move, never delete)
    const liveDir = join(agentDir, ...liveSeg);
    if (existsSync(liveDir)) {
      for (const e of readdirSync(liveDir, { withFileTypes: true })) {
        if (e.isFile() && e.name.endsWith('.md') && !targetIds.has(e.name.replace(/\.md$/, ''))) {
          archive(agentDir, module, join(liveDir, e.name));
        }
      }
    }
  }

  // 3) knowledge has a derived index; regenerate it (tolerate absence)
  if (module === 'knowledge') {
    try { reindex(agentDir); } catch { /* derived index; tolerate node:sqlite absence */ }
  }
  // 4) flip this module's pointer
  writeJson(moduleActivePath(agentDir, module), { active: id });
  // Honest result: ok ONLY if every pinned item was actually restored. A missing
  // snapshot file/slug means the rollback is partial — report it so the caller
  // (rollbackCheckpoint's every-ok) doesn't claim a clean restore. Items that
  // couldn't be restored are target items, so they were never archived — they
  // stay live in place, nothing lost.
  const missing = expected - restored;
  return { ok: restored === expected, module, restored, missing };
}
