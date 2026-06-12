// `mns capture` — post-hoc: parse a host transcript into a git-native trace + record.

import { ADAPTERS, byName, detected } from '../../experiments/experiment-1-trace-capture/adapters/registry.mjs';
import { captureTrace } from '../capture-core.mjs';
import { paths } from '../store.mjs';

function chooseRef(adapter, args) {
  if (args.file) return args.file;
  const sessions = adapter.listSessions({ cwd: process.cwd(), project: args.project });
  let pool = sessions;
  if (args.session) pool = pool.filter((s) => s.sessionId === args.session || s.sessionId.includes(args.session));
  if (!pool.length) throw new Error(`no matching session for ${adapter.name} (found ${sessions.length})`);
  return pool[0].ref;
}

export function capture(args) {
  const adapter = args.host ? byName(args.host) : detected()[0];
  if (!adapter) {
    console.error(args.host ? `unknown host: ${args.host} (known: ${ADAPTERS.map((a) => a.name).join(', ')})` : 'no host detected — run `zuzuu status`');
    process.exit(1);
  }

  const { record, spans, traceRef, counts } = captureTrace({ adapter, ref: chooseRef(adapter, args) });
  const { index } = paths();
  console.log(`captured ${record.host} session ${record.id}`);
  console.log(`  status   : ${record.status}`);
  console.log(`  spans    : ${spans.length}  (turns:${counts.turns}, tools:${counts.tools}, errors:${counts.errors})`);
  console.log(`  git      : ${record.git.commit ? record.git.commit.slice(0, 8) : '(no repo)'} ${record.git.branch || ''}`);
  console.log(`  trace    : ${traceRef}  (git-ignored)`);
  console.log(`  indexed  : ${index}  (tracked)`);
  console.log(`  inspect  : zuzuu trace --last`);
}
