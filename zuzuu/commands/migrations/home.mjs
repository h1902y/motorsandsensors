// zuzuu/commands/migrations/home.mjs — the home migrator (W1, 2026-06-12):
// visible agent/ → hidden .zuzuu/ (byte-identical inner layout), plus the
// follow-ups: traceRef rewrite, gitignore + deny-rule swap, host-block re-inject.
// Pure core: migrateHome(root) → { migrated }. Idempotent + fail-soft.

import { existsSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../../core/store.mjs';
import { ensureGitignore } from '../../home/scaffold.mjs';
import { injectBlock, BLOCK_VERSION } from '../../home/inject.mjs';

// The denies the old visible-agent/ home installed; scrubbed here (NOT kept in
// install.mjs — clean break) and replaced by the current narrow .zuzuu/ pair.
const LEGACY_DENY_RULES = ['Read(./agent/.traces/**)', 'Read(./agent/.live/**)'];
const NEW_DENY_RULES = ['Read(./.zuzuu/.traces/**)', 'Read(./.zuzuu/.live/**)'];

/**
 * One-shot HOME migration: visible `agent/` → hidden `.zuzuu/` (byte-identical
 * inner layout). Gated on `agent/agent.json` — `agent/` is a common dir name,
 * so an unrelated agent/ dir in a brownfield repo must NEVER be touched (the
 * one place this differs from the old `.mns→agent` precedent). Idempotent +
 * fail-soft; NEVER clobbers an existing .zuzuu/. Pure FS move (renameSync).
 * @returns {{migrated: boolean}}
 */
export function migrateHome(root = repoRoot()) {
  const legacy = join(root, 'agent');
  const home = join(root, '.zuzuu');
  if (existsSync(home) || !existsSync(join(legacy, 'agent.json'))) return { migrated: false };

  renameSync(legacy, home); // move the whole home (atomic on same filesystem)

  rewriteTraceRefs(home);
  rewriteGitignore(root);
  scrubLegacyDenies(root);
  // derived index: drop, it rebuilds on the next recall/reindex
  try { rmSync(join(home, 'knowledge', '.index.db'), { force: true }); } catch { /* fail-soft */ }
  return { migrated: true };
}

/** sessions.json stores repo-relative traceRefs (`agent/.traces/…`) — re-point them. */
function rewriteTraceRefs(home) {
  const index = join(home, 'sessions.json');
  if (!existsSync(index)) return;
  try {
    const idx = JSON.parse(readFileSync(index, 'utf8'));
    for (const s of idx.sessions || []) {
      if (typeof s.traceRef === 'string' && s.traceRef.startsWith('agent/')) {
        s.traceRef = '.zuzuu/' + s.traceRef.slice('agent/'.length);
      }
    }
    writeFileSync(index, JSON.stringify(idx, null, 2) + '\n');
  } catch { /* fail-soft: a bad index never blocks the move */ }
}

/** Drop legacy `agent/` ignore lines, then append the canonical .zuzuu/ ones. */
function rewriteGitignore(root) {
  const path = join(root, '.gitignore');
  if (existsSync(path)) {
    const kept = readFileSync(path, 'utf8')
      .split('\n')
      .filter((l) => !l.trim().startsWith('agent/'))
      .join('\n');
    writeFileSync(path, kept.endsWith('\n') || kept === '' ? kept : kept + '\n');
  }
  ensureGitignore(root); // appends .zuzuu/.traces/, .zuzuu/.live/, .zuzuu/knowledge/.index.db
}

/** Swap the old agent/ deny rules for the .zuzuu/ pair in any .claude settings file. */
function scrubLegacyDenies(root) {
  for (const f of ['settings.json', 'settings.local.json']) {
    const path = join(root, '.claude', f);
    if (!existsSync(path)) continue;
    try {
      const s = JSON.parse(readFileSync(path, 'utf8'));
      const deny = s?.permissions?.deny;
      if (!Array.isArray(deny)) continue;
      const hadOurs = deny.some((r) => LEGACY_DENY_RULES.includes(r));
      if (!hadOurs) continue;
      s.permissions.deny = deny.filter((r) => !LEGACY_DENY_RULES.includes(r));
      for (const rule of NEW_DENY_RULES) if (!s.permissions.deny.includes(rule)) s.permissions.deny.push(rule);
      writeFileSync(path, JSON.stringify(s, null, 2) + '\n');
    } catch { /* fail-soft: never break settings we can't parse */ }
  }
}

/** Re-inject the current faculties block into any existing host instruction files. */
export function reinjectHostBlocks(root) {
  for (const f of ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md']) {
    const p = join(root, f);
    if (existsSync(p)) {
      const text = readFileSync(p, 'utf8');
      if (!text.includes(`zuzuu:faculties:v${BLOCK_VERSION}`)) writeFileSync(p, injectBlock(text));
    }
  }
}

