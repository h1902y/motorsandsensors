// `mns distill` — mine real sessions into proposals (source A).
//
// Default: knowledge only (back-compat, via distillSessions). With
// `--all-faculties`: mine each transcript ONCE into a superset, then run every
// registered faculty miner (knowledge today; actions/guardrails/instructions/
// memory land in later WS5 tasks) over the shared sessions array.

import { paths } from '../store.mjs';
import { distillSessions, transcriptsFor, mineHostSession } from '../knowledge/distill.mjs';
import * as registry from '../miners/registry.mjs';
// Import miner modules so they self-register.
import '../miners/knowledge.mjs';
import '../miners/actions.mjs';
import '../miners/guardrails.mjs';
import '../miners/instructions.mjs';
import '../miners/memory.mjs';

export function distill(args) {
  const scope = args.all ? 'all' : args.session ? null : 'last';
  const pairs = transcriptsFor({ scope: scope ?? 'all', session: args.session || null, cwd: process.cwd() });
  if (!pairs.length) {
    console.error('no sessions found to distill (no detected-host transcripts for this project)');
    process.exit(2);
  }
  const mnsDir = paths().dir;

  if (args['all-faculties'] || args.allFaculties) {
    const sessions = pairs.map(mineHostSession).filter(Boolean);
    const hosts = new Set(sessions.map((s) => s.host));
    console.log(`distilled ${sessions.length} session(s) across ${hosts.size} host(s) and ${registry.all().length} faculty miner(s):`);
    let total = 0;
    for (const miner of registry.all()) {
      const cand = miner.aggregate(sessions, {});
      const n = miner.propose(mnsDir, cand);
      total += n;
      console.log(`  ${miner.faculty.padEnd(12)} ${n} proposal(s)`);
    }
    if (total) console.log('next: zuzuu review');
    return;
  }

  const r = distillSessions(mnsDir, pairs);
  console.log(`distilled ${r.sessionsMined} session(s) → ${r.proposals.length} proposal(s)${r.registryProposals.length ? ` (+${r.registryProposals.length} registry)` : ''}`);
  for (const p of r.proposals) console.log(`  ${p.er.verdict.padEnd(9)} ${p.id}`);
  if (r.proposals.length) console.log('next: zuzuu review');
}
