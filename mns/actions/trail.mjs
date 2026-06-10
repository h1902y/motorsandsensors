// mns/actions/trail.mjs
// The actions observability trail (A7): every `mns act` run appends an outcome
// record to .mns/live/actions.jsonl. This is the "details" side of the result —
// the agent sees the marker value; the trace keeps the metadata. Fail-soft: a
// logging failure must never affect the action (mirrors the guardrails decision log).

import { join } from 'node:path';
import { mkdirSync, appendFileSync } from 'node:fs';

/** Append a fail-soft outcome record. Never throws. */
export function recordOutcome(mnsDir, { slug, ok, error } = {}) {
  try {
    const dir = join(mnsDir, 'live');
    mkdirSync(dir, { recursive: true });
    const rec = { at: new Date().toISOString(), slug, ok: !!ok };
    if (error) rec.error = error;
    appendFileSync(join(dir, 'actions.jsonl'), JSON.stringify(rec) + '\n');
  } catch {
    /* logging must never affect the action */
  }
}
