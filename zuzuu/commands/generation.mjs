// zuzuu/commands/generation.mjs — `zuzuu generation` CLI (WS3-T1).
//
//   zuzuu generation list             generations (id · mintedAt · mintedFrom count · ● active)
//   zuzuu generation mint             manually mint a generation from the current faculty state
//   zuzuu generation rollback <id>    restore a past generation by content (flip active + restore)

import { paths, repoRoot } from '../core/store.mjs';
import { listGenerations, readGeneration, activeGeneration, diffGenerations } from '../faculty/generation/read.mjs';
import { mintGeneration, rollback } from '../faculty/generation/write.mjs';

function agentDir() {
  return paths(repoRoot(process.cwd())).dir;
}

function list(dir) {
  const ids = listGenerations(dir);
  if (!ids.length) return console.log('no generations yet — mint one with `zuzuu generation mint`');
  const active = activeGeneration(dir);
  for (const id of ids) {
    const lf = readGeneration(dir, id) ?? {};
    const mark = id === active ? '●' : ' ';
    const from = Array.isArray(lf.mintedFrom) ? lf.mintedFrom.length : 0;
    console.log(`${mark} ${id}  ${lf.mintedAt ?? '?'}  mintedFrom:${from}`);
  }
}

/**
 * Pure: mint a new generation and return structured data.
 * @param {string} dir
 * @param {object} [opts]
 * @param {string[]} [opts.mintedFrom]  proposal ids this generation is built from
 * @returns {{ id: string, mintedFrom: string[], forkedFrom: string|null }}
 */
export function mintGenerationData(dir, { mintedFrom = [] } = {}) {
  const forkedFrom = activeGeneration(dir);
  const lf = mintGeneration(dir, { forkedFrom, mintedFrom });
  return { id: lf.id, mintedFrom: lf.mintedFrom ?? [], forkedFrom: lf.forkedFrom ?? null };
}

/**
 * Pure: rollback to a generation and return structured data.
 * @param {string} dir
 * @param {string} id
 * @returns {{ ok: boolean, restored: number, active: string }}
 */
export function rollbackData(dir, id) {
  const r = rollback(dir, id);
  return { ok: r.ok, restored: r.restored, active: id };
}

function mint(dir, args = {}) {
  const mintedFrom = args.from ? String(args.from).split(',').map((s) => s.trim()).filter(Boolean) : [];
  if (args.json) {
    const d = mintGenerationData(dir, { mintedFrom });
    console.log(JSON.stringify(d));
    return;
  }
  const forkedFrom = activeGeneration(dir);
  const lf = mintGeneration(dir, { forkedFrom, mintedFrom });
  console.log(`✓ minted ${lf.id}${forkedFrom ? ` (forkedFrom ${forkedFrom})` : ''} — now active`);
}

/** Pure: generation list payload — the zuzuu-web /generations source. */
export function generationListData(dir) {
  const active = activeGeneration(dir);
  const generations = listGenerations(dir).map((id) => {
    const lf = readGeneration(dir, id) ?? {};
    return { id, mintedAt: lf.mintedAt ?? null, mintedFrom: Array.isArray(lf.mintedFrom) ? lf.mintedFrom : [] };
  });
  return { active, generations };
}

/** Pure: generation diff payload, or null for an unknown id — the zuzuu-web /generation/:id source. */
export function generationShowData(dir, id) {
  const d = diffGenerations(dir, id);
  return d ? { id, ...d } : null;
}

/** Pure: the per-faculty diff lines for `generation show`. */
export function showLines(dir, id) {
  const d = diffGenerations(dir, id);
  if (!d) return null;
  const lines = [];
  lines.push(`${id}  ${d.mintedAt ?? '?'}`);
  lines.push(`  forkedFrom: ${d.forkedFrom ?? '(none — first generation)'}`);
  lines.push(`  mintedFrom: ${d.mintedFrom.length} proposal(s)`);
  lines.push('  changes vs parent:');
  // all five faculties are envelope-item lists under the Faculty Standard (W24)
  for (const f of ['knowledge', 'actions', 'memory', 'guardrails', 'instructions']) {
    const x = d.faculties[f] || { added: [], changed: [], removed: [] };
    const parts = [];
    if (x.added.length) parts.push(`+${x.added.length} added`);
    if (x.changed.length) parts.push(`~${x.changed.length} changed`);
    if (x.removed.length) parts.push(`-${x.removed.length} removed`);
    if (f === 'knowledge' && x.registryChanged) parts.push('registry changed');
    lines.push(`    ${f}: ${parts.length ? parts.join(' · ') : 'no change'}`);
  }
  return lines.join('\n');
}

function show(dir, id) {
  if (!id) { console.error('usage: zuzuu generation show <id>'); process.exit(1); }
  const out = showLines(dir, id);
  if (out == null) { console.error(`no generation '${id}'`); process.exit(1); }
  console.log(out);
}

function doRollback(dir, id, args = {}) {
  if (!id) { console.error('usage: zuzuu generation rollback <id>'); process.exit(1); }
  if (!readGeneration(dir, id)) { console.error(`no generation '${id}'`); process.exit(1); }
  if (args.json) {
    const d = rollbackData(dir, id);
    console.log(JSON.stringify(d));
    return;
  }
  const r = rollback(dir, id);
  console.log(`✓ rolled back to ${id} — restored ${r.restored} item(s); active=${id}`);
}

export function generation(args) {
  const dir = agentDir();
  const sub = args._[0];
  if (!sub || sub === 'list') {
    if (args.json) { console.log(JSON.stringify(generationListData(dir))); return; }
    return list(dir);
  }
  if (sub === 'mint') return mint(dir, args);
  if (sub === 'show') {
    if (args.json) {
      const d = generationShowData(dir, args._[1]);
      if (d == null) { console.error(`no generation '${args._[1]}'`); process.exit(1); }
      console.log(JSON.stringify(d)); return;
    }
    return show(dir, args._[1]);
  }
  if (sub === 'rollback') return doRollback(dir, args._[1], args);
  console.error(`unknown: zuzuu generation ${sub}\nusage: zuzuu generation [list|show <id>|mint|rollback <id>]`);
  process.exit(1);
}
