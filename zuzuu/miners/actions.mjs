// zuzuu/miners/actions.mjs
// Actions miner (WS5-T2) — detect recurring Bash 2-gram sequences across
// sessions and scaffold runbook proposals into actions/inbox/<slug>/.
//
// Shape: { faculty:'actions', aggregate(sessions, opts), propose(agentDir, aggregated) }
// Self-registers on import.

import { join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { slugify } from '../knowledge/items.mjs';
import { isSafeSlug, actionsDir, inboxDir } from '../actions/manifest.mjs';
import { register } from './registry.mjs';

// Must match the constant in knowledge/distill.mjs (adjacent Bash separator).
const SEQ_SEP = ' && ';

/**
 * Derive a safe slug from a raw sequence string (bounded, safe chars only).
 * e.g. "npm ci && npm test" → "npm-ci-npm-test" (max 50 chars).
 */
function slugFromSequence(seq) {
  const raw = slugify(seq.replace(/ && /g, ' '), 50);
  // slugify already returns safe chars [a-z0-9-]; isSafeSlug allows upper too,
  // but we keep lower for readability. Force-safe just in case.
  return raw || 'action-sequence';
}

/**
 * Aggregate recurring Bash 2-gram sequences from mined sessions.
 *
 * @param {Array<{sessionId:string, sequences:string[]}>} sessions
 *   The per-session mineTranscript output array.
 * @param {object} opts
 * @param {number} [opts.minSeqCount=3]    min total occurrences across all sessions
 * @param {number} [opts.minSeqSessions=2] min distinct sessions the sequence appears in
 * @returns {Array<{payload:{slug,title,steps,promptSnippet,sequence}, evidence:{occurrences,sessions,sequence}}>}
 */
export function aggregate(sessions, { minSeqCount = 3, minSeqSessions = 2 } = {}) {
  // Count occurrences per sequence string, tracking distinct session ids.
  const stats = new Map(); // rawSeq → { count, sessions: Set<sessionId> }
  for (const s of sessions) {
    if (!Array.isArray(s.sequences)) continue;
    for (const seq of s.sequences) {
      const st = stats.get(seq) ?? { count: 0, sessions: new Set() };
      st.count++;
      st.sessions.add(s.sessionId);
      stats.set(seq, st);
    }
  }

  const candidates = [];
  for (const [seq, st] of stats) {
    if (st.count < minSeqCount || st.sessions.size < minSeqSessions) continue;
    const steps = seq.split(SEQ_SEP);
    const slug = slugFromSequence(seq);
    // Make sure the slug is safe; if not, skip rather than emit a bad slug.
    if (!isSafeSlug(slug)) continue;
    const title = `Run sequence: ${steps.join(' → ')}`;
    const promptSnippet = `Runs: ${steps.join(' then ')}`;
    candidates.push({
      payload: { slug, title, steps, promptSnippet, sequence: seq },
      evidence: { occurrences: st.count, sessions: st.sessions.size, sequence: seq },
    });
  }
  return candidates;
}

/**
 * Write a runbook action proposal into actions/inbox/<slug>/ for each candidate.
 * Idempotent: skips if inbox/<slug>/ OR active actions/<slug>/ already exists.
 *
 * @param {string} agentDir
 * @param {ReturnType<typeof aggregate>} aggregated
 * @returns {number} count of new proposals written
 */
export function propose(agentDir, aggregated) {
  const actDir = actionsDir(agentDir);
  const ibDir = inboxDir(agentDir);
  let count = 0;
  for (const c of aggregated) {
    const { slug, title, steps, promptSnippet } = c.payload;
    const inboxSlug = join(ibDir, slug);
    const activeSlug = join(actDir, slug);
    // Idempotent: skip if already proposed or already active.
    if (existsSync(inboxSlug) || existsSync(activeSlug)) continue;

    mkdirSync(inboxSlug, { recursive: true });

    // action.json — minimal manifest (no run.mjs; this is a runbook action).
    const manifest = {
      slug,
      title,
      description: `Recurring command sequence detected from session traces: ${steps.join(' → ')}.`,
      promptSnippet,
    };
    writeFileSync(join(inboxSlug, 'action.json'), JSON.stringify(manifest, null, 2) + '\n');

    // SKILL.md — numbered runbook steps.
    const stepsBlock = steps.map((cmd, i) => `${i + 1}. \`${cmd}\``).join('\n');
    const skillMd = `---
name: ${title}
description: ${manifest.description}
---

## Steps

${stepsBlock}
`;
    writeFileSync(join(inboxSlug, 'SKILL.md'), skillMd);

    count++;
  }
  return count;
}

export const miner = { faculty: 'actions', aggregate, propose };

register(miner);
