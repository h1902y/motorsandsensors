// zuzuu/modules/knowledge/index.mjs — the Knowledge module.
//
// Consolidates the module's spine surface behind the Module contract
// (module.json manifest + hook exports): the adapter (ingest/validate/apply/
// render — wraps the EXISTING Knowledge pipeline: proposals/ER/registry/items/
// index), the miner (the source-A distill path), and the digest section.
// Substrate code stays in zuzuu/knowledge/ — this module is the contract face.

import { resolve as erResolve } from '../../knowledge/er.mjs';
import { loadRegistry, validateItem } from '../../knowledge/registry.mjs';
import { allItems, slugify } from '../../knowledge/items.mjs';
import { applyKnowledgeProposal, createProposal } from '../../knowledge/proposals.mjs';
import { aggregate } from '../../knowledge/distill.mjs';

const name = 'knowledge';

export const manifest = {
  id: 'knowledge',
  title: 'Knowledge',
  tagline: "what's TRUE — facts about this project",
  version: '1.0.0',
  contract: 1,
  kinds: ['fact', 'entity', 'command', 'decision'],
  itemsDir: 'items',
  schema: 'schema.json',
  hooks: { miner: true, digest: true, eval: false, gate: false },
  ui: { icon: 'book', accent: 'info', teaching: 'Facts zuzuu learns from your sessions land here after your approval.' },
};

// ---------------------------------------------------------------------------
// adapter (WS2-T2 — unchanged behaviour)
// ---------------------------------------------------------------------------

/**
 * Ingest a raw candidate: run ER against existing items and return the
 * normalised payload + analysis. Mirrors what createProposal computes today.
 * @param {string} agentDir
 * @param {{candidate:object, source?:string, evidence?:object}} raw
 */
function ingest(agentDir, raw) {
  const { items } = allItems(agentDir);
  const candidate = { ...raw.candidate };
  candidate.id = candidate.id || slugify(candidate.body);
  const er = erResolve(candidate, items);
  return { payload: candidate, analysis: { er }, dedupeKey: candidate.id };
}

/**
 * Validate an item against the Knowledge registry.
 * @returns {{ok:boolean, errors:string[], warnings:string[]}}
 */
export function validate(agentDir, payload) {
  const reg = loadRegistry(agentDir);
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
function apply(agentDir, proposal) {
  // Bridge spine-shaped records (payload/analysis.er) onto applyKnowledgeProposal's
  // legacy shape (candidate/er). Records that still carry candidate/er pass through.
  const legacy = {
    ...proposal,
    candidate: proposal.candidate ?? proposal.payload,
    er: proposal.er ?? proposal.analysis?.er,
  };
  const r = applyKnowledgeProposal(agentDir, legacy);
  return {
    ok: r.ok,
    action: r.action,
    itemIds: r.item ? [r.item] : [],
    warnings: r.warnings ?? [],
  };
}

export const applyProposal = apply;

/**
 * Render a proposal for the human gate. `card` mirrors the multi-line summary
 * `zuzuu review` shows for knowledge proposals (id, type, attrs/relations, ER
 * verdict); `line` is the one-line list form (`zuzuu proposals list`).
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

// ---------------------------------------------------------------------------
// miner (WS5-T1 — the golden source-A distill path, unchanged)
// ---------------------------------------------------------------------------

/** File one knowledge proposal per aggregated candidate; return the count of
 *  actually-filed proposals (archive-resolved ids are skipped, not re-filed). */
export function propose(agentDir, aggregated) {
  let count = 0;
  for (const c of aggregated) {
    const p = createProposal(agentDir, { candidate: c.candidate, source: 'distill', evidence: c.evidence });
    if (p && p.status !== 'archived-skip') count++;
  }
  return count;
}

export const miner = { module: name, aggregate, propose };

export { aggregate };

// ---------------------------------------------------------------------------
// digest section (moved from the pre-module digest, byte-identical output)
// ---------------------------------------------------------------------------

/**
 * The Knowledge digest section: most-recent items under the shared char budget.
 * @param {string} agentDir
 * @param {{limit:number, charBudget:number, priorLines:string[]}} ctx
 * @returns {{lines: string[], data: object}}
 */
export function digestSection(agentDir, { limit, charBudget, priorLines }) {
  let knowledge;
  try {
    const { items } = allItems(agentDir);
    const ranked = [...items]
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, limit);
    knowledge = { count: items.length, shown: ranked.map((i) => ({ id: i.id, type: i.type, body: i.body })) };
  } catch {
    knowledge = { count: 0, shown: [] };
  }
  const lines = ['## Knowledge'];
  if (!knowledge.count) {
    lines.push('(no items yet — propose facts to knowledge/inbox/)');
    return { lines, data: { ...knowledge, renderedCount: 0 } };
  }
  lines.push(`${knowledge.count} item(s); most recent:`);
  let shown = 0;
  for (const it of knowledge.shown) {
    const line = `- ${it.id} · ${it.type} · ${it.body.split('\n')[0].slice(0, 80)}`;
    // join is O(items²) but trivial: once-per-session, limit default 5
    if ([...priorLines, ...lines].join('\n').length + line.length > charBudget && shown > 0) break;
    lines.push(line);
    shown++;
  }
  const dropped = knowledge.count - shown;
  if (dropped > 0) lines.push(`- … (${dropped} more — \`zuzuu recall\`)`);
  // `shown` = items actually rendered (after budget); `count` = total available
  return { lines, data: { ...knowledge, shown: knowledge.shown.slice(0, shown), renderedCount: shown } };
}

// ---------------------------------------------------------------------------
// session signals (the observability surface — `zuzuu session inspect`)
// ---------------------------------------------------------------------------

/** Counts of the mined-signal superset slices this module grows from. */
export function sessionSignals(signals = {}) {
  return {
    commands: signals.commands?.length ?? 0,
    files: signals.files?.length ?? 0,
    failures: signals.failures?.length ?? 0,
  };
}
