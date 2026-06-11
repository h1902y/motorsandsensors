// mns/actions/manifest.mjs
// Reads the Actions faculty off disk: one action per dir under agent/actions/.
// Two kinds — `script` (has run.mjs + action.json) and `runbook` (SKILL.md prose).
// Pure-ish: filesystem reads only, no logging, no process control.

import { join } from 'node:path';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';

// Action slugs: letters/digits start, then letters/digits/-/_. No dots or slashes
// → cannot escape agent/actions/ via path traversal.
export const SAFE_SLUG = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
export function isSafeSlug(slug) {
  return typeof slug === 'string' && SAFE_SLUG.test(slug);
}

export const actionsDir = (mnsDir) => join(mnsDir, 'actions');
export const inboxDir = (mnsDir) => join(actionsDir(mnsDir), 'inbox');
const actionDir = (mnsDir, slug) => join(actionsDir(mnsDir), slug);

/** Read action.json for a slug → object, or null if absent/unparseable. */
export function loadManifest(mnsDir, slug) {
  const path = join(actionDir(mnsDir, slug), 'action.json');
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** Pull `name` / `description` from a SKILL.md YAML-ish frontmatter (best-effort). */
function skillFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const fm = {};
  if (m) {
    for (const line of m[1].split('\n')) {
      const kv = line.match(/^(\w+):\s*(.*)$/);
      if (kv) fm[kv[1]] = kv[2].trim();
    }
  }
  return fm;
}

/**
 * List actions in a base dir as {slug, kind, title, promptSnippet}.
 * `script` = dir has run.mjs; `runbook` = dir has SKILL.md; other entries skipped.
 * Reads the manifest directly from each entry dir (works for any baseDir, e.g. the inbox).
 */
export function listActions(baseDir) {
  if (!existsSync(baseDir)) return [];
  const out = [];
  for (const name of readdirSync(baseDir)) {
    const d = join(baseDir, name);
    let isDir = false;
    try { isDir = statSync(d).isDirectory(); } catch { /* skip */ }
    if (!isDir) continue; // ignores README.md and any stray files
    if (existsSync(join(d, 'run.mjs'))) {
      let man = {};
      try { man = JSON.parse(readFileSync(join(d, 'action.json'), 'utf8')); } catch { /* slug fallback */ }
      out.push({ slug: name, kind: 'script', title: man.title ?? name, promptSnippet: man.promptSnippet ?? man.description ?? name });
    } else if (existsSync(join(d, 'SKILL.md'))) {
      let fm = {};
      try { fm = skillFrontmatter(readFileSync(join(d, 'SKILL.md'), 'utf8')); } catch { /* slug fallback */ }
      out.push({ slug: name, kind: 'runbook', title: fm.name ?? name, promptSnippet: fm.description ?? name });
    }
  }
  return out;
}

/** Active actions under agent/actions/ (the inbox subdir is excluded). */
export function allActions(mnsDir) {
  return listActions(actionsDir(mnsDir)).filter((a) => a.slug !== 'inbox');
}
