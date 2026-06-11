// `mns status` — detected hosts + recorded sessions (the git-native index).

import { existsSync } from 'node:fs';
import { detected } from '../../experiments/experiment-1-trace-capture/adapters/registry.mjs';
import { readIndex, paths } from '../store.mjs';
import { FACULTIES } from '../faculty/contract.mjs';
import { listProposals } from '../faculty/proposal.mjs';
import { activeGeneration as activeGenerationFn } from '../faculty/generation.mjs';
import { detectDrift } from './doctor.mjs';

const fmtDur = (ms) => (ms < 60_000 ? `${(ms / 1000).toFixed(0)}s` : `${(ms / 60_000).toFixed(1)}m`);

/** Pure: structured status for a faculty home (the zuzuu-web /status source). Fail-soft per field. */
export function statusData(mnsDir) {
  let active = null, drift = { dirty: false, items: [] };
  const pending = {};
  try { active = activeGenerationFn(mnsDir); } catch { active = null; }
  for (const f of FACULTIES) {
    try { pending[f] = listProposals(mnsDir, f).length; } catch { pending[f] = 0; }
  }
  try {
    const d = detectDrift(mnsDir);
    const items = Array.isArray(d?.drifted) ? d.drifted : [];
    drift = { dirty: items.length > 0, items };
  } catch { /* fail-soft */ }
  return { home: existsSync(mnsDir), activeGeneration: active, pending, drift };
}

/**
 * Pure: the faculties graduation line for `mns status`. Fail-soft — any error in
 * a sub-read degrades to a safe default rather than throwing.
 * @param {string} mnsDir
 * @returns {string}
 */
export function facultiesLine(mnsDir) {
  let gen = null, pending = 0, drifted = false;
  try { gen = activeGenerationFn(mnsDir); } catch { /* fail-soft */ }
  try {
    for (const f of FACULTIES) {
      try { pending += listProposals(mnsDir, f).length; } catch { /* per-faculty fail-soft */ }
    }
  } catch { /* fail-soft */ }
  try {
    const d = detectDrift(mnsDir);
    drifted = Array.isArray(d?.drifted) && d.drifted.length > 0;
  } catch { /* fail-soft */ }
  let line = `faculties: ${gen || 'no generation yet'} · ${pending} pending review`;
  if (drifted) line += ' · ⚠ drift (run zuzuu doctor)';
  return line;
}

export function status(args = {}) {
  if (args.json) { console.log(JSON.stringify(statusData(paths().dir))); return; }
  const { sessions } = readIndex();
  console.log(`this project — recorded sessions (agent/sessions.json): ${sessions.length}`);
  if (!sessions.length) {
    console.log('  none yet — run `zuzuu capture`, or just start your agent (live capture)');
  } else {
    console.log('');
    console.log('  STATUS     HOST          DUR     GIT       T/TOOLS/ERR  SESSION');
    for (const s of sessions.slice(0, 12)) {
      const dur = fmtDur(s.durationMs || 0).padStart(6);
      const git = (s.git?.commit ? s.git.commit.slice(0, 7) : '-------').padEnd(8);
      const cnt = `${s.counts?.turns ?? 0}/${s.counts?.tools ?? 0}/${s.counts?.errors ?? 0}`.padEnd(11);
      console.log(`  ${s.status.padEnd(10)} ${s.host.padEnd(13)} ${dur}  ${git}  ${cnt}  ${s.id.slice(0, 8)}`);
    }
    if (sessions.length > 12) console.log(`  … and ${sessions.length - 12} more`);
  }

  try { console.log('\n' + facultiesLine(paths().dir)); } catch { /* fail-soft */ }

  const hosts = detected();
  console.log('\nhosts detected on this machine:');
  if (!hosts.length) {
    console.log('  (none — no supported agent data found)');
  } else {
    for (const a of hosts) {
      const n = a.listSessions({ cwd: process.cwd() }).length;
      console.log(`  ● ${a.name}  (${n} session${n === 1 ? '' : 's'} available)`);
    }
  }
}
