// mns/instructions/adapter.mjs
// The Instructions faculty adapter (WS2-T4). Wraps steering-amendment proposals
// behind the faculty-spine adapter contract — { name, ingest, validate, apply,
// render } — so `mns review` can surface and approve them uniformly.
//
// An instructions proposal payload is a steering amendment:
//   { text }  — a line or paragraph to append to project.md
//
// apply: appends the text as a line to agent/instructions/project.md (creates
//        the file if absent; never duplicates an already-present line).
//
// Registers itself on import.

import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import * as registry from '../faculty/registry.mjs';

const name = 'instructions';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function projectMdPath(mnsDir) {
  return join(mnsDir, 'instructions', 'project.md');
}

// ---------------------------------------------------------------------------
// adapter contract
// ---------------------------------------------------------------------------

/**
 * Ingest a raw amendment object. Pass-through: the payload IS the amendment.
 */
function ingest(_mnsDir, raw) {
  const payload = raw?.payload ?? raw ?? {};
  return { payload, analysis: {} };
}

/**
 * Validate an amendment payload.
 * @returns {{ok:boolean, errors:string[], warnings:string[]}}
 */
function validate(_mnsDir, payload) {
  const errors = [];
  if (!payload?.text || !String(payload.text).trim()) {
    errors.push('text is required (non-empty steering amendment)');
  }
  return { ok: errors.length === 0, errors, warnings: [] };
}

/**
 * Apply an approved amendment: append text to project.md (idempotent on
 * identical lines — won't duplicate a line already present).
 * @returns {{ok:boolean, action:string, itemIds:string[]}}
 */
function apply(mnsDir, proposal) {
  const text = proposal?.payload?.text ?? '';

  // Ensure the instructions dir exists
  mkdirSync(join(mnsDir, 'instructions'), { recursive: true });

  const path = projectMdPath(mnsDir);
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';

  // Idempotence: skip if the exact text is already present
  if (existing.includes(text)) {
    return { ok: true, action: 'amended instructions (already present)', itemIds: [] };
  }

  // Append (with trailing newline)
  const separator = existing && !existing.endsWith('\n') ? '\n' : '';
  writeFileSync(path, existing + separator + text + '\n');

  return { ok: true, action: 'amended instructions', itemIds: [] };
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
