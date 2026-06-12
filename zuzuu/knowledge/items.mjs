// Knowledge items — files as truth, in the Faculty Standard envelope (W24).
// One item per markdown file under .zuzuu/knowledge/items/<id>.md:
//
//   ---
//   id: test-command
//   faculty: knowledge
//   kind: command
//   title: The test command
//   status: active
//   created_at: 2026-06-10T12:00:00Z
//   provenance:
//     - session: ses_abc
//       ref: occurrences=12
//   payload:
//     type: command
//     attributes:
//       command: npm test
//     relations:
//       - type: relates-to
//         target: ci-pipeline
//   ---
//   Body prose.
//
// This module is a thin wrapper over faculty/envelope.mjs: the ON-DISK format
// is the envelope; the IN-MEMORY item shape stays the historical knowledge one
// ({id, type, created_at, status, attributes, relations, provenance, body}) so
// the registry/ER/index/digest pipeline is untouched. Ids are unchanged by the
// standard — only frontmatter keys moved (type/attributes/relations → payload).

import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { parseEnvelope, serializeEnvelope, deriveTitle } from '../faculty/envelope.mjs';

export const itemsDir = (agentDir) => join(agentDir, 'knowledge', 'items');

export function slugify(text, max = 60) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/, '') || 'item';
}

/**
 * Parse an item file's text → the in-memory knowledge item. Throws on grammar
 * violations (callers catch — allItems collects, inbox falls back to prose).
 */
export function parseItem(text) {
  const { ok, item: env, errors } = parseEnvelope(text);
  if (!ok) throw new Error(errors[0] ?? 'invalid envelope');
  if (env.faculty !== 'knowledge') throw new Error(`not a knowledge item (faculty: ${env.faculty})`);
  const p = env.payload ?? {};
  const item = {
    attributes: p.attributes ?? {},
    relations: p.relations ?? [],
    provenance: env.provenance ?? [],
    body: env.body,
  };
  item.id = env.id;
  item.type = p.type ?? env.kind;
  if (env.created_at != null) item.created_at = env.created_at;
  if (env.updated_at != null) item.updated_at = env.updated_at;
  if (env.status != null) item.status = env.status;
  if (!item.type) throw new Error('item missing type');
  return item;
}

/** Serialize an in-memory knowledge item → envelope file text. */
export function serializeItem(item) {
  if (!item.id) throw new Error('item missing id');
  if (!item.type) throw new Error('item missing type');
  const payload = { type: item.type };
  if (Object.keys(item.attributes ?? {}).length) payload.attributes = item.attributes;
  if ((item.relations ?? []).length) payload.relations = item.relations;
  return serializeEnvelope({
    id: item.id,
    faculty: 'knowledge',
    kind: item.type,
    title: item.title ?? deriveTitle(item.body, item.id),
    status: item.status,
    created_at: item.created_at,
    updated_at: item.updated_at,
    provenance: item.provenance ?? [],
    payload,
    body: item.body,
  });
}

/** Write an item to its canonical file. Returns the path. */
export function writeItem(agentDir, item) {
  const dir = itemsDir(agentDir);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${item.id}.md`);
  writeFileSync(path, serializeItem(item));
  return path;
}

export function readItem(agentDir, id) {
  const path = join(itemsDir(agentDir), `${id}.md`);
  if (!existsSync(path)) return null;
  return parseItem(readFileSync(path, 'utf8'));
}

/** All items (parse errors collected, not thrown — audit surfaces them). */
export function allItems(agentDir) {
  const dir = itemsDir(agentDir);
  if (!existsSync(dir)) return { items: [], errors: [] };
  const items = [];
  const errors = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
    try {
      items.push(parseItem(readFileSync(join(dir, f), 'utf8')));
    } catch (e) {
      errors.push({ file: f, error: e.message });
    }
  }
  return { items, errors };
}
