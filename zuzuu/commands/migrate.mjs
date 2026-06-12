// zuzuu/commands/migrate.mjs
// `zuzuu migrate` — one-time migrators.
//
//   (default)  proposal schema: legacy {candidate, er} → spine {payload, analysis, faculty} (WS2-T5)
//   --home     faculty home: visible agent/ → hidden .zuzuu/ (W1, 2026-06-12)
//
// Pure cores:  migrateProposals(agentDir) → { scanned, migrated, skipped }
//              migrateHome(root) → { migrated }
// CLI surface: migrate(args) — resolves paths, runs the core, prints summary.

import { existsSync, readdirSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { paths, repoRoot } from '../store.mjs';
import { proposalsDir, archiveDir } from '../faculty/contract.mjs';
import { ensureGitignore } from '../scaffold.mjs';
import { injectBlock, BLOCK_VERSION } from '../inject.mjs';

// ---------------------------------------------------------------------------
// pure core — testable without process.*
// ---------------------------------------------------------------------------

/**
 * Determine whether a parsed JSON record is already in the new shape.
 * A record is "new" when it has `payload` AND `faculty` set.
 * If it only has `candidate` and/or lacks `faculty` it is legacy.
 */
function isLegacy(rec) {
  if (!rec || typeof rec !== 'object') return false;
  // already migrated: has payload and faculty
  if (rec.payload !== undefined && rec.faculty !== undefined) return false;
  // legacy if it has candidate or er keys, or is simply missing faculty/payload
  return rec.candidate !== undefined || rec.er !== undefined || rec.faculty === undefined;
}

/**
 * Convert a legacy record to the new unified shape.
 * Returns the migrated record (caller writes it back).
 */
function migrateRecord(rec) {
  const out = { ...rec };

  // payload = candidate (drop candidate)
  if (out.candidate !== undefined) {
    if (out.payload === undefined) out.payload = out.candidate;
    delete out.candidate;
  }

  // analysis = { er } (drop er)
  if (out.er !== undefined) {
    if (out.analysis === undefined) out.analysis = { er: out.er };
    delete out.er;
  }

  // faculty defaults to 'knowledge' (only knowledge proposals exist pre-spine)
  if (!out.faculty) out.faculty = 'knowledge';

  return out;
}

/**
 * Scan one directory of *.json files and migrate legacy records in-place.
 * Fail-soft: bad JSON files are counted as skipped and never throw.
 * Returns { migrated, scanned, skipped } for this directory.
 */
function migrateDir(dir) {
  if (!existsSync(dir)) return { migrated: 0, scanned: 0, skipped: 0 };

  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  let migrated = 0;
  let skipped = 0;

  for (const file of files) {
    const fpath = join(dir, file);
    let rec;
    try {
      rec = JSON.parse(readFileSync(fpath, 'utf8'));
    } catch {
      skipped++;
      continue;
    }

    if (!isLegacy(rec)) {
      skipped++;
      continue;
    }

    try {
      const migrated_rec = migrateRecord(rec);
      writeFileSync(fpath, JSON.stringify(migrated_rec, null, 2) + '\n');
      migrated++;
    } catch {
      skipped++;
    }
  }

  return { migrated, scanned: files.length, skipped };
}

/**
 * Scan both pending and archived Knowledge proposals.
 * Returns { scanned, migrated, skipped }.
 */
export function migrateProposals(agentDir) {
  const pending = migrateDir(proposalsDir(agentDir, 'knowledge'));
  const archived = migrateDir(archiveDir(agentDir, 'knowledge'));

  return {
    scanned: pending.scanned + archived.scanned,
    migrated: pending.migrated + archived.migrated,
    skipped: pending.skipped + archived.skipped,
  };
}

// ---------------------------------------------------------------------------
// home migration — agent/ → .zuzuu/ (W1, 2026-06-12)
// ---------------------------------------------------------------------------

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
function reinjectHostBlocks(root) {
  for (const f of ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md']) {
    const p = join(root, f);
    if (existsSync(p)) {
      const text = readFileSync(p, 'utf8');
      if (!text.includes(`zuzuu:faculties:v${BLOCK_VERSION}`)) writeFileSync(p, injectBlock(text));
    }
  }
}

// ---------------------------------------------------------------------------
// CLI surface
// ---------------------------------------------------------------------------

export function migrate(args = {}) {
  if (args.home) {
    const root = repoRoot(process.cwd());
    const { migrated } = migrateHome(root);
    if (!migrated) { console.log('migrate --home: nothing to do (already .zuzuu/, or no zuzuu home at agent/)'); return; }
    try { reinjectHostBlocks(root); } catch { /* fail-open */ }
    console.log(`migrate --home: agent/ → .zuzuu/ (hidden, like .git; block v${BLOCK_VERSION}, gitignore + deny rules rewritten)`);
    console.log('  transparency lives in porcelain now: zuzuu status · explain · digest');
    return;
  }
  const agentDir = paths().dir;
  const { scanned, migrated, skipped } = migrateProposals(agentDir);
  console.log(`migrate: scanned ${scanned} proposal(s) — migrated ${migrated}, skipped ${skipped}`);
  if (migrated > 0) {
    console.log('  legacy candidate/er keys rewritten to payload/analysis.er + faculty:knowledge');
  } else {
    console.log('  nothing to migrate (all records already in new shape)');
  }
}
