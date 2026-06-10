// `mns status` — detected hosts + recorded sessions (the git-native index).

import { detected } from '../../experiments/experiment-1-trace-capture/adapters/registry.mjs';
import { readIndex } from '../store.mjs';

const fmtDur = (ms) => (ms < 60_000 ? `${(ms / 1000).toFixed(0)}s` : `${(ms / 60_000).toFixed(1)}m`);

export function status() {
  const { sessions } = readIndex();
  console.log(`this project — recorded sessions (.mns/sessions.json): ${sessions.length}`);
  if (!sessions.length) {
    console.log('  none yet — run `mns capture`, or just start your agent (live capture)');
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
