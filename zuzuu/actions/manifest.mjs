// zuzuu/actions/manifest.mjs
// Reads the Actions module off disk: one action per dir under .zuzuu/actions/,
// described by an ACTION.md envelope (the Module Standard, W24 — SKILL.md-shaped:
// frontmatter + instruction prose body; scripts stay siblings):
//
//   actions/<slug>/ACTION.md   kind: script|runbook; payload.exec (script entry,
//                              default run.mjs) + payload.args (default args)
//   actions/<slug>/run.mjs     the script (kind: script)
//
// Pure-ish: filesystem reads only, no logging, no process control.

import { join } from 'node:path';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { parseEnvelope, deriveTitle } from '../module/envelope.mjs';

// Action slugs: letters/digits start, then letters/digits/-/_. No dots or slashes
// → cannot escape .zuzuu/actions/ via path traversal.
export const SAFE_SLUG = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
export function isSafeSlug(slug) {
  return typeof slug === 'string' && SAFE_SLUG.test(slug);
}

// payload.exec must be a plain sibling filename — never a path.
const SAFE_EXEC = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const actionsDir = (agentDir) => join(agentDir, 'actions');
export const inboxDir = (agentDir) => join(actionsDir(agentDir), 'inbox');
const actionDir = (agentDir, slug) => join(actionsDir(agentDir), slug);

/** First non-empty body line — the one-liner the digest shows. */
function snippetOf(item) {
  const first = String(item.body ?? '').split('\n').map((l) => l.trim()).find(Boolean);
  return first || item.title || item.id;
}

/**
 * Read and parse ACTION.md for a slug → envelope manifest, or null if
 * absent/unparseable. Shape: { id, kind, title, status, created_at,
 * payload: {exec?, args?}, body } + promptSnippet derived from the body.
 */
export function loadManifest(agentDir, slug) {
  const path = join(actionDir(agentDir, slug), 'ACTION.md');
  try {
    const { ok, item } = parseEnvelope(readFileSync(path, 'utf8'));
    if (!ok || item.module !== 'actions') return null;
    item.title = item.title ?? deriveTitle(item.body, item.id);
    item.promptSnippet = snippetOf(item);
    return item;
  } catch {
    return null;
  }
}

/** The script entry file for a manifest (validated sibling name), or null. */
export function execOf(manifest) {
  const exec = manifest?.payload?.exec ?? 'run.mjs';
  return SAFE_EXEC.test(exec) ? exec : null;
}

/**
 * List actions in a base dir as {slug, kind, title, promptSnippet}.
 * An action is a dir carrying ACTION.md; kind comes from its envelope
 * (`script` | `runbook`). Other entries are skipped (READMEs, stray files,
 * unparseable envelopes — the latter surface via `zuzuu module items actions`).
 * Reads directly from each entry dir (works for any baseDir, e.g. the inbox).
 */
export function listActions(baseDir) {
  if (!existsSync(baseDir)) return [];
  const out = [];
  for (const name of readdirSync(baseDir).sort()) {
    const d = join(baseDir, name);
    let isDir = false;
    try { isDir = statSync(d).isDirectory(); } catch { /* skip */ }
    if (!isDir) continue; // ignores README.md and any stray files
    const actionMd = join(d, 'ACTION.md');
    if (!existsSync(actionMd)) continue;
    try {
      const { ok, item } = parseEnvelope(readFileSync(actionMd, 'utf8'));
      if (!ok) continue;
      const kind = item.kind === 'script' ? 'script' : 'runbook';
      out.push({ slug: name, kind, title: item.title ?? name, promptSnippet: snippetOf(item) });
    } catch { /* unreadable → skip */ }
  }
  return out;
}

/** Active actions under .zuzuu/actions/ (inbox/proposals subdirs excluded). */
export function allActions(agentDir) {
  return listActions(actionsDir(agentDir)).filter((a) => a.slug !== 'inbox' && a.slug !== 'proposals' && a.slug !== '_rolledback');
}
