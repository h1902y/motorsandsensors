// zuzuu/module/render.mjs — shared proposal card/text rendering for the human
// gate surfaces (`zuzuu review` cards + `zuzuu proposals` lines). Pure string
// builders; no I/O beyond the existing-item lookup the knowledge card shows.

import { readItem } from '../knowledge/items.mjs';
import { evalLine } from '../commands/eval.mjs';

/**
 * The rich knowledge proposal card (id, type, attrs/relations, evidence, ER
 * verdict + the matched item when enrich/duplicate, eval line).
 * @returns {string}
 */
export function knowledgeCard(agentDir, p, i, total, scoreResult) {
  const lines = [];
  lines.push(`\n━━ proposal ${i + 1}/${total} ── ${p.id} ── ${p.kind} ── source: ${p.source ?? '-'} ━━`);
  if (p.kind === 'registry') {
    lines.push(`  register ${p.registry.slice(0, -1)}: '${p.key}'  (seen ${p.evidence?.occurrences}× in candidates)`);
  } else {
    // dual-read: legacy records carry `candidate`/`er`; spine records (e.g.
    // inbox-promoted) carry `payload`/`analysis.er` — both must render.
    const c = p.candidate ?? p.payload ?? {};
    lines.push(`  ${c.type}: ${c.body?.slice(0, 100).replace(/\n/g, ' ')}`);
    for (const [k, v] of Object.entries(c.attributes ?? {})) lines.push(`    · ${k} = ${v}`);
    for (const r of c.relations ?? []) lines.push(`    → ${r.type} ${r.target}`);
    const ev = p.evidence ?? {};
    if (Object.keys(ev).length) lines.push(`  evidence: ${Object.entries(ev).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join('  ')}`);
    const er = p.er ?? p.analysis?.er ?? {};
    lines.push(`  er: ${er.verdict}${er.match ? ` → ${er.match}` : ''}  (${(er.confidence ?? 0).toFixed(2)} · ${er.reason ?? ''})`);
    if (er.match) {
      const m = readItem(agentDir, er.match);
      if (m) lines.push(`  existing: ${m.body.slice(0, 80).replace(/\n/g, ' ')}`);
    }
  }
  // Eval line — always shown; scoreResult computed by caller from ranked array.
  if (scoreResult) lines.push(`  ${evalLine(scoreResult)}`);
  return lines.join('\n');
}

/** The historical knowledge one-liner for `zuzuu proposals list`. */
export function knowledgeLine(p) {
  const c = p.candidate ?? p.payload ?? {}; // dual-read, same as the card
  const what = p.kind === 'registry'
    ? `register ${p.registry.slice(0, -1)} '${p.key}'`
    : `${c.type}: ${c.body?.slice(0, 60).replace(/\n/g, ' ')}`;
  return `  ${p.id}  [${p.er?.verdict ?? p.analysis?.er?.verdict ?? p.kind}]  ${what}`;
}

/** Derive the human title for a proposal (the JSON list/table form). */
export function proposalTitle(adapter, p) {
  let title;
  if (adapter.name === 'knowledge') {
    title = p.kind === 'registry'
      ? `register ${p.registry?.slice(0, -1) ?? ''} '${p.key ?? ''}'`
      : (p.candidate?.body ?? p.payload?.body ?? p.id)?.slice(0, 80);
  } else {
    title = p.title ?? adapter.render(p).line;
  }
  return title ?? p.id;
}
