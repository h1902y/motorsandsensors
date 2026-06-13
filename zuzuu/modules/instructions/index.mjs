// zuzuu/modules/instructions/index.mjs — the Instructions module.
//
// Consolidates the adapter (steering-amendment proposals → envelope items),
// the miner (recurring corrective user turns → amendment proposals, WS5-T4)
// and the digest section (the steering text the agent grounds on) behind the
// Module contract.
//
// An instructions proposal payload is a steering amendment:
//   { id?, text }  — a line or paragraph of steering
//
// apply: writes the amendment as a Module Standard envelope item under
//        .zuzuu/instructions/items/<id>.md (kind: amendment; body = the text).
//        The pinned steering itself lives at items/steering.md; future
//        amendments are MORE items, never edits to steering. Idempotent: a
//        text already present in any instructions item is not duplicated.

import { listModuleItems, writeModuleItem } from '../../module/items.mjs';
import { deriveTitle } from '../../module/envelope.mjs';
import { makeProposal, writeProposal, listProposals, isArchivedResolved } from '../../module/proposal.mjs';
import { slugify } from '../../knowledge/items.mjs';

const name = 'instructions';

export const manifest = {
  id: 'instructions',
  title: 'Instructions',
  tagline: 'who to BE — steering and project conventions',
  version: '1.0.0',
  contract: 1,
  kinds: ['steering', 'amendment'],
  itemsDir: 'items',
  schema: 'schema.json',
  hooks: { miner: true, digest: true, eval: false, gate: false },
  ui: { icon: 'compass', accent: 'warning', teaching: 'The pinned steering the agent is told at session start; corrections graduate into amendments here.' },
};

// ---------------------------------------------------------------------------
// adapter contract
// ---------------------------------------------------------------------------

/**
 * Ingest a raw amendment object. Pass-through: the payload IS the amendment.
 */
function ingest(_agentDir, raw) {
  const payload = raw?.payload ?? raw ?? {};
  return { payload, analysis: {} };
}

/**
 * Validate an amendment payload.
 * @returns {{ok:boolean, errors:string[], warnings:string[]}}
 */
export function validate(_agentDir, payload) {
  const errors = [];
  if (!payload?.text || !String(payload.text).trim()) {
    errors.push('text is required (non-empty steering amendment)');
  }
  return { ok: errors.length === 0, errors, warnings: [] };
}

/**
 * Apply an approved amendment: write an amendment item (idempotent on
 * identical text — won't duplicate steering already present in any item).
 * @returns {{ok:boolean, action:string, itemIds:string[]}}
 */
function apply(agentDir, proposal) {
  const text = String(proposal?.payload?.text ?? '').trim();

  // Idempotence: skip if the exact text already lives in an instructions item
  const { items } = listModuleItems(agentDir, 'instructions');
  if (items.some((i) => String(i.body ?? '').includes(text))) {
    return { ok: true, action: 'amended instructions (already present)', itemIds: [] };
  }

  const id = proposal?.payload?.id || slugify(text, 50);
  writeModuleItem(agentDir, {
    id,
    module: name,
    kind: 'amendment',
    title: deriveTitle(text, id),
    status: 'active',
    created_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    provenance: Array.isArray(proposal?.provenance) ? proposal.provenance : [],
    payload: { scope: 'project' },
    body: text,
  });

  return { ok: true, action: 'amended instructions', itemIds: [id] };
}

export const applyProposal = apply;

/**
 * Render an amendment proposal for the human gate.
 * @returns {{line:string, card:string}}
 */
function render(proposal) {
  const text = proposal?.payload?.text ?? '';
  const preview = text.slice(0, 80).replace(/\n/g, ' ');
  return {
    line: `[amendment]  ${preview}`,
    card: text,
  };
}

export const adapter = { name, ingest, validate, apply, render };

// ---------------------------------------------------------------------------
// miner (WS5-T4 — recurring corrective turns → amendment proposals, unchanged)
// ---------------------------------------------------------------------------

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
  // prefixed to make collisions with other modules impossible.
  const slug = normKey.slice(0, 60).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'instr';
  return 'instr-' + slug;
}

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

/**
 * Write an instructions proposal into .zuzuu/instructions/proposals/ for each
 * candidate.
 *
 * Idempotent:
 *   - skips if an instructions proposal with the same derived id already exists
 *   - skips if the text is already present in an instructions item (steering
 *     or a prior amendment)
 *   - skips if the id is already resolved in proposals/archive/ — a rejection
 *     is remembered; re-distilling never resurrects it
 *
 * @param {string} agentDir
 * @param {ReturnType<typeof aggregate>} aggregated
 * @returns {number} count of new proposals written
 */
export function propose(agentDir, aggregated) {
  // Collect ids of existing pending proposals for this module.
  const existing = listProposals(agentDir, 'instructions');
  const existingIds = new Set(existing.map((p) => p.payload?.id).filter(Boolean));

  // Read the instructions items (steering + amendments) to skip applied text.
  let appliedText = '';
  try {
    appliedText = listModuleItems(agentDir, 'instructions').items.map((i) => i.body ?? '').join('\n');
  } catch { appliedText = ''; }

  let count = 0;
  for (const c of aggregated) {
    const { payload, evidence } = c;

    // Idempotent: skip if already proposed.
    if (existingIds.has(payload.id)) continue;

    // Idempotent: skip if text already present in an instructions item.
    if (appliedText.includes(payload.text)) continue;

    const proposal = makeProposal({
      module: 'instructions',
      kind: 'block',
      source: 'distill',
      payload,
      evidence,
    });

    // A rejection is remembered: never resurrect an archive-resolved id.
    if (isArchivedResolved(agentDir, 'instructions', proposal.id)) continue;

    writeProposal(agentDir, proposal);
    count++;
  }

  return count;
}

export const miner = { module: name, aggregate, propose };

// ---------------------------------------------------------------------------
// digest section (moved from the pre-module digest, byte-identical output)
// ---------------------------------------------------------------------------

const PLACEHOLDER_MARK = '<!-- Fill in:';

const INTERVIEW = [
  'Project steering is empty. Before substantive work, interview your human',
  '(what is this project, its conventions, its priorities), draft the steering item',
  '.zuzuu/instructions/items/steering.md from their answers, and get their approval.',
].join(' ');

/** Read the instructions items (steering first, then amendments); classify
 *  empty vs steering text. Items are Module Standard envelopes (W24). */
function readInstructions(agentDir) {
  let items = [];
  try {
    items = listModuleItems(agentDir, 'instructions').items;
  } catch { /* missing or unreadable → treat as empty */ }
  // steering pins the top; amendments follow in id order (already sorted)
  items.sort((a, b) => (a.kind === 'steering' ? -1 : 1) - (b.kind === 'steering' ? -1 : 1));
  const bodies = items
    .map((i) => String(i.body ?? ''))
    .map((raw) => (raw.includes(PLACEHOLDER_MARK) ? '' : raw.replace(/^#.*$/gm, '').trim() && raw.trim()))
    .filter(Boolean);
  const text = bodies.join('\n\n');
  return { empty: !text, text };
}

/**
 * The Instructions digest section: the pinned steering (or the interview
 * prompt when empty). Always renders — grounding starts here.
 * @param {string} agentDir
 * @returns {{lines: string[], data: object}}
 */
export function digestSection(agentDir) {
  const instr = readInstructions(agentDir);
  return { lines: ['## Instructions', instr.empty ? INTERVIEW : instr.text], data: instr };
}

// ---------------------------------------------------------------------------
// session signals (the observability surface — `zuzuu session inspect`)
// ---------------------------------------------------------------------------

/** Counts of the mined-signal superset slices this module grows from. */
export function sessionSignals(signals = {}) {
  return { correctionTurns: signals.correctionTurns?.length ?? 0 };
}
