// `mns distill` — mine real sessions into knowledge proposals (source A).

import { paths } from '../store.mjs';
import { distillSessions, transcriptsFor } from '../knowledge/distill.mjs';

export function distill(args) {
  const scope = args.all ? 'all' : args.session ? null : 'last';
  const files = transcriptsFor({ scope: scope ?? 'all', session: args.session || null, cwd: process.cwd() });
  if (!files.length) {
    console.error('no sessions found to distill (claude-code transcripts for this project)');
    process.exit(2);
  }
  const mnsDir = paths().dir;
  const r = distillSessions(mnsDir, files);
  console.log(`distilled ${r.sessionsMined} session(s) → ${r.proposals.length} proposal(s)${r.registryProposals.length ? ` (+${r.registryProposals.length} registry)` : ''}`);
  for (const p of r.proposals) console.log(`  ${p.er.verdict.padEnd(9)} ${p.id}`);
  if (r.proposals.length) console.log('next: mns review');
}
