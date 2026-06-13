// zuzuu/module/generation/checkpoint.mjs — CHECKPOINTS (W2.5 Phase 2,
// 2026-06-13). A checkpoint is the *composition* of per-module generations for
// whole-brain coherence: a pin of each module's active generation at a moment
// in time. Module generations are the atoms (read/write.mjs); checkpoints stitch
// them so you can roll the WHOLE agent back to a coherent past, not one module.
//
// Layout under .zuzuu/checkpoints/:
//   <id>.json   { id, createdAt, label?, pins:{ <module>: gen_id } }
//
// Mint  = snapshot the current per-module actives into pins (a cheap pointer
//         record — the bytes already live in each module's snapshots/).
// Rollback = for each pinned module → rollbackModule(module, gen_id), restoring
//         each module's bytes + flipping its active. Modules NOT pinned are left
//         untouched (a checkpoint only governs what it captured).

import { join, dirname } from 'node:path';
import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { MODULES } from '../contract.mjs';
import { activeModuleGeneration } from './read.mjs';
import { rollbackModule } from './write.mjs';

const writeJson = (p, obj) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
};

export const checkpointsDir = (agentDir) => join(agentDir, 'checkpoints');
export const checkpointPath = (agentDir, id) => join(checkpointsDir(agentDir), `${id}.json`);

/** Next checkpoint id (cp_NNN), one past the current max. */
function nextCheckpointId(agentDir) {
  const ids = listCheckpointIds(agentDir);
  const max = ids.reduce((m, id) => Math.max(m, parseInt(id.slice(3), 10) || 0), 0);
  return 'cp_' + String(max + 1).padStart(3, '0');
}

/** All checkpoint ids, ascending. */
export function listCheckpointIds(agentDir) {
  const dir = checkpointsDir(agentDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^cp_\d+\.json$/.test(f))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

/** Read one checkpoint, or null (fail-soft on corrupt). */
export function readCheckpoint(agentDir, id) {
  const p = checkpointPath(agentDir, id);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

/**
 * Mint a checkpoint: pin the current active generation of every module that HAS
 * one. Modules without a minted generation are simply not pinned. The optional
 * `pins` override (used by the migrator) sets explicit pins instead of reading
 * actives.
 */
export function mintCheckpoint(agentDir, { label = null, pins = null } = {}) {
  const resolved = pins ?? (() => {
    const p = {};
    for (const m of MODULES) {
      const active = activeModuleGeneration(agentDir, m);
      if (active) p[m] = active;
    }
    return p;
  })();
  const id = nextCheckpointId(agentDir);
  const cp = { id, createdAt: new Date().toISOString(), ...(label ? { label } : {}), pins: resolved };
  writeJson(checkpointPath(agentDir, id), cp);
  return cp;
}

/** List + read all checkpoints — the porcelain + daemon source. */
export function listCheckpoints(agentDir) {
  return listCheckpointIds(agentDir)
    .map((id) => readCheckpoint(agentDir, id))
    .filter(Boolean);
}

/**
 * Roll the whole brain back to a checkpoint: for each pinned module, restore
 * that module's bytes + active to the pinned generation. A module whose pinned
 * generation no longer exists is reported as skipped (fail-soft — never abort
 * the others). Returns per-module results.
 */
export function rollbackCheckpoint(agentDir, id) {
  const cp = readCheckpoint(agentDir, id);
  if (!cp) throw new Error(`no checkpoint '${id}'`);
  const results = [];
  for (const [module, genId] of Object.entries(cp.pins || {})) {
    try {
      const r = rollbackModule(agentDir, module, genId);
      results.push({ module, generation: genId, restored: r.restored, ok: true });
    } catch (err) {
      results.push({ module, generation: genId, ok: false, error: String(err.message ?? err) });
    }
  }
  return { ok: results.every((r) => r.ok), id, results };
}

/** Diff/show payload: a checkpoint with its pins and pin existence. */
export function diffCheckpoint(agentDir, id) {
  const cp = readCheckpoint(agentDir, id);
  if (!cp) return null;
  return {
    id: cp.id,
    createdAt: cp.createdAt ?? null,
    label: cp.label ?? null,
    pins: Object.entries(cp.pins || {}).map(([module, generation]) => ({ module, generation })),
  };
}
