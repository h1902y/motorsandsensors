// zuzuu/instructions/adapter.mjs
// The Instructions faculty adapter. Wraps steering-amendment proposals
// behind the faculty-spine adapter contract — { name, ingest, validate, apply,
// render } — so `zuzuu review` can surface and approve them uniformly.
//
// An instructions proposal payload is a steering amendment:
//   { id?, text }  — a line or paragraph of steering
//
// apply: writes the amendment as a Faculty Standard envelope item under
//        .zuzuu/instructions/items/<id>.md (kind: amendment; body = the text).
//        The pinned steering itself lives at items/steering.md; future
//        amendments are MORE items, never edits to steering. Idempotent: a
//        text already present in any instructions item is not duplicated.
//
// Registers itself on import.

import * as registry from '../faculty/registry.mjs';
import { listFacultyItems, writeFacultyItem } from '../faculty/items.mjs';
import { deriveTitle } from '../faculty/envelope.mjs';
import { slugify } from '../knowledge/items.mjs';

const name = 'instructions';

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
function validate(_agentDir, payload) {
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
  const { items } = listFacultyItems(agentDir, 'instructions');
  if (items.some((i) => String(i.body ?? '').includes(text))) {
    return { ok: true, action: 'amended instructions (already present)', itemIds: [] };
  }

  const id = proposal?.payload?.id || slugify(text, 50);
  writeFacultyItem(agentDir, {
    id,
    faculty: name,
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

registry.register(adapter);
