// zuzuu/memory/adapter.mjs
// The Memory faculty adapter. Wraps episode proposals behind the
// faculty-spine adapter contract — { name, ingest, validate, apply, render } —
// so `zuzuu review` can surface and approve memory entries uniformly.
//
// A memory proposal payload is an episode record:
//   { id, date, title, provenance: {sessions, hosts}, tags, body }
//   id format: mem-<YYYY-MM-DD>-<slug>
//
// apply: writes .zuzuu/memory/entries/<id>.md as a Faculty Standard envelope
//        (kind: episode; payload = {sessions, hosts, tags}; body = the
//        Attempted / Resulted / Remember-next-time sections).
//
// Registers itself on import.

import * as registry from '../faculty/registry.mjs';
import { writeFacultyItem } from '../faculty/items.mjs';

const name = 'memory';

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
function validate(_agentDir, payload) {
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

  writeFacultyItem(agentDir, {
    id: p.id,
    faculty: name,
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

registry.register(adapter);
