// mns/commands/digest.mjs
// `mns digest [--json] [--budget N]` — print the grounding brief a session
// start would inject. Lets a human (or a hookless host) see exactly what the
// agent sees.

import { paths } from '../store.mjs';
import { computeDigest } from '../digest.mjs';

export function digest(args) {
  const mnsDir = paths().dir;
  const opts = {};
  // guard `--budget` with no value (parseArgs → true → Number(true)===1 → near-empty digest)
  if (args.budget && args.budget !== true) opts.budget = Number(args.budget);
  const d = computeDigest(mnsDir, opts);
  if (args.json) console.log(JSON.stringify(d, null, 2));
  else process.stdout.write(d.text);
}
