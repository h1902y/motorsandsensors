// `mns trace [--last | <file>]` — print the span tree of a captured trace.

import { existsSync } from 'node:fs';
import { loadSpans, renderTree } from '../../experiments/experiment-1-trace-capture/core/render.mjs';
import { lastTrace } from '../store.mjs';

export function trace(args) {
  let file = args._[0];
  if (args.last || !file) file = lastTrace();
  if (!file) {
    console.error('no trace found — run `zuzuu capture` first, or pass a file path');
    process.exit(1);
  }
  if (!existsSync(file)) {
    console.error(`no such trace file: ${file}`);
    process.exit(1);
  }
  console.log(renderTree(loadSpans(file)));
}
