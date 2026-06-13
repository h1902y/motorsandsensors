// zuzuu/module/trail.mjs
// Generalised module observability trail (WS2-T1).
// Extends the pattern from zuzuu/actions/trail.mjs to any module:
// each module gets its own .zuzuu/.live/<module>.jsonl file.
//
// Fail-soft: a logging failure must never affect the caller.

import { join } from 'node:path';
import { mkdirSync, appendFileSync } from 'node:fs';
import { liveDir } from '../core/store.mjs';

/**
 * Append a trail entry for a module. Never throws.
 * @param {string} agentDir  - path to the module home (.zuzuu/)
 * @param {string} module - e.g. 'knowledge', 'actions', 'guardrails'
 * @param {object} entry   - arbitrary fields; `at` is stamped automatically
 */
export function recordTrail(agentDir, module, entry = {}) {
  try {
    const dir = liveDir(agentDir);
    mkdirSync(dir, { recursive: true });
    const rec = { at: new Date().toISOString(), ...entry };
    appendFileSync(join(dir, `${module}.jsonl`), JSON.stringify(rec) + '\n');
  } catch {
    /* logging must never affect the caller */
  }
}
