// zuzuu/digest/compose.mjs
// The grounding digest — a pure, deterministic, zero-network, no-model brief of
// the faculty home, injected at session start. Returns { text, sections }.
// I/O-free: callers (the CLI + the SessionStart hook) handle output.
//
// Composition (the Faculty Module contract): each built-in module exports its
// own digestSection(agentDir, ctx); this file iterates the registry and stacks
// the sections in the canonical order — instructions → knowledge → actions →
// proposals (spine-level) → guardrails — then a default "N item(s)" section
// for every DECLARATIVE faculty. Every hook call rides registry.invoke
// (fail-soft): a single broken faculty never sinks the whole digest.

import { listProposals } from '../knowledge/proposals.mjs';
import { listFacultyItems } from '../faculty/items.mjs';
import { facultiesOf, invoke } from '../faculty/registry.mjs';

// The canonical section order (instructions/knowledge/actions render above the
// proposals block; guardrails closes the brief — preserved pre-module layout).
const HEAD_SECTIONS = ['instructions', 'knowledge', 'actions'];
const TAIL_SECTIONS = ['guardrails'];

function proposalsSection(agentDir) {
  try {
    // count only pending — defensive if listProposals ever returns archived too
    const pending = listProposals(agentDir).filter((p) => p.status === 'pending');
    return { pending: pending.length };
  } catch {
    return { pending: 0 };
  }
}

/** Run one faculty's digestSection hook fail-soft; null = no section. */
function sectionOf(entry, agentDir, ctx) {
  const r = invoke(entry, 'digestSection', agentDir, ctx);
  if (!r.ok || !r.value || !Array.isArray(r.value.lines)) return null;
  return r.value;
}

/** The default section a faculty WITHOUT a digest hook gets: "N item(s)". */
function defaultSection(agentDir, entry) {
  let count = 0;
  try {
    count = listFacultyItems(agentDir, entry.id, { itemsDir: entry.manifest?.itemsDir }).items.length;
  } catch { /* unreadable → 0 */ }
  return { lines: [`## ${entry.manifest?.title ?? entry.id}`, `${count} item(s)`], data: { count } };
}

/**
 * Compute the digest for a faculty home.
 * @param {string} agentDir  path to the .zuzuu/ directory
 * @param {{ knowledgeLimit?: number, budget?: number }} options
 * @returns {{ text: string, sections: object }}
 */
export function computeDigest(agentDir, { knowledgeLimit = 5, budget = 1500 } = {}) {
  const charBudget = budget * 4;
  const sections = {};
  const lines = ['# zuzuu faculty digest', ''];

  const faculties = facultiesOf(agentDir);
  const byId = new Map(faculties.map((f) => [f.id, f]));
  const ctx = () => ({ limit: knowledgeLimit, charBudget, priorLines: lines });

  for (const id of HEAD_SECTIONS) {
    const s = sectionOf(byId.get(id), agentDir, ctx());
    if (!s) continue;
    sections[id] = s.data;
    if (s.lines.length) lines.push(...s.lines, '');
  }

  // Proposals — spine-level (cross-faculty pending count lives with the gate).
  const proposals = proposalsSection(agentDir);
  sections.proposals = proposals;
  if (proposals.pending > 0) {
    lines.push('## Proposals');
    lines.push(`${proposals.pending} proposal(s) await your approval — run \`zuzuu review\`; approving mints a generation (your checkpoint).`);
    lines.push('');
  }

  for (const id of TAIL_SECTIONS) {
    const s = sectionOf(byId.get(id), agentDir, ctx());
    if (!s) continue;
    sections[id] = s.data;
    if (s.lines.length) lines.push(...s.lines, '');
  }

  // Declarative faculties (manifest-only): the default "N item(s)" line each —
  // a faculty you drop into the home is mentioned in the very next brief.
  for (const entry of faculties) {
    if (!entry.declarative || entry.manifestError) continue;
    const s = sectionOf(entry, agentDir, ctx()) ?? defaultSection(agentDir, entry);
    sections[entry.id] = s.data;
    if (s.lines.length) lines.push(...s.lines, '');
  }

  return { text: lines.join('\n').trimEnd() + '\n', sections };
}
