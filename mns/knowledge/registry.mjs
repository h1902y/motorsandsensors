// The Knowledge registry — governance for item types, attribute keys, and
// relation types. Refined from the Notes vault's registry (types/dimensions/
// relations JSONL): relations keep their INVERSES; unlike Notes, unknown keys
// are never silently auto-registered — repeated use files a registry *proposal*
// (human-gated, like everything in this system).
//
// Files (tracked, seeded by `mns init`): agent/knowledge/registry/
//   types.json       [{name, description}]
//   attributes.json  [{key, value, description}]   value: "string"|"number"|"date"|"url"|{"enum":[...]}
//   relations.json   [{name, inverse, description}]

import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

export const SEED_TYPES = [
  { name: 'fact', description: 'A declarative truth about the project/domain' },
  { name: 'entity', description: 'A named thing — file, module, service, person, system' },
  { name: 'command', description: 'A canonical command for this project (test, build, deploy…)' },
  { name: 'decision', description: 'A decision made, with its why' },
];

export const SEED_ATTRIBUTES = [
  { key: 'status', value: { enum: ['active', 'superseded'] }, description: 'Item lifecycle state' },
  { key: 'domain', value: 'string', description: 'Subject area the item belongs to' },
  { key: 'command', value: 'string', description: 'The literal command line (command items)' },
  { key: 'path', value: 'string', description: 'Filesystem path (entity items that are files/dirs)' },
  { key: 'url', value: 'url', description: 'External reference' },
  { key: 'decided_on', value: 'date', description: 'When a decision was made' },
];

export const SEED_RELATIONS = [
  { name: 'relates-to', inverse: 'relates-to', description: 'Generic association (symmetric)' },
  { name: 'part-of', inverse: 'has-part', description: 'Composition' },
  { name: 'depends-on', inverse: 'blocks', description: 'A needs B' },
  { name: 'supersedes', inverse: 'superseded-by', description: 'A replaces B' },
  { name: 'derived-from', inverse: 'source-of', description: 'A was distilled/derived from B' },
];

const REG_FILES = { types: 'types.json', attributes: 'attributes.json', relations: 'relations.json' };

export function registryDir(mnsDir) {
  return join(mnsDir, 'knowledge', 'registry');
}

/** Load the registry from agent/knowledge/registry/. Missing files → empty sets. */
export function loadRegistry(mnsDir) {
  const dir = registryDir(mnsDir);
  const read = (f) => {
    const p = join(dir, f);
    if (!existsSync(p)) return [];
    try {
      const data = JSON.parse(readFileSync(p, 'utf8'));
      return Array.isArray(data) ? data : [];
    } catch {
      return null; // unparseable — caller surfaces via audit
    }
  };
  const types = read(REG_FILES.types);
  const attributes = read(REG_FILES.attributes);
  const relations = read(REG_FILES.relations);
  const broken = [types, attributes, relations].some((x) => x === null);
  return {
    ok: !broken,
    types: new Map((types || []).map((t) => [t.name, t])),
    attributes: new Map((attributes || []).map((a) => [a.key, a])),
    relations: new Map((relations || []).map((r) => [r.name, r])),
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/** Validate one attribute value against its registry definition. */
export function validateAttribute(def, value) {
  if (!def) return { ok: false, error: 'unregistered attribute key' };
  const v = def.value;
  const s = String(value);
  if (v === 'string') return { ok: true };
  if (v === 'number') return Number.isFinite(Number(s)) ? { ok: true } : { ok: false, error: 'not a number' };
  if (v === 'date') return ISO_DATE.test(s) ? { ok: true } : { ok: false, error: 'not an ISO date' };
  if (v === 'url') return /^https?:\/\/\S+$/.test(s) ? { ok: true } : { ok: false, error: 'not a URL' };
  if (v && typeof v === 'object' && Array.isArray(v.enum)) {
    return v.enum.includes(s) ? { ok: true } : { ok: false, error: `not in enum [${v.enum.join(', ')}]` };
  }
  return { ok: true }; // unknown validator kind: permissive (fail-open governance)
}

/**
 * Validate an item against the registry.
 * @returns {{ok: boolean, errors: string[], unknownKeys: {attributes: string[], relations: string[]}}}
 *   unknownKeys are surfaced separately — they're proposal fodder, not hard errors
 *   for *candidates*; items.mjs treats them as errors for canonical items.
 */
export function validateItem(registry, item) {
  const errors = [];
  const unknownAttrs = [];
  const unknownRels = [];
  if (!registry.types.has(item.type)) errors.push(`unregistered type: ${item.type}`);
  for (const [key, value] of Object.entries(item.attributes ?? {})) {
    const def = registry.attributes.get(key);
    if (!def) {
      unknownAttrs.push(key);
      continue;
    }
    const r = validateAttribute(def, value);
    if (!r.ok) errors.push(`attribute ${key}: ${r.error}`);
  }
  for (const rel of item.relations ?? []) {
    if (!rel.type || !rel.target) {
      errors.push(`relation missing type/target: ${JSON.stringify(rel)}`);
      continue;
    }
    if (!registry.relations.has(rel.type)) unknownRels.push(rel.type);
  }
  return { ok: errors.length === 0, errors, unknownKeys: { attributes: unknownAttrs, relations: unknownRels } };
}
