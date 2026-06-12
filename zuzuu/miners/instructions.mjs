// zuzuu/miners/instructions.mjs
// Instructions miner (WS5-T4) — detect recurring corrective user turns across
// sessions and propose steering-amendment blocks for the Instructions faculty.
//
// Corrective turns are captured by mineTranscript as:
//   correctionTurns: [{ text }]  — user turns following an assistant tool action
//   that contain corrective lexicon (e.g. "always", "never", "don't", etc.)
//
// Shape: { faculty:'instructions', aggregate(sessions, opts), propose(agentDir, aggregated) }
// Self-registers on import.

import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { makeProposal, writeProposal, listProposals } from '../faculty/proposal.mjs';
import { register } from './registry.mjs';

// ---------------------------------------------------------------------------
// helpers

/**
 * Normalise a correction text for grouping:
 * lowercase, collapse whitespace, truncate to 200 chars.
 *
 * v1 grouping: near-identical normalised text (exact key match). Simple and
 * deterministic; a fuzzy grouper can be earned later.
 *
 * @param {string} text
 * @returns {string}
 */
function normText(text) {
  return String(text).toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200);
}

/**
 * Derive a proposal id fragment from a normalised text key.
 * Keep it stable, short, and filesystem-safe.
 */
function instrId(normKey) {
  // Use a slugified version of the first 60 chars of the normalised text,
  // prefixed to make collisions with other faculties impossible.
  const slug = normKey.slice(0, 60).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'instr';
  return 'instr-' + slug;
}

// ---------------------------------------------------------------------------
// aggregate

/**
 * Group correctionTurns from mined sessions; propose when a similar correction
 * recurs across ≥minSessions (default 2) distinct sessions.
 *
 * @param {Array<{sessionId:string, correctionTurns:{text:string}[]}>} sessions
 * @param {object} opts
 * @param {number} [opts.minSessions=2] min distinct sessions with the same normalised correction
 * @returns {Array<{payload:{text:string}, evidence:{occurrences:number, sessions:number}}>}
 */
export function aggregate(sessions, { minSessions = 2 } = {}) {
  // normalised text → { count, sessions: Set<sessionId>, rawText: string }
  const stats = new Map();

  for (const s of sessions) {
    if (!Array.isArray(s.correctionTurns)) continue;
    // Track distinct normalised texts per session to avoid double-counting
    // the same session for the same correction text.
    const seenInSession = new Set();
    for (const { text } of s.correctionTurns) {
      const key = normText(text);
      if (!key) continue;
      const st = stats.get(key) ?? { count: 0, sessions: new Set(), rawText: text };
      st.count++;
      st.sessions.add(s.sessionId);
      seenInSession.add(key);
      stats.set(key, st);
    }
  }

  const candidates = [];
  for (const [, st] of stats) {
    if (st.sessions.size < minSessions) continue;

    // Phrase the raw correction as an instruction for the steering amendment.
    // The corrective turn text already reads like user guidance; use it directly
    // (trimmed to 500 chars to match mineTranscript's cap).
    const amendmentText = st.rawText.slice(0, 500).trim();
    const id = instrId(normText(amendmentText));

    candidates.push({
      payload: { id, text: amendmentText },
      evidence: { occurrences: st.count, sessions: st.sessions.size },
    });
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// propose

/**
 * Write an instructions proposal into .zuzuu/instructions/proposals/ for each
 * candidate.
 *
 * Idempotent:
 *   - skips if an instructions proposal with the same derived id already exists
 *   - skips if the text is already present in project.md
 *
 * @param {string} agentDir
 * @param {ReturnType<typeof aggregate>} aggregated
 * @returns {number} count of new proposals written
 */
export function propose(agentDir, aggregated) {
  // Collect ids of existing pending proposals for this faculty.
  const existing = listProposals(agentDir, 'instructions');
  const existingIds = new Set(existing.map((p) => p.payload?.id).filter(Boolean));

  // Read project.md to skip amendments already applied.
  const projectMdPath = join(agentDir, 'instructions', 'project.md');
  const projectMdContent = existsSync(projectMdPath)
    ? readFileSync(projectMdPath, 'utf8')
    : '';

  let count = 0;
  for (const c of aggregated) {
    const { payload, evidence } = c;

    // Idempotent: skip if already proposed.
    if (existingIds.has(payload.id)) continue;

    // Idempotent: skip if text already present in project.md.
    if (projectMdContent.includes(payload.text)) continue;

    const proposal = makeProposal({
      faculty: 'instructions',
      kind: 'block',
      source: 'distill',
      payload,
      evidence,
    });

    writeProposal(agentDir, proposal);
    count++;
  }

  return count;
}

// ---------------------------------------------------------------------------
// self-register

export const miner = { faculty: 'instructions', aggregate, propose };

register(miner);
