// mns/knowledge/adapter.mjs
// The Knowledge faculty adapter (WS2-T2). Wraps the EXISTING Knowledge pipeline
// (proposals/ER/registry/items/index) behind the faculty-spine adapter contract
// — { name, ingest, validate, apply, render } — without changing any behaviour.
//
//   ingest   — run ER on a candidate, mirroring createProposal's analysis step
//   validate — registry-based validation of an item
//   apply    — IS the extracted approve apply body (applyKnowledgeProposal)
//   render   — the human card the `mns review` gate shows for a knowledge proposal
//
// Registers itself on import.

import { resolve as erResolve } from './er.mjs';
import { loadRegistry, validateItem } from './registry.mjs';
import { allItems, slugify } from './items.mjs';
import { applyKnowledgeProposal } from './proposals.mjs';
import * as registry from '../faculty/registry.mjs';

const name = 'knowledge';

/**
 * Ingest a raw candidate: run ER against existing items and return the
 * normalised payload + analysis. Mirrors what createProposal computes today.
 * @param {string} mnsDir
 * @param {{candidate:object, source?:string, evidence?:object}} raw
 */
function ingest(mnsDir, raw) {
  const { items } = allItems(mnsDir);
  const candidate = { ...raw.candidate };
  candidate.id = candidate.id || slugify(candidate.body);
  const er = erResolve(candidate, items);
  return { payload: candidate, analysis: { er }, dedupeKey: candidate.id };
}

/**
 * Validate an item against the Knowledge registry.
 * @returns {{ok:boolean, errors:string[], warnings:string[]}}
 */
function validate(mnsDir, payload) {
  const reg = loadRegistry(mnsDir);
  const v = validateItem(reg, payload);
  const warnings = [
    ...v.unknownKeys.attributes.map((k) => `unregistered attribute '${k}'`),
    ...v.unknownKeys.relations.map((t) => `unregistered relation type '${t}'`),
  ];
  return { ok: v.ok, errors: v.errors, warnings };
}

/**
 * Apply an approved proposal — delegates to the extracted approve apply body.
 * @returns {{ok:boolean, action:string, itemIds:string[], warnings:string[]}}
 */
function apply(mnsDir, proposal) {
  // Bridge spine-shaped records (payload/analysis.er) onto applyKnowledgeProposal's
  // legacy shape (candidate/er). Records that still carry candidate/er pass through.
  const legacy = {
    ...proposal,
    candidate: proposal.candidate ?? proposal.payload,
    er: proposal.er ?? proposal.analysis?.er,
  };
  const r = applyKnowledgeProposal(mnsDir, legacy);
  return {
    ok: r.ok,
    action: r.action,
    itemIds: r.item ? [r.item] : [],
    warnings: r.warnings ?? [],
  };
}

/**
 * Render a proposal for the human gate. `card` mirrors the multi-line summary
 * `mns review` shows for knowledge proposals (id, type, attrs/relations, ER
 * verdict); `line` is the one-line list form (`mns proposals list`).
 * @returns {{line:string, card:string}}
 */
function render(proposal) {
  if (proposal.kind === 'registry') {
    const what = `register ${String(proposal.registry).slice(0, -1)} '${proposal.key}'`;
    return {
      line: `${proposal.id}  [${proposal.kind}]  ${what}`,
      card: `${what}  (seen ${proposal.evidence?.occurrences}× in candidates)`,
    };
  }
  const c = proposal.candidate ?? {};
  const er = proposal.er ?? {};
  const lines = [];
  lines.push(`${c.id ?? ''} ── ${c.type}: ${c.body?.slice(0, 100).replace(/\n/g, ' ')}`);
  for (const [k, v] of Object.entries(c.attributes ?? {})) lines.push(`  · ${k} = ${v}`);
  for (const r of c.relations ?? []) lines.push(`  → ${r.type} ${r.target}`);
  lines.push(`  er: ${er.verdict}${er.match ? ` → ${er.match}` : ''}  (${(er.confidence ?? 0).toFixed(2)} · ${er.reason ?? ''})`);
  return {
    line: `${proposal.id}  [${er.verdict ?? proposal.kind}]  ${c.type}: ${c.body?.slice(0, 60).replace(/\n/g, ' ')}`,
    card: lines.join('\n'),
  };
}

export const adapter = { name, ingest, validate, apply, render };

registry.register(adapter);
