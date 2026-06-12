// zuzuu/faculty/envelope.mjs — the Faculty Standard envelope (W24).
//
// ONE storage format across all five faculties: one file per item, markdown
// prose + a strict constrained-YAML frontmatter we control on both ends (no
// YAML lib — grown from the knowledge items grammar):
//
//   ---
//   id: test-command          # required, slug
//   faculty: knowledge        # required, one of the 5
//   kind: command             # required; per-faculty kinds (FACULTY_KINDS)
//   title: "Test command"     # required, single line
//   status: active            # active | archived
//   created_at: 2026-06-12T00:00:00Z
//   updated_at: …             # optional
//   provenance:               # optional list of flat maps {session, ref}
//     - session: ses_abc
//       ref: occurrences=12
//   payload:                  # faculty-typed machine fields
//     type: command           #   scalar
//     attributes:             #   one-level map of scalars
//       command: npm test
//     relations:              #   list of flat maps
//       - type: relates-to
//         target: ci-pipeline
//   ---
//   <markdown prose body>
//
// Grammar (deliberately small): top-level scalar keys; `provenance` = a list of
// flat maps; `payload` = a block of scalars, one-level maps of scalars, lists
// of flat maps, or lists of scalars. Values are single-line strings (JSON
// double-quoting when they carry specials — round-trip exact, incl. backslashes
// in guardrail regexes). Anything outside this grammar is a parse error.
//
// API: parseEnvelope(text) → {ok, item, errors} (never throws) ·
//      serializeEnvelope(item) → text · validateEnvelope(item, payloadSchema).
// Payload validation rides the shared JSON-Schema-subset checker
// (actions/schema.mjs — type/required/enum/pattern on flat fields).

import { FACULTIES } from './contract.mjs';
import { validate as validateSchema } from '../actions/schema.mjs';

/** Per-faculty item kinds. `null` = open set (knowledge kinds are governed by
 *  the knowledge registry's types.json, not pinned here). */
export const FACULTY_KINDS = {
  knowledge: null, // registry-governed (seed: fact|entity|command|decision)
  memory: ['episode'],
  actions: ['runbook', 'script'],
  instructions: ['steering', 'amendment'],
  guardrails: ['rule'],
};

/** Default payload schemas (JSON-Schema subset) — also seeded to
 *  .zuzuu/<faculty>/schema.json by `zuzuu init`. We author both ends. */
export const PAYLOAD_SCHEMAS = {
  knowledge: {
    type: 'object',
    required: ['type'],
    properties: {
      type: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]*$' },
      attributes: { type: 'object' },
      relations: {
        type: 'array',
        items: { type: 'object', required: ['type', 'target'], properties: { type: { type: 'string' }, target: { type: 'string' }, commentary: { type: 'string' } } },
      },
    },
  },
  memory: {
    type: 'object',
    properties: {
      sessions: { type: 'array', items: { type: 'string' } },
      hosts: { type: 'array', items: { type: 'string' } },
      tags: { type: 'array', items: { type: 'string' } },
    },
  },
  actions: {
    type: 'object',
    properties: {
      exec: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$' }, // sibling file name, no path escape
      args: { type: 'object' },
    },
  },
  instructions: {
    type: 'object',
    properties: { scope: { type: 'string' } },
  },
  guardrails: {
    type: 'object',
    required: ['action', 'pattern', 'reason'],
    properties: {
      action: { type: 'string', enum: ['deny', 'ask', 'allow'] },
      tool: { type: 'string' },
      pattern: { type: 'string', minLength: 1 },
      reason: { type: 'string', minLength: 1 },
    },
  },
};

const ID_RE = /^[a-z0-9][a-z0-9_-]*$/; // spec is [a-z0-9-]; `_` tolerated for action slugs
const ISO_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const STATUSES = new Set(['active', 'archived']);
const TOP_KEYS = ['id', 'faculty', 'kind', 'title', 'status', 'created_at', 'updated_at'];

// --- scalar quoting (round-trip exact, incl. backslashes) --------------------

const unquote = (s) => {
  const t = s.trim();
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) {
    try { return JSON.parse(t); } catch { return t.slice(1, -1); }
  }
  if (t.startsWith("'") && t.endsWith("'") && t.length >= 2) return t.slice(1, -1);
  return t;
};

const quoteIfNeeded = (s) => {
  const t = String(s);
  if (t.includes('\n')) throw new Error('envelope values must be single-line');
  return /[:#'"\\\[\]{}]|^-\s|^\s|\s$/.test(t) || t === '' ? JSON.stringify(t) : t;
};

const KV = /^([A-Za-z_][\w-]*):\s*(.*)$/;

// --- parse -------------------------------------------------------------------

/**
 * Parse an envelope file's text. Never throws.
 * @returns {{ok: boolean, item: object|null, errors: string[]}}
 */
export function parseEnvelope(text) {
  const errors = [];
  const m = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { ok: false, item: null, errors: ['no frontmatter block'] };
  const [, fm, body] = m;
  const item = { provenance: [], payload: {}, body: body.trim() };

  let section = null;     // 'provenance' | 'payload' | null
  let payloadKey = null;  // current sub-block key inside payload
  let current = null;     // current list entry (flat map) being filled

  for (const raw of fm.split('\n')) {
    if (!raw.trim()) continue;
    const indent = raw.match(/^ */)[0].length;
    const line = raw.trim();

    if (indent === 0) {
      section = null; payloadKey = null; current = null;
      const kv = line.match(KV);
      if (!kv) { errors.push(`bad line: ${line}`); continue; }
      const [, key, val] = kv;
      if (key === 'provenance' || key === 'payload') {
        if (val) { errors.push(`${key} must be a block`); continue; }
        section = key;
      } else {
        item[key] = unquote(val);
      }
    } else if (section === 'provenance') {
      if (line.startsWith('- ')) {
        const kv = line.slice(2).match(KV);
        if (!kv) { errors.push(`bad provenance entry: ${line}`); continue; }
        current = { [kv[1]]: unquote(kv[2]) };
        item.provenance.push(current);
      } else {
        const kv = line.match(KV);
        if (!current || !kv) { errors.push(`bad provenance line: ${line}`); continue; }
        current[kv[1]] = unquote(kv[2]);
      }
    } else if (section === 'payload') {
      if (indent === 2 && !line.startsWith('- ')) {
        current = null;
        const kv = line.match(KV);
        if (!kv) { errors.push(`bad payload line: ${line}`); continue; }
        const [, key, val] = kv;
        if (val === '') { payloadKey = key; /* shape resolved by first child */ }
        else { payloadKey = null; item.payload[key] = unquote(val); }
      } else if (indent >= 4 && payloadKey) {
        const slot = item.payload[payloadKey];
        if (line.startsWith('- ')) {
          const rest = line.slice(2);
          if (!Array.isArray(slot)) {
            if (slot !== undefined && typeof slot === 'object') { errors.push(`payload ${payloadKey}: mixed map/list`); continue; }
            item.payload[payloadKey] = [];
          }
          const kv = rest.match(KV);
          if (kv) {
            current = { [kv[1]]: unquote(kv[2]) };
            item.payload[payloadKey].push(current);
          } else {
            current = null;
            item.payload[payloadKey].push(unquote(rest));
          }
        } else if (current && Array.isArray(slot)) {
          const kv = line.match(KV);
          if (!kv) { errors.push(`bad payload ${payloadKey} entry line: ${line}`); continue; }
          current[kv[1]] = unquote(kv[2]);
        } else {
          // one-level map of scalars
          if (slot === undefined) item.payload[payloadKey] = {};
          else if (Array.isArray(item.payload[payloadKey])) { errors.push(`payload ${payloadKey}: mixed list/map`); continue; }
          const kv = line.match(KV);
          if (!kv) { errors.push(`bad payload ${payloadKey} line: ${line}`); continue; }
          item.payload[payloadKey][kv[1]] = unquote(kv[2]);
        }
      } else {
        errors.push(`unexpected indented line: ${line}`);
      }
    } else {
      errors.push(`unexpected indented line: ${line}`);
    }
  }

  // empty sub-blocks (key with no children) resolve to {} — already the default
  if (!item.id) errors.push('item missing id');
  if (!item.faculty) errors.push('item missing faculty');
  if (!item.kind) errors.push('item missing kind');
  return { ok: errors.length === 0, item, errors };
}

// --- serialize ----------------------------------------------------------------

/** Serialize an envelope item → file text (the exact grammar parseEnvelope reads). */
export function serializeEnvelope(item) {
  const lines = ['---'];
  for (const key of TOP_KEYS) {
    if (item[key] != null && item[key] !== '') lines.push(`${key}: ${quoteIfNeeded(item[key])}`);
  }
  const prov = item.provenance ?? [];
  if (prov.length) {
    lines.push('provenance:');
    for (const entry of prov) {
      Object.keys(entry).forEach((k, i) => lines.push(`  ${i === 0 ? '- ' : '  '}${k}: ${quoteIfNeeded(entry[k])}`));
    }
  }
  const payload = item.payload ?? {};
  const pkeys = Object.keys(payload).filter((k) => payload[k] != null);
  if (pkeys.length) {
    lines.push('payload:');
    for (const k of pkeys) {
      const v = payload[k];
      if (Array.isArray(v)) {
        if (!v.length) continue;
        lines.push(`  ${k}:`);
        for (const entry of v) {
          if (entry !== null && typeof entry === 'object') {
            Object.keys(entry).forEach((ek, i) => lines.push(`    ${i === 0 ? '- ' : '  '}${ek}: ${quoteIfNeeded(entry[ek])}`));
          } else {
            lines.push(`    - ${quoteIfNeeded(entry)}`);
          }
        }
      } else if (v !== null && typeof v === 'object') {
        const entries = Object.entries(v);
        if (!entries.length) continue;
        lines.push(`  ${k}:`);
        for (const [mk, mv] of entries) lines.push(`    ${mk}: ${quoteIfNeeded(mv)}`);
      } else {
        lines.push(`  ${k}: ${quoteIfNeeded(v)}`);
      }
    }
  }
  lines.push('---', '');
  return lines.join('\n') + (item.body ? String(item.body).trim() + '\n' : '');
}

// --- validate -----------------------------------------------------------------

/**
 * Validate an envelope item: required envelope fields + (optionally) its payload
 * against a JSON-Schema-subset payload schema.
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateEnvelope(item, payloadSchema = null) {
  const errors = [];
  if (!item || typeof item !== 'object') return { ok: false, errors: ['not an item'] };
  if (!item.id || !ID_RE.test(item.id)) errors.push(`id must match ${ID_RE} (got '${item.id}')`);
  if (!FACULTIES.includes(item.faculty)) errors.push(`faculty must be one of ${FACULTIES.join('|')} (got '${item.faculty}')`);
  const kinds = FACULTY_KINDS[item.faculty];
  if (!item.kind || !/^[a-z0-9][a-z0-9-]*$/.test(item.kind)) errors.push(`kind must be a slug (got '${item.kind}')`);
  else if (Array.isArray(kinds) && !kinds.includes(item.kind)) errors.push(`kind must be one of ${kinds.join('|')} for ${item.faculty} (got '${item.kind}')`);
  if (!item.title || typeof item.title !== 'string' || item.title.includes('\n')) errors.push('title is required (single line)');
  if (item.status != null && !STATUSES.has(item.status)) errors.push(`status must be active|archived (got '${item.status}')`);
  if (!item.created_at || !ISO_RE.test(String(item.created_at))) errors.push(`created_at must be ISO (got '${item.created_at}')`);
  if (item.updated_at != null && !ISO_RE.test(String(item.updated_at))) errors.push(`updated_at must be ISO (got '${item.updated_at}')`);
  if (item.provenance != null && !Array.isArray(item.provenance)) errors.push('provenance must be a list');
  if (payloadSchema) errors.push(...validateSchema(payloadSchema, item.payload ?? {}, 'payload'));
  return { ok: errors.length === 0, errors };
}

/** Derive a single-line title (first body line, de-markdowned) — fallback id. */
export function deriveTitle(body, id) {
  const first = String(body ?? '').split('\n').map((l) => l.replace(/^#+\s*/, '').trim()).find(Boolean);
  return (first || String(id || 'item')).slice(0, 80);
}
