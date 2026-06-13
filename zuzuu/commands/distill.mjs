// `zuzuu distill` — mine real sessions into proposals (source A).
//
// Default: knowledge only (back-compat, via distillSessions). With
// `--all-modules`: mine each transcript ONCE into a superset, then run every
// module's miner (the Module registry) over the shared
// sessions array. Miner hooks are miner-class: fail-soft + time-boxed — a
// broken or hung miner degrades to 0 proposals, never sinks the others.

import { paths } from '../core/store.mjs';
import { distillSessions, transcriptsFor, mineHostSession } from '../knowledge/distill.mjs';
import * as registry from '../module/registry.mjs';

export async function distill(args) {
  const scope = args.all ? 'all' : args.session ? null : 'last';
  const pairs = transcriptsFor({ scope: scope ?? 'all', session: args.session || null, cwd: process.cwd() });
  if (!pairs.length) {
    console.error('no sessions found to distill (no detected-host transcripts for this project)');
    process.exit(2);
  }
  const agentDir = paths().dir;

  if (args['all-modules'] || args.allModules) {
    const sessions = pairs.map(mineHostSession).filter(Boolean);
    const hosts = new Set(sessions.map((s) => s.host));
    const miners = registry.miners();
    console.log(`distilled ${sessions.length} session(s) across ${hosts.size} host(s) and ${miners.length} module miner(s):`);
    let total = 0;
    for (const miner of miners) {
      const entry = { id: miner.module, module: miner };
      const agg = await registry.invokeTimeboxed(entry, 'aggregate', [sessions, {}]);
      const prop = agg.ok ? await registry.invokeTimeboxed(entry, 'propose', [agentDir, agg.value]) : agg;
      const n = prop.ok && Number.isFinite(prop.value) ? prop.value : 0;
      total += n;
      const note = prop.ok ? '' : '  (miner degraded — see zuzuu doctor)';
      console.log(`  ${miner.module.padEnd(12)} ${n} proposal(s)${note}`);
    }
    if (total) console.log('next: zuzuu review');
    return;
  }

  const r = distillSessions(agentDir, pairs);
  const skips = r.archivedSkips ?? [];
  console.log(`distilled ${r.sessionsMined} session(s) → ${r.proposals.length} proposal(s)${r.registryProposals.length ? ` (+${r.registryProposals.length} registry)` : ''}${skips.length ? ` (${skips.length} archived-skip)` : ''}`);
  for (const p of r.proposals) console.log(`  ${p.er.verdict.padEnd(9)} ${p.id}`);
  // already resolved (rejected/approved) in proposals/archive/ — not re-filed
  for (const p of skips) console.log(`  archived-skip ${p.id} (${p.archived})`);
  if (r.proposals.length) console.log('next: zuzuu review');
}
