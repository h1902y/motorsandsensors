// zuzuu/commands/checkpoint.mjs — `zuzuu checkpoint` (W2.5 Phase 2). A checkpoint
// composes the per-module generations for whole-brain coherence: it pins each
// module's active generation, and rolling back restores every pinned module.
//
//   zuzuu checkpoint list                 minted checkpoints (id · createdAt · label · pin count)
//   zuzuu checkpoint mint [--label X]     pin the current per-module actives
//   zuzuu checkpoint show <id>            the pins (module → generation)
//   zuzuu checkpoint rollback <id>        restore every pinned module to its pin

import { paths } from '../core/store.mjs';
import {
  mintCheckpoint, listCheckpoints, readCheckpoint, rollbackCheckpoint, diffCheckpoint,
} from '../module/generation/checkpoint.mjs';

/** Pure: the checkpoint list payload — the daemon /checkpoints source. */
export function checkpointListData(agentDir) {
  return {
    checkpoints: listCheckpoints(agentDir).map((cp) => ({
      id: cp.id,
      createdAt: cp.createdAt ?? null,
      label: cp.label ?? null,
      pins: cp.pins ?? {},
    })),
  };
}

function list(agentDir, log) {
  const { checkpoints } = checkpointListData(agentDir);
  if (!checkpoints.length) return log('no checkpoints yet — `zuzuu checkpoint mint` pins the current module generations');
  for (const cp of checkpoints) {
    const n = Object.keys(cp.pins).length;
    log(`${cp.id}  ${cp.createdAt ?? '?'}  ${n} module(s)${cp.label ? ` — ${cp.label}` : ''}`);
  }
}

function mint(agentDir, args, log) {
  const label = typeof args.label === 'string' ? args.label : null;
  const cp = mintCheckpoint(agentDir, { label });
  if (args.json) { log(JSON.stringify(cp)); return; }
  const pins = Object.entries(cp.pins).map(([m, g]) => `${m} ${g}`).join(' · ') || '(no module generations to pin)';
  log(`✓ minted ${cp.id}${label ? ` — ${label}` : ''}: ${pins}`);
}

function show(agentDir, id, args, log) {
  if (!id) { console.error('usage: zuzuu checkpoint show <id>'); process.exitCode = 1; return; }
  const d = diffCheckpoint(agentDir, id);
  if (!d) { console.error(`no checkpoint '${id}'`); process.exitCode = 1; return; }
  if (args.json) { log(JSON.stringify(d)); return; }
  log(`${d.id}  ${d.createdAt ?? '?'}${d.label ? ` — ${d.label}` : ''}`);
  for (const p of d.pins) log(`  ${p.module.padEnd(13)} ${p.generation}`);
}

function rollback(agentDir, id, args, log) {
  if (!id) { console.error('usage: zuzuu checkpoint rollback <id>'); process.exitCode = 1; return; }
  if (!readCheckpoint(agentDir, id)) { console.error(`no checkpoint '${id}'`); process.exitCode = 1; return; }
  const r = rollbackCheckpoint(agentDir, id);
  if (args.json) { log(JSON.stringify(r)); return; }
  log(`${r.ok ? '✓' : '⚠'} rolled back to ${id}:`);
  for (const res of r.results) {
    log(res.ok
      ? `  ✓ ${res.module} → ${res.generation} (restored ${res.restored})`
      : `  ✗ ${res.module} → ${res.generation}: ${res.error}`);
  }
}

export function checkpoint(args = {}, log = console.log) {
  const agentDir = paths().dir;
  const sub = (args._ ?? [])[0] || 'list';
  if (sub === 'list') {
    if (args.json) { log(JSON.stringify(checkpointListData(agentDir))); return; }
    return list(agentDir, log);
  }
  if (sub === 'mint') return mint(agentDir, args, log);
  if (sub === 'show') return show(agentDir, (args._ ?? [])[1], args, log);
  if (sub === 'rollback') return rollback(agentDir, (args._ ?? [])[1], args, log);
  console.error('usage: zuzuu checkpoint [list|mint [--label X]|show <id>|rollback <id>]');
  process.exitCode = 1;
}
