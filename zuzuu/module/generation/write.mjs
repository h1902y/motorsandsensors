// zuzuu/module/generation/write.mjs — the generation WRITE side (WS3-T1,
// split per the 2026-06-13 overhaul): agent identity repair, minting (freeze +
// snapshot + flip active) and rollback (restore by content). Read-side paths,
// enumerators and diffing live in read.mjs.

import { join, dirname } from 'node:path';
import {
  existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync, renameSync,
} from 'node:fs';
import { reindex } from '../../knowledge/index.mjs';
import {
  snapshotsDir, activePath, lockfilePath, agentJsonPath, readJson,
  knowledgeFiles, memoryFiles, actionFiles, guardrailFiles, instructionFiles,
  snapshotModules, agentId, listGenerations, readGeneration,
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

function nextGenId(agentDir) {
  const ids = listGenerations(agentDir);
  const max = ids.reduce((m, id) => Math.max(m, parseInt(id.slice(4), 10) || 0), 0);
  return 'gen_' + String(max + 1).padStart(3, '0');
}

// --- mint -------------------------------------------------------------------

function copySnapshot(agentDir, id) {
  const base = join(snapshotsDir(agentDir), id);
  for (const it of knowledgeFiles(agentDir)) {
    const dest = join(base, 'knowledge', it.rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, readFileSync(it.src));
  }
  for (const it of memoryFiles(agentDir)) {
    const dest = join(base, 'memory', it.rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, readFileSync(it.src));
  }
  for (const a of actionFiles(agentDir)) {
    for (const rel of a.files) {
      const dest = join(base, 'actions', a.id, rel);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, readFileSync(join(a.adir, rel)));
    }
  }
  for (const it of guardrailFiles(agentDir)) {
    const dest = join(base, 'guardrails', it.rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, readFileSync(it.src));
  }
  for (const it of instructionFiles(agentDir)) {
    const dest = join(base, 'instructions', it.rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, readFileSync(it.src));
  }
}

/**
 * Mint a new generation: freeze the current module state into a content-addressed
 * lockfile + a byte-for-byte snapshot, and make it active.
 */
export function mintGeneration(agentDir, { forkedFrom = null, mintedFrom = [] } = {}) {
  const agent = ensureAgent(agentDir).id;
  const id = nextGenId(agentDir);
  const lockfile = {
    id,
    agent,
    mintedAt: new Date().toISOString(),
    forkedFrom,
    mintedFrom,
    modules: snapshotModules(agentDir),
  };
  copySnapshot(agentDir, id);
  writeJson(lockfilePath(agentDir, id), lockfile);
  writeJson(activePath(agentDir), { active: id });
  return lockfile;
}

// --- rollback ---------------------------------------------------------------

function archive(agentDir, module, src) {
  // Park (never delete) under <module>/_rolledback/<basename> — by basename so
  // a restore is a simple, flat audit trail of what the rollback displaced.
  const dest = join(agentDir, module, '_rolledback', src.slice(dirname(src).length + 1));
  mkdirSync(dirname(dest), { recursive: true });
  renameSync(src, dest);
}

/**
 * Restore a past generation by content: write each snapshotted item back to its
 * live module path; MOVE (never delete) active items absent from the target into
 * <module>/_rolledback/; reindex knowledge; flip the active pointer.
 */
export function rollback(agentDir, id) {
  const target = readGeneration(agentDir, id);
  if (!target) throw new Error(`no generation '${id}'`);
  const base = join(snapshotsDir(agentDir), id);
  let restored = 0;

  // 1) restore snapshotted knowledge items
  const targetKnowledge = new Set((target.modules.knowledge?.items ?? []).map((i) => i.id));
  for (const i of target.modules.knowledge?.items ?? []) {
    const snap = join(base, 'knowledge', `${i.id}.md`);
    if (existsSync(snap)) {
      const dest = join(agentDir, 'knowledge', 'items', `${i.id}.md`);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, readFileSync(snap));
      restored++;
    }
  }
  // archive live knowledge items not in the target
  const kdir = join(agentDir, 'knowledge', 'items');
  if (existsSync(kdir)) {
    for (const e of readdirSync(kdir, { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith('.md') && !targetKnowledge.has(e.name.replace(/\.md$/, ''))) {
        archive(agentDir, 'knowledge', join(kdir, e.name));
      }
    }
  }

  // 2) restore snapshotted memory items + archive extras
  const targetMemory = new Set((target.modules.memory?.items ?? []).map((i) => i.id));
  for (const i of target.modules.memory?.items ?? []) {
    const snap = join(base, 'memory', `${i.id}.md`);
    if (existsSync(snap)) {
      const dest = join(agentDir, 'memory', 'entries', `${i.id}.md`);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, readFileSync(snap));
      restored++;
    }
  }
  const mdir = join(agentDir, 'memory', 'entries');
  if (existsSync(mdir)) {
    for (const e of readdirSync(mdir, { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith('.md') && !targetMemory.has(e.name.replace(/\.md$/, ''))) {
        archive(agentDir, 'memory', join(mdir, e.name));
      }
    }
  }

  // 3) restore snapshotted actions + archive extras
  const targetActions = new Set((target.modules.actions?.items ?? []).map((i) => i.id));
  const asnap = join(base, 'actions');
  if (existsSync(asnap)) {
    for (const slugEnt of readdirSync(asnap, { withFileTypes: true })) {
      if (!slugEnt.isDirectory()) continue;
      const sdir = join(asnap, slugEnt.name);
      for (const f of readdirSync(sdir)) {
        const dest = join(agentDir, 'actions', slugEnt.name, f);
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, readFileSync(join(sdir, f)));
      }
      restored++;
    }
  }
  const adir = join(agentDir, 'actions');
  if (existsSync(adir)) {
    for (const e of readdirSync(adir, { withFileTypes: true })) {
      if (e.isDirectory() && e.name !== 'inbox' && e.name !== 'proposals' && e.name !== '_rolledback' && !targetActions.has(e.name)) {
        archive(agentDir, 'actions', join(adir, e.name));
      }
    }
  }

  // 4) restore guardrails + instructions items (same item-list contract)
  for (const [module, liveSeg] of [['guardrails', ['guardrails', 'items']], ['instructions', ['instructions', 'items']]]) {
    const targetIds = new Set((target.modules[module]?.items ?? []).map((i) => i.id));
    for (const i of target.modules[module]?.items ?? []) {
      const snap = join(base, module, `${i.id}.md`);
      if (existsSync(snap)) {
        const dest = join(agentDir, ...liveSeg, `${i.id}.md`);
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, readFileSync(snap));
        restored++;
      }
    }
    const liveDir = join(agentDir, ...liveSeg);
    if (existsSync(liveDir)) {
      for (const e of readdirSync(liveDir, { withFileTypes: true })) {
        if (e.isFile() && e.name.endsWith('.md') && !targetIds.has(e.name.replace(/\.md$/, ''))) {
          archive(agentDir, module, join(liveDir, e.name));
        }
      }
    }
  }

  // 5) regenerate the derived knowledge index + flip the pointer
  try { reindex(agentDir); } catch { /* derived index; tolerate absence of node:sqlite features */ }
  writeJson(activePath(agentDir), { active: id });
  return { ok: true, restored };
}
