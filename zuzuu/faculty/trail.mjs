// zuzuu/faculty/trail.mjs
// Generalised faculty observability trail (WS2-T1).
// Extends the pattern from zuzuu/actions/trail.mjs to any faculty:
// each faculty gets its own .zuzuu/.live/<faculty>.jsonl file.
//
// Fail-soft: a logging failure must never affect the caller.

import { join } from 'node:path';
import { mkdirSync, appendFileSync } from 'node:fs';
import { liveDir } from '../store.mjs';

/**
 * Append a trail entry for a faculty. Never throws.
 * @param {string} agentDir  - path to the faculty home (.zuzuu/)
 * @param {string} faculty - e.g. 'knowledge', 'actions', 'guardrails'
 * @param {object} entry   - arbitrary fields; `at` is stamped automatically
 */
export function recordTrail(agentDir, faculty, entry = {}) {
  try {
    const dir = liveDir(agentDir);
    mkdirSync(dir, { recursive: true });
    const rec = { at: new Date().toISOString(), ...entry };
    appendFileSync(join(dir, `${faculty}.jsonl`), JSON.stringify(rec) + '\n');
  } catch {
    /* logging must never affect the caller */
  }
}
