// zuzuu/actions/trail.mjs
// The actions observability trail (A7): every `zuzuu act` run appends an outcome
// record to .zuzuu/.live/actions.jsonl. This is the "details" side of the result —
// the agent sees the marker value; the trace keeps the metadata. Fail-soft: a
// logging failure must never affect the action (mirrors the guardrails decision log).

import { join } from 'node:path';
import { mkdirSync, appendFileSync } from 'node:fs';
import { liveDir } from '../store.mjs';

/** Append a fail-soft outcome record. Never throws. */
export function recordOutcome(agentDir, { slug, ok, error } = {}) {
  try {
    const dir = liveDir(agentDir);
    mkdirSync(dir, { recursive: true });
    const rec = { at: new Date().toISOString(), slug, ok: !!ok };
    if (error) rec.error = error;
    appendFileSync(join(dir, 'actions.jsonl'), JSON.stringify(rec) + '\n');
  } catch {
    /* logging must never affect the action */
  }
}
