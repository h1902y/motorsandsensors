// `zuzuu status` — detected hosts + recorded sessions (the git-native index).

import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { detected } from '../capture/adapters/registry.mjs';
import { sessionStatus } from '../sessions/session-git.mjs';
import { readIndex, paths } from '../core/store.mjs';
import { MODULES } from '../module/contract.mjs';
import { listProposals } from '../module/proposal.mjs';
import { activeGeneration as activeGenerationFn } from '../module/generation/read.mjs';
import { detectDrift } from './doctor.mjs';

const fmtDur = (ms) => (ms < 60_000 ? `${(ms / 1000).toFixed(0)}s` : `${(ms / 60_000).toFixed(1)}m`);

/** Pure: structured status for a module home (the zuzuu-web /status source). Fail-soft per field.
 *  `session` is injectable (like hosts) for hermetic tests; default = the repo above the home. */
export function statusData(agentDir, { hosts = detected().map((a) => ({ name: a.name })), session } = {}) {
  let active = null, drift = { dirty: false, items: [] };
  const pending = {};
  try { active = activeGenerationFn(agentDir); } catch { active = null; }
  for (const f of MODULES) {
    try { pending[f] = listProposals(agentDir, f).length; } catch { pending[f] = 0; }
  }
  try {
    const d = detectDrift(agentDir);
    const items = Array.isArray(d?.drifted) ? d.drifted : [];
    drift = { dirty: items.length > 0, items };
  } catch { /* fail-soft */ }
  let sess = session;
  if (sess === undefined) {
    try { sess = sessionStatus(dirname(agentDir)); } catch { sess = null; } // sessionStatus never throws — belt + braces
  }
  return { home: existsSync(agentDir), activeGeneration: active, pending, drift, hosts, session: sess };
}

/**
 * Pure: the modules graduation line for `zuzuu status`. Fail-soft — any error in
 * a sub-read degrades to a safe default rather than throwing.
 * @param {string} agentDir
 * @returns {string}
 */
export function modulesLine(agentDir) {
  let gen = null, pending = 0, drifted = false;
  try { gen = activeGenerationFn(agentDir); } catch { /* fail-soft */ }
  try {
    for (const f of MODULES) {
      try { pending += listProposals(agentDir, f).length; } catch { /* per-module fail-soft */ }
    }
  } catch { /* fail-soft */ }
  try {
    const d = detectDrift(agentDir);
    drifted = Array.isArray(d?.drifted) && d.drifted.length > 0;
  } catch { /* fail-soft */ }
  let line = `modules: ${gen || 'no generation yet'} · ${pending} pending review`;
  if (drifted) line += ' · ⚠ drift (run zuzuu doctor)';
  return line;
}

export function status(args = {}) {
  if (args.json) { console.log(JSON.stringify(statusData(paths().dir))); return; }
  const { sessions } = readIndex();
  console.log(`this project — recorded sessions (.zuzuu/sessions.json): ${sessions.length}`);
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

  try { console.log('\n' + modulesLine(paths().dir)); } catch { /* fail-soft */ }

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
