// Knowledge items — files as truth. One item per markdown file under
// agent/knowledge/items/<id>.md: a constrained-YAML frontmatter (we control both
// writer and reader; grammar below) + a prose body (the fact in your voice).
//
//   ---
//   id: test-command
//   type: command
//   created_at: 2026-06-10T12:00:00Z
//   status: active
//   attributes:
//     command: npm test
//   relations:
//     - type: relates-to
//       target: ci-pipeline
//       commentary: optional
//   provenance:
//     - session: ses_abc
//       ref: occurrences=12
//   ---
//   Body prose.
//
// Grammar (deliberately small): top-level scalar keys; ONE nested map
// (`attributes`); arrays of flat maps (`relations`, `provenance`). Values are
// single-line strings (quotes optional). Anything outside this grammar is a
// parse error — git-diffable simplicity beats YAML completeness here.

import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';

export const itemsDir = (mnsDir) => join(mnsDir, 'knowledge', 'items');

export function slugify(text, max = 60) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/, '') || 'item';
}

const unquote = (s) => {
  const t = s.trim();
  return (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")) ? t.slice(1, -1) : t;
};
const quoteIfNeeded = (s) => {
  const t = String(s);
  if (t.includes('\n')) throw new Error('item values must be single-line');
  return /[:#'"\[\]{}]|^\s|\s$/.test(t) ? JSON.stringify(t) : t;
};

/** Parse an item file's text → item object. Throws on grammar violations. */
export function parseItem(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error('no frontmatter block');
  const [, fm, body] = m;
  const item = { attributes: {}, relations: [], provenance: [], body: body.trim() };
  let section = null; // 'attributes' | 'relations' | 'provenance'
  let current = null; // current array entry
  for (const raw of fm.split('\n')) {
    if (!raw.trim()) continue;
    const indent = raw.match(/^ */)[0].length;
    const line = raw.trim();
    if (indent === 0) {
      current = null;
      const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
      if (!kv) throw new Error(`bad line: ${line}`);
      const [, key, val] = kv;
      if (['attributes', 'relations', 'provenance'].includes(key)) {
        section = key;
        if (val) throw new Error(`${key} must be a block`);
      } else {
        section = null;
        item[key] = unquote(val);
      }
    } else if (section === 'attributes') {
      const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
      if (!kv) throw new Error(`bad attribute line: ${line}`);
      item.attributes[kv[1]] = unquote(kv[2]);
    } else if (section === 'relations' || section === 'provenance') {
      if (line.startsWith('- ')) {
        current = {};
        item[section].push(current);
        const kv = line.slice(2).match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
        if (!kv) throw new Error(`bad ${section} entry: ${line}`);
        current[kv[1]] = unquote(kv[2]);
      } else {
        if (!current) throw new Error(`${section} entry continuation without "-": ${line}`);
        const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
        if (!kv) throw new Error(`bad ${section} line: ${line}`);
        current[kv[1]] = unquote(kv[2]);
      }
    } else {
      throw new Error(`unexpected indented line: ${line}`);
    }
  }
  if (!item.id) throw new Error('item missing id');
  if (!item.type) throw new Error('item missing type');
  return item;
}

/** Serialize an item object → file text (the exact grammar parseItem reads). */
export function serializeItem(item) {
  const lines = ['---'];
  for (const key of ['id', 'type', 'created_at', 'status']) {
    if (item[key] != null) lines.push(`${key}: ${quoteIfNeeded(item[key])}`);
  }
  const attrs = Object.entries(item.attributes ?? {});
  if (attrs.length) {
    lines.push('attributes:');
    for (const [k, v] of attrs) lines.push(`  ${k}: ${quoteIfNeeded(v)}`);
  }
  for (const section of ['relations', 'provenance']) {
    const arr = item[section] ?? [];
    if (!arr.length) continue;
    lines.push(`${section}:`);
    for (const entry of arr) {
      const keys = Object.keys(entry);
      keys.forEach((k, i) => lines.push(`  ${i === 0 ? '- ' : '  '}${k}: ${quoteIfNeeded(entry[k])}`));
    }
  }
  lines.push('---', '');
  return lines.join('\n') + (item.body ? item.body.trim() + '\n' : '');
}

/** Write an item to its canonical file. Returns the path. */
export function writeItem(mnsDir, item) {
  const dir = itemsDir(mnsDir);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${item.id}.md`);
  writeFileSync(path, serializeItem(item));
  return path;
}

export function readItem(mnsDir, id) {
  const path = join(itemsDir(mnsDir), `${id}.md`);
  if (!existsSync(path)) return null;
  return parseItem(readFileSync(path, 'utf8'));
}

/** All items (parse errors collected, not thrown — audit surfaces them). */
export function allItems(mnsDir) {
  const dir = itemsDir(mnsDir);
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
