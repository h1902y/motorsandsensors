// zuzuu/commands/digest.mjs
// `zuzuu digest [--json] [--budget N]` — print the grounding brief a session
// start would inject. Lets a human (or a hookless host) see exactly what the
// agent sees.

import { paths } from '../store.mjs';
import { computeDigest } from '../digest.mjs';

/** Pure: the digest payload — the zuzuu-web /digest source (the daemon also reads .zuzuu/.live/digest.md directly). */
export function digestData(agentDir, opts = {}) {
  const d = computeDigest(agentDir, opts);
  return { text: d.text ?? '' };
}

export function digest(args) {
  const agentDir = paths().dir;
  const opts = {};
  // guard `--budget` with no value (parseArgs → true → Number(true)===1 → near-empty digest)
  if (args.budget && args.budget !== true) opts.budget = Number(args.budget);
  const d = computeDigest(agentDir, opts);
  if (args.json) console.log(JSON.stringify(d, null, 2));
  else process.stdout.write(d.text);
}
