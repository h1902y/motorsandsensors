// mns/faculty/trail.mjs
// Generalised faculty observability trail (WS2-T1).
// Extends the pattern from mns/actions/trail.mjs to any faculty:
// each faculty gets its own .mns/live/<faculty>.jsonl file.
//
// Fail-soft: a logging failure must never affect the caller.

import { join } from 'node:path';
import { mkdirSync, appendFileSync } from 'node:fs';

/**
 * Append a trail entry for a faculty. Never throws.
 * @param {string} mnsDir  - path to .mns/
 * @param {string} faculty - e.g. 'knowledge', 'actions', 'guardrails'
 * @param {object} entry   - arbitrary fields; `at` is stamped automatically
 */
export function recordTrail(mnsDir, faculty, entry = {}) {
  try {
    const dir = join(mnsDir, 'live');
    mkdirSync(dir, { recursive: true });
    const rec = { at: new Date().toISOString(), ...entry };
    appendFileSync(join(dir, `${faculty}.jsonl`), JSON.stringify(rec) + '\n');
  } catch {
    /* logging must never affect the caller */
  }
}
