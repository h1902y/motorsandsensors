// zuzuu/memory/adapter.mjs
// The Memory faculty adapter (WS2-T4). Wraps episode proposals behind the
// faculty-spine adapter contract — { name, ingest, validate, apply, render } —
// so `zuzuu review` can surface and approve memory entries uniformly.
//
// A memory proposal payload is an episode record matching the WS1 Memory schema:
//   { id, date, title, provenance, body }
//   id format: mem-<YYYY-MM-DD>-<slug>
//
// apply: writes .zuzuu/memory/entries/<id>.md with YAML frontmatter (status: curated)
//        and the body sections (Attempted / Resulted / Remember next time).
//
// Registers itself on import.

import { join } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import * as registry from '../faculty/registry.mjs';

const name = 'memory';

// mem-<YYYY-MM-DD>-<slug>: the id must START with "mem-"
const MEM_ID_RE = /^mem-/;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function entriesDir(agentDir) {
  return join(agentDir, 'memory', 'entries');
}

function entryPath(agentDir, id) {
  return join(entriesDir(agentDir), `${id}.md`);
}

/** Render YAML frontmatter block from the payload fields. */
function renderFrontmatter(payload) {
  const lines = ['---'];
  lines.push(`id: ${payload.id}`);
  if (payload.date) lines.push(`date: ${payload.date}`);
  if (payload.title) lines.push(`title: ${payload.title}`);
  if (payload.provenance) {
    lines.push('provenance:');
    const p = payload.provenance;
    if (Array.isArray(p.sessions)) lines.push(`  sessions: [${p.sessions.join(', ')}]`);
    if (Array.isArray(p.hosts)) lines.push(`  hosts: [${p.hosts.join(', ')}]`);
  }
  if (Array.isArray(payload.tags) && payload.tags.length) {
    lines.push(`tags: [${payload.tags.join(', ')}]`);
  }
  lines.push('status: curated');
  lines.push('---');
  return lines.join('\n');
}

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
 * Apply an approved episode proposal: write the entry Markdown file.
 * @returns {{ok:boolean, action:string, itemIds:string[]}}
 */
function apply(agentDir, proposal) {
  const payload = proposal?.payload ?? {};
  const id = payload.id;

  mkdirSync(entriesDir(agentDir), { recursive: true });

  const frontmatter = renderFrontmatter(payload);
  const body = payload.body ?? '';
  const content = frontmatter + '\n' + body + (body.endsWith('\n') ? '' : '\n');

  writeFileSync(entryPath(agentDir, id), content);

  return { ok: true, action: `wrote memory ${id}`, itemIds: [id] };
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
