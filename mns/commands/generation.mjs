// mns/commands/generation.mjs — `mns generation` CLI (WS3-T1).
//
//   mns generation list             generations (id · mintedAt · mintedFrom count · ● active)
//   mns generation mint             manually mint a generation from the current faculty state
//   mns generation rollback <id>    restore a past generation by content (flip active + restore)

import { paths, repoRoot } from '../store.mjs';
import {
  listGenerations, readGeneration, activeGeneration, mintGeneration, rollback,
} from '../faculty/generation.mjs';

function mnsDir() {
  return paths(repoRoot(process.cwd())).dir;
}

function list(dir) {
  const ids = listGenerations(dir);
  if (!ids.length) return console.log('no generations yet — mint one with `mns generation mint`');
  const active = activeGeneration(dir);
  for (const id of ids) {
    const lf = readGeneration(dir, id) ?? {};
    const mark = id === active ? '●' : ' ';
    const from = Array.isArray(lf.mintedFrom) ? lf.mintedFrom.length : 0;
    console.log(`${mark} ${id}  ${lf.mintedAt ?? '?'}  mintedFrom:${from}`);
  }
}

function mint(dir) {
  const forkedFrom = activeGeneration(dir);
  const lf = mintGeneration(dir, { forkedFrom });
  console.log(`✓ minted ${lf.id}${forkedFrom ? ` (forkedFrom ${forkedFrom})` : ''} — now active`);
}

function doRollback(dir, id) {
  if (!id) { console.error('usage: mns generation rollback <id>'); process.exit(1); }
  if (!readGeneration(dir, id)) { console.error(`no generation '${id}'`); process.exit(1); }
  const r = rollback(dir, id);
  console.log(`✓ rolled back to ${id} — restored ${r.restored} item(s); active=${id}`);
}

export function generation(args) {
  const dir = mnsDir();
  const sub = args._[0];
  if (!sub || sub === 'list') return list(dir);
  if (sub === 'mint') return mint(dir);
  if (sub === 'rollback') return doRollback(dir, args._[1]);
  console.error(`unknown: mns generation ${sub}\nusage: mns generation [list|mint|rollback <id>]`);
  process.exit(1);
}
