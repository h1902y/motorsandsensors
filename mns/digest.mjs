// mns/digest.mjs
// The grounding digest — a pure, deterministic, zero-network, no-model brief of
// the faculty home, injected at session start. Returns { text, sections }.
// I/O-free: callers (the CLI + the SessionStart hook) handle output. Every
// reader is wrapped so a single broken faculty never sinks the whole digest.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { allItems } from './knowledge/items.mjs';
import { listProposals } from './knowledge/proposals.mjs';
import { loadRules } from './guardrails.mjs';
import { allActions } from './actions/manifest.mjs';

const PLACEHOLDER_MARK = '<!-- Fill in:';

/** Read instructions/project.md; classify empty vs steering text. */
function readInstructions(mnsDir) {
  const path = join(mnsDir, 'instructions', 'project.md');
  let raw = '';
  try {
    raw = readFileSync(path, 'utf8');
  } catch { /* missing or unreadable → treat as empty */ }
  const stripped = raw.replace(/^#.*$/gm, '').trim();
  const empty = !stripped || raw.includes(PLACEHOLDER_MARK);
  return { empty, text: empty ? '' : raw.trim() };
}

const INTERVIEW = [
  'Project steering is empty. Before substantive work, interview your human',
  '(what is this project, its conventions, its priorities), draft',
  '.mns/instructions/project.md from their answers, and get their approval.',
].join(' ');

function knowledgeSection(mnsDir, limit) {
  try {
    const { items } = allItems(mnsDir);
    const ranked = [...items]
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, limit);
    return { count: items.length, shown: ranked.map((i) => ({ id: i.id, type: i.type, body: i.body })) };
  } catch {
    return { count: 0, shown: [] };
  }
}

function proposalsSection(mnsDir) {
  try {
    // count only pending — defensive if listProposals ever returns archived too
    const pending = listProposals(mnsDir).filter((p) => p.status === 'pending');
    return { pending: pending.length };
  } catch {
    return { pending: 0 };
  }
}

function actionsSection(mnsDir, limit) {
  try {
    const list = allActions(mnsDir);
    return { count: list.length, shown: list.slice(0, limit).map((a) => ({ slug: a.slug, kind: a.kind, promptSnippet: a.promptSnippet })) };
  } catch {
    return { count: 0, shown: [] };
  }
}

function guardrailsSection(mnsDir) {
  try {
    const loaded = loadRules(join(mnsDir, 'guardrails', 'rules.json'));
    return { ok: loaded.ok, count: loaded.ok ? loaded.rules.length : 0 };
  } catch {
    return { ok: false, count: 0 };
  }
}

/**
 * Compute the digest for a faculty home.
 * @param {string} mnsDir  path to the .mns directory
 * @param {{ knowledgeLimit?: number, budget?: number }} options
 * @returns {{ text: string, sections: object }}
 */
export function computeDigest(mnsDir, { knowledgeLimit = 5, budget = 1500 } = {}) {
  const charBudget = budget * 4;
  const sections = {};
  const lines = ['# mns faculty digest', ''];

  const instr = readInstructions(mnsDir);
  sections.instructions = instr;
  lines.push('## Instructions');
  lines.push(instr.empty ? INTERVIEW : instr.text);
  lines.push('');

  const knowledge = knowledgeSection(mnsDir, knowledgeLimit);
  lines.push('## Knowledge');
  if (!knowledge.count) {
    lines.push('(no items yet — propose facts to knowledge/inbox/)');
    sections.knowledge = { ...knowledge, renderedCount: 0 };
  } else {
    lines.push(`${knowledge.count} item(s); most recent:`);
    let shown = 0;
    for (const it of knowledge.shown) {
      const line = `- ${it.id} · ${it.type} · ${it.body.split('\n')[0].slice(0, 80)}`;
      // join is O(items²) but trivial: once-per-session, knowledgeLimit default 5
      if (lines.join('\n').length + line.length > charBudget && shown > 0) break;
      lines.push(line);
      shown++;
    }
    const dropped = knowledge.count - shown;
    if (dropped > 0) lines.push(`- … (${dropped} more — \`mns recall\`)`);
    // `shown` = items actually rendered (after budget); `count` = total available
    sections.knowledge = { ...knowledge, shown: knowledge.shown.slice(0, shown), renderedCount: shown };
  }
  lines.push('');

  const actions = actionsSection(mnsDir, knowledgeLimit);
  sections.actions = actions;
  if (actions.count) {
    lines.push('## Actions');
    lines.push(`${actions.count} available; run with \`mns act <slug>\`:`);
    let shownA = 0;
    for (const a of actions.shown) {
      const line = `- ${a.slug} · ${a.promptSnippet}`;
      if (lines.join('\n').length + line.length > charBudget && shownA > 0) break;
      lines.push(line);
      shownA++;
    }
    const droppedA = actions.count - shownA;
    if (droppedA > 0) lines.push(`- … (${droppedA} more — \`mns act list\`)`);
    lines.push('');
    // mirror the Knowledge contract: shown reflects what actually rendered
    sections.actions = { ...actions, shown: actions.shown.slice(0, shownA), renderedCount: shownA };
  } else {
    sections.actions = { ...actions, renderedCount: 0 };
  }

  const proposals = proposalsSection(mnsDir);
  sections.proposals = proposals;
  if (proposals.pending > 0) {
    lines.push('## Proposals');
    lines.push(`${proposals.pending} pending — remind the human to run \`mns review\`.`);
    lines.push('');
  }

  const guardrails = guardrailsSection(mnsDir);
  sections.guardrails = guardrails;
  lines.push('## Guardrails');
  lines.push(guardrails.count ? `${guardrails.count} rule(s) — the enforced gate is on; refusals are policy.` : 'no rules configured.');
  lines.push('');

  return { text: lines.join('\n').trimEnd() + '\n', sections };
}
