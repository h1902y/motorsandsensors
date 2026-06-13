// zuzuu/module/items.mjs — where each module's envelope items live (W24).
//
// One standard, five homes:
//   knowledge    → knowledge/items/<id>.md
//   memory       → memory/entries/<id>.md
//   instructions → instructions/items/<id>.md
//   guardrails   → guardrails/items/<id>.md
//   actions      → actions/<id>/ACTION.md   (dir-shaped: scripts stay siblings)
//
// Listing is fail-soft: unparseable files are collected as errors, never thrown
// (mirrors knowledge allItems — audit surfaces them).

import { join, dirname } from 'node:path';
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { parseEnvelope, serializeEnvelope } from './envelope.mjs';

/** Flat item dirs per module (actions are dir-shaped — see itemPathFor). */
const ITEM_DIRS = {
  knowledge: ['knowledge', 'items'],
  memory: ['memory', 'entries'],
  instructions: ['instructions', 'items'],
  guardrails: ['guardrails', 'items'],
};

/** The flat items dir for a module, or null for dir-shaped modules (actions).
 *  Unknown (declarative) modules default to `<module>/<itemsDir||'items'>`
 *  under the home — manifest-only modules get items listing for free. */
export function itemsDirFor(agentDir, module, itemsDir) {
  if (module === 'actions') return null;
  const rel = ITEM_DIRS[module];
  if (rel) return join(agentDir, ...rel);
  const sub = itemsDir && itemsDir !== '.' ? itemsDir : 'items';
  return join(agentDir, module, sub);
}

/** Canonical envelope file path for one item. */
export function itemPathFor(agentDir, module, id) {
  if (module === 'actions') return join(agentDir, 'actions', id, 'ACTION.md');
  return join(itemsDirFor(agentDir, module), `${id}.md`);
}

/**
 * All envelope items of a module. Parse errors collected, never thrown.
 * @param {{itemsDir?: string}} [opts]  declarative modules pass manifest.itemsDir
 * @returns {{items: object[], errors: Array<{file: string, error: string}>}}
 */
export function listModuleItems(agentDir, module, opts = {}) {
  const items = [];
  const errors = [];
  if (module === 'actions') {
    const base = join(agentDir, 'actions');
    if (!existsSync(base)) return { items, errors };
    for (const name of readdirSync(base).sort()) {
      if (name === 'inbox' || name === 'proposals' || name === '_rolledback') continue;
      const p = join(base, name, 'ACTION.md');
      let isDir = false;
      try { isDir = statSync(join(base, name)).isDirectory(); } catch { /* skip */ }
      if (!isDir || !existsSync(p)) continue;
      const { ok, item, errors: errs } = parseEnvelope(readFileSync(p, 'utf8'));
      if (ok) items.push(item);
      else errors.push({ file: `${name}/ACTION.md`, error: errs[0] ?? 'parse error' });
    }
    return { items, errors };
  }
  const dir = itemsDirFor(agentDir, module, opts.itemsDir);
  if (!dir || !existsSync(dir)) return { items, errors };
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
    const { ok, item, errors: errs } = parseEnvelope(readFileSync(join(dir, f), 'utf8'));
    if (ok) items.push(item);
    else errors.push({ file: f, error: errs[0] ?? 'parse error' });
  }
  return { items, errors };
}

/** Write one envelope item to its canonical path. Returns the path. */
export function writeModuleItem(agentDir, item) {
  const path = itemPathFor(agentDir, item.module, item.id);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeEnvelope(item));
  return path;
}
