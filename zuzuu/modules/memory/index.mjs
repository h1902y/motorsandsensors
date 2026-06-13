// zuzuu/modules/memory/index.mjs — the Memory module.
//
// Consolidates the adapter (episode proposals → envelope entries) and the
// miner STUB (WS5-T4, deferred — see the WHAT IT WOULD MINE note below) behind
// the Module contract. No digest section today (the pre-module digest
// never rendered one — preserved).
//
// A memory proposal payload is an episode record:
//   { id, date, title, provenance: {sessions, hosts}, tags, body }
//   id format: mem-<YYYY-MM-DD>-<slug>
//
// apply: writes .zuzuu/memory/entries/<id>.md as a Module Standard envelope
//        (kind: episode; payload = {sessions, hosts, tags}; body = the
//        Attempted / Resulted / Remember-next-time sections).
//
// MINER (when implemented): completed-session episodes — a Run that reached
// `completed` in .zuzuu/sessions.json distilled into curated entries, emitted
// as kind-'episode' proposals for `zuzuu review`. Deferred until the Memory
// substrate decision lands and completed runs carry rich enough trace data.

import { writeModuleItem } from '../../module/items.mjs';

const name = 'memory';

export const manifest = {
  id: 'memory',
  title: 'Memory',
  tagline: 'what HAPPENED — curated episodes from past sessions',
  version: '1.0.0',
  contract: 1,
  kinds: ['episode'],
  itemsDir: 'entries',
  schema: 'schema.json',
  hooks: { miner: true, digest: false, eval: false, gate: false },
  ui: { icon: 'clock', accent: 'neutral', teaching: 'Curated episodes from past sessions — what was attempted, what resulted, what to remember.' },
};

// mem-<YYYY-MM-DD>-<slug>: the id must START with "mem-"
const MEM_ID_RE = /^mem-/;

// ---------------------------------------------------------------------------
// adapter contract
// ---------------------------------------------------------------------------

/**
 * Ingest a raw episode. Pass-through: the payload IS the episode.
 */
function ingest(_agentDir, raw) {
  const payload = raw?.payload ?? raw ?? {};
  return { payload, analysis: {}, dedupeKey: payload.id };
}

/**
 * Validate an episode payload.
 * @returns {{ok:boolean, errors:string[], warnings:string[]}}
 */
export function validate(_agentDir, payload) {
  const errors = [];
  if (!payload?.id || typeof payload.id !== 'string') {
    errors.push('id is required');
  } else if (!MEM_ID_RE.test(payload.id)) {
    errors.push(`id must match mem-<YYYY-MM-DD>-<slug> format (got '${payload.id}')`);
  }
  if (!payload?.title || !String(payload.title).trim()) {
    errors.push('title is required');
  }
  return { ok: errors.length === 0, errors, warnings: [] };
}

/**
 * Apply an approved episode proposal: write the envelope entry file.
 * @returns {{ok:boolean, action:string, itemIds:string[]}}
 */
function apply(agentDir, proposal) {
  const p = proposal?.payload ?? {};
  const envPayload = {};
  if (Array.isArray(p.provenance?.sessions) && p.provenance.sessions.length) envPayload.sessions = p.provenance.sessions.map(String);
  if (Array.isArray(p.provenance?.hosts) && p.provenance.hosts.length) envPayload.hosts = p.provenance.hosts.map(String);
  if (Array.isArray(p.tags) && p.tags.length) envPayload.tags = p.tags.map(String);

  writeModuleItem(agentDir, {
    id: p.id,
    module: name,
    kind: 'episode',
    title: p.title,
    status: 'active',
    created_at: p.date || new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    provenance: Array.isArray(proposal?.provenance) ? proposal.provenance : [],
    payload: envPayload,
    body: p.body ?? '',
  });

  return { ok: true, action: `wrote memory ${p.id}`, itemIds: [p.id] };
}

export const applyProposal = apply;

/**
 * Render an episode proposal for the human gate.
 * @returns {{line:string, card:string}}
 */
function render(proposal) {
  const p = proposal?.payload ?? {};
  const title = p.title ?? '';
  const date = p.date ?? '';
  const id = p.id ?? '';
  return {
    line: `${id}  [episode]  ${title} (${date})`,
    card: `${title}\n  id: ${id}  date: ${date}`,
  };
}

export const adapter = { name, ingest, validate, apply, render };

// ---------------------------------------------------------------------------
// miner (registered no-op stub — deferred)
// ---------------------------------------------------------------------------

export const miner = {
  module: name,
  stub: true,
  aggregate: () => [],
  propose: () => 0,
};
