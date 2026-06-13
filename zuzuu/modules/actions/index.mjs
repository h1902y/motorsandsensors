// zuzuu/modules/actions/index.mjs — the Actions module.
//
// Consolidates the adapter (the inbox gate over dir-shaped proposals, WS2-T3),
// the miner (recurring Bash 2-gram sequences → runbook proposals, WS5-T2) and
// the digest section behind the Module contract. Substrate code stays
// in zuzuu/actions/ — this module is the contract face.
//
// Actions payloads are DIRECTORIES (ACTION.md + sibling scripts), not JSON.
// Strategy (lowest-risk): the inbox stays a dir; this adapter emits/reads a
// spine-shaped proposal RECORD that REFERENCES the dir
// (payload = { slug, kind, dir:'inbox/<slug>' }). The gate resolves a single
// record via `getProposal`, lists pending via `listProposals`, and — because
// the payload is dir-shaped — archives rejections via `rejectDir` (a dir move
// into actions/proposals/archive/, not a JSON archive).

import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { listActions, allActions, inboxDir, actionsDir, isSafeSlug } from '../../actions/manifest.mjs';
import { activateAction, rejectAction } from '../../actions/inbox.mjs';
import { parseEnvelope, validateEnvelope, serializeEnvelope, PAYLOAD_SCHEMAS } from '../../module/envelope.mjs';
import { slugify } from '../../knowledge/items.mjs';

const name = 'actions';

export const manifest = {
  id: 'actions',
  title: 'Actions',
  tagline: 'how to DO things — runbooks + runnable scripts',
  version: '1.0.0',
  contract: 1,
  kinds: ['runbook', 'script'],
  itemsDir: '.',
  schema: 'schema.json',
  hooks: { miner: true, digest: true, eval: false, gate: false },
  ui: { icon: 'play', accent: 'success', teaching: 'Reusable runbooks and scripts, mined from how you actually work and approved by you.' },
};

// ---------------------------------------------------------------------------
// adapter contract
// ---------------------------------------------------------------------------

/** Build a spine-shaped proposal record for one proposed action. */
function recordFor(a) {
  return {
    id: a.slug,
    module: name,
    kind: 'action',
    status: 'pending',
    source: 'agent',
    payload: { slug: a.slug, kind: a.kind, dir: `inbox/${a.slug}` },
    // carry render hints alongside the payload (cheap, dir read already done)
    title: a.title,
    promptSnippet: a.promptSnippet,
    analysis: {},
    evidence: {},
    provenance: [],
  };
}

/**
 * Pending action proposals (dirs in .zuzuu/actions/inbox/), surfaced as
 * spine-shaped records so the gate can render/approve/reject them uniformly.
 */
function listProposals(agentDir) {
  return listActions(inboxDir(agentDir)).map(recordFor);
}

/** Resolve a single proposed action by slug → spine-shaped record, or null. */
function getProposal(agentDir, slug) {
  if (!isSafeSlug(slug)) return null;
  return listProposals(agentDir).find((p) => p.id === slug) ?? null;
}

/**
 * Ingest is a pass-through for Actions: proposing scaffolds a dir
 * (zuzuu act propose / act-author). Kept for adapter-contract symmetry.
 */
function ingest(_agentDir, raw) {
  return { payload: raw?.payload ?? raw ?? {}, analysis: {} };
}

/**
 * Validate a proposed action's ACTION.md envelope (id matches the dir; the
 * payload validates against the actions schema). Missing ACTION.md → accept
 * (slug fallback, mirrors the historical missing-manifest tolerance).
 * @returns {{ok:boolean, errors:string[], warnings:string[]}}
 */
export function validate(agentDir, payload) {
  const slug = payload?.slug;
  if (!isSafeSlug(slug)) return { ok: false, errors: [`invalid slug '${slug}'`], warnings: [] };
  const manPath = join(inboxDir(agentDir), slug, 'ACTION.md');
  if (!existsSync(manPath)) return { ok: true, errors: [], warnings: [] };
  const { ok, item, errors: parseErrors } = parseEnvelope(readFileSync(manPath, 'utf8'));
  if (!ok) return { ok: false, errors: [`ACTION.md is not a valid envelope: ${parseErrors[0]}`], warnings: [] };
  if (item.id && item.id !== slug) return { ok: false, errors: [`ACTION.md id '${item.id}' ≠ dir '${slug}'`], warnings: [] };
  if (item.module !== 'actions') return { ok: false, errors: [`ACTION.md module must be 'actions' (got '${item.module}')`], warnings: [] };
  const v = validateEnvelope(item, PAYLOAD_SCHEMAS.actions);
  return { ok: v.ok, errors: v.errors, warnings: [] };
}

/**
 * Apply an approved action proposal: activate it (move inbox/<slug> → <slug>).
 * Preserves the "already exists" guard from activateAction.
 * @returns {{ok:boolean, action:string, itemIds:string[], warnings:string[]}}
 */
function apply(agentDir, proposal) {
  const slug = proposal?.payload?.slug ?? proposal?.id;
  const r = activateAction(agentDir, slug);
  if (!r.ok) return { ok: false, action: r.error, itemIds: [], warnings: [] };
  return { ok: true, action: `activated ${slug}`, itemIds: [slug], warnings: [] };
}

export const applyProposal = apply;

/**
 * Reject path: dir-shaped, so the gate calls this instead of the JSON archive.
 * Moves inbox/<slug> → actions/proposals/archive/<slug> (archive, not delete).
 */
function rejectDir(agentDir, slug, _reason = '') {
  return rejectAction(agentDir, slug);
}

/**
 * Render a proposed action for the human gate. `card` mirrors the current review
 * card (slug ── kind, then the prompt snippet); `line` is the one-line list form.
 * @returns {{line:string, card:string}}
 */
function render(proposal) {
  const slug = proposal?.id ?? proposal?.payload?.slug ?? '';
  const kind = proposal?.payload?.kind ?? proposal?.kind ?? 'action';
  const snippet = proposal?.promptSnippet ?? '';
  return {
    line: `${slug}  [${kind}]  ${snippet}`,
    card: `${slug} ── ${kind}\n  ${snippet}`,
  };
}

export const adapter = { name, ingest, validate, apply, render, listProposals, getProposal, rejectDir };

// ---------------------------------------------------------------------------
// miner (WS5-T2 — recurring Bash 2-grams → runbook proposals, unchanged)
// ---------------------------------------------------------------------------

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

    // ACTION.md — a runbook envelope (no run.mjs; the body IS the procedure).
    // The body's first line is the digest one-liner (promptSnippet).
    const stepsBlock = steps.map((cmd, i) => `${i + 1}. \`${cmd}\``).join('\n');
    writeFileSync(join(inboxSlug, 'ACTION.md'), serializeEnvelope({
      id: slug,
      module: 'actions',
      kind: 'runbook',
      title,
      status: 'active',
      created_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
      provenance: [],
      payload: {},
      body: `${promptSnippet}\n\nRecurring command sequence detected from session traces.\n\n## Steps\n\n${stepsBlock}`,
    }));

    count++;
  }
  return count;
}

export const miner = { module: name, aggregate, propose };

// ---------------------------------------------------------------------------
// digest section (moved from the pre-module digest, byte-identical output)
// ---------------------------------------------------------------------------

/**
 * The Actions digest section: available actions under the shared char budget.
 * Renders NOTHING when no actions exist (preserved pre-module behaviour).
 * @param {string} agentDir
 * @param {{limit:number, charBudget:number, priorLines:string[]}} ctx
 * @returns {{lines: string[], data: object}}
 */
export function digestSection(agentDir, { limit, charBudget, priorLines }) {
  let actions;
  try {
    const list = allActions(agentDir);
    actions = { count: list.length, shown: list.slice(0, limit).map((a) => ({ slug: a.slug, kind: a.kind, promptSnippet: a.promptSnippet })) };
  } catch {
    actions = { count: 0, shown: [] };
  }
  if (!actions.count) return { lines: [], data: { ...actions, renderedCount: 0 } };
  const lines = ['## Actions'];
  lines.push(`${actions.count} available; run with \`zuzuu act <slug>\`:`);
  let shownA = 0;
  for (const a of actions.shown) {
    const line = `- ${a.slug} · ${a.promptSnippet}`;
    if ([...priorLines, ...lines].join('\n').length + line.length > charBudget && shownA > 0) break;
    lines.push(line);
    shownA++;
  }
  const droppedA = actions.count - shownA;
  if (droppedA > 0) lines.push(`- … (${droppedA} more — \`zuzuu act list\`)`);
  // mirror the Knowledge contract: shown reflects what actually rendered
  return { lines, data: { ...actions, shown: actions.shown.slice(0, shownA), renderedCount: shownA } };
}

// ---------------------------------------------------------------------------
// session signals (the observability surface — `zuzuu session inspect`)
// ---------------------------------------------------------------------------

/** Counts of the mined-signal superset slices this module grows from. */
export function sessionSignals(signals = {}) {
  return { sequences: signals.sequences?.length ?? 0 };
}
