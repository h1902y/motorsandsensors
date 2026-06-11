// mns/guardrails/adapter.mjs
// The Guardrails faculty adapter (WS2-T4). Wraps the rules engine behind the
// faculty-spine adapter contract — { name, ingest, validate, apply, render } —
// so `mns review` can surface and approve/reject rule proposals the same way it
// does Knowledge proposals.
//
// A guardrails proposal payload is a single rule record:
//   { id, action: deny|ask|allow, tool, pattern, reason }
//
// apply: loads .mns/guardrails/rules.json (seeding {version:1,rules:[]} if
//        absent), appends the rule or replaces an existing one with the same id,
//        then writes the file back.
//
// Registers itself on import.

import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import * as registry from '../faculty/registry.mjs';

const name = 'guardrails';
const VALID_ACTIONS = new Set(['deny', 'ask', 'allow']);

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function rulesPath(mnsDir) {
  return join(mnsDir, 'guardrails', 'rules.json');
}

function loadRulesFile(mnsDir) {
  const path = rulesPath(mnsDir);
  if (!existsSync(path)) return { version: 1, rules: [] };
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { version: 1, rules: [] };
  }
}

// ---------------------------------------------------------------------------
// adapter contract
// ---------------------------------------------------------------------------

/**
 * Ingest a raw rule object. Pass-through: rule fields are the payload.
 * @param {string} mnsDir
 * @param {object} raw  — expected shape: { id, action, tool, pattern, reason }
 *                         or { payload: { ... } } from the spine
 */
function ingest(_mnsDir, raw) {
  const payload = raw?.payload ?? raw ?? {};
  return { payload, analysis: {}, dedupeKey: payload.id };
}

/**
 * Validate a rule payload.
 * @returns {{ok:boolean, errors:string[], warnings:string[]}}
 */
function validate(_mnsDir, payload) {
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
 * Apply an approved rule proposal: upsert into rules.json.
 * @returns {{ok:boolean, action:string, itemIds:string[]}}
 */
function apply(mnsDir, proposal) {
  const rule = proposal?.payload ?? {};
  const id = rule.id;

  // Ensure the guardrails dir exists
  mkdirSync(join(mnsDir, 'guardrails'), { recursive: true });

  const data = loadRulesFile(mnsDir);
  if (!Array.isArray(data.rules)) data.rules = [];

  const idx = data.rules.findIndex((r) => r.id === id);
  // Store only the canonical fields (id, action, tool, pattern, reason)
  const entry = {
    id: rule.id,
    action: rule.action,
    tool: rule.tool,
    pattern: rule.pattern,
    reason: rule.reason,
  };
  if (idx >= 0) {
    data.rules[idx] = entry;
  } else {
    data.rules.push(entry);
  }

  writeFileSync(rulesPath(mnsDir), JSON.stringify(data, null, 2) + '\n');
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
