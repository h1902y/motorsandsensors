// zuzuu/guardrails/adapter.mjs
// The Guardrails faculty adapter. Wraps the rules engine behind the
// faculty-spine adapter contract — { name, ingest, validate, apply, render } —
// so `zuzuu review` can surface and approve/reject rule proposals the same way it
// does Knowledge proposals.
//
// A guardrails proposal payload is a single rule record:
//   { id, action: deny|ask|allow, tool, pattern, reason, body? }
//
// apply: writes the rule as a Faculty Standard envelope item at
//        .zuzuu/guardrails/items/<id>.md (upsert — same id replaces the file).
//
// Registers itself on import.

import * as registry from '../faculty/registry.mjs';
import { writeFacultyItem } from '../faculty/items.mjs';
import { deriveTitle } from '../faculty/envelope.mjs';

const name = 'guardrails';
const VALID_ACTIONS = new Set(['deny', 'ask', 'allow']);

// ---------------------------------------------------------------------------
// adapter contract
// ---------------------------------------------------------------------------

/**
 * Ingest a raw rule object. Pass-through: rule fields are the payload.
 * @param {string} agentDir
 * @param {object} raw  — expected shape: { id, action, tool, pattern, reason }
 *                         or { payload: { ... } } from the spine
 */
function ingest(_agentDir, raw) {
  const payload = raw?.payload ?? raw ?? {};
  return { payload, analysis: {}, dedupeKey: payload.id };
}

/**
 * Validate a rule payload.
 * @returns {{ok:boolean, errors:string[], warnings:string[]}}
 */
function validate(_agentDir, payload) {
  const errors = [];
  if (!payload?.id || typeof payload.id !== 'string' || !payload.id.trim()) {
    errors.push('rule id is required (non-empty string slug)');
  }
  if (!VALID_ACTIONS.has(payload?.action)) {
    errors.push(`action must be one of deny|ask|allow (got '${payload?.action}')`);
  }
  if (!payload?.tool || typeof payload.tool !== 'string') {
    errors.push('tool is required (exact tool name or \'*\')');
  }
  if (typeof payload?.pattern !== 'string' || !payload.pattern) {
    errors.push('pattern is required (a non-empty regex string)');
  } else {
    try {
      new RegExp(payload.pattern); // eslint-disable-line no-new
    } catch (e) {
      errors.push(`pattern does not compile as a RegExp: ${e.message}`);
    }
  }
  if (!payload?.reason || !String(payload.reason).trim()) {
    errors.push('reason is required (non-empty)');
  }
  return { ok: errors.length === 0, errors, warnings: [] };
}

/**
 * Apply an approved rule proposal: write the envelope item (upsert by id).
 * @returns {{ok:boolean, action:string, itemIds:string[]}}
 */
function apply(agentDir, proposal) {
  const rule = proposal?.payload ?? {};
  const id = rule.id;
  writeFacultyItem(agentDir, {
    id,
    faculty: name,
    kind: 'rule',
    title: deriveTitle(rule.reason, id),
    status: 'active',
    created_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    provenance: Array.isArray(proposal?.provenance) ? proposal.provenance : [],
    payload: { action: rule.action, tool: rule.tool || '*', pattern: rule.pattern, reason: rule.reason },
    body: rule.body ?? '',
  });
  return { ok: true, action: `added rule ${id}`, itemIds: [id] };
}

/**
 * Render a rule proposal for the human gate.
 * @returns {{line:string, card:string}}
 */
function render(proposal) {
  const r = proposal?.payload ?? {};
  const summary = `${r.action ?? '?'} ${r.tool ?? '*'} /${r.pattern ?? ''}/ — ${r.reason ?? ''}`;
  return {
    line: `${r.id ?? ''}  [rule]  ${summary}`,
    card: summary,
  };
}

export const adapter = { name, ingest, validate, apply, render };

registry.register(adapter);
