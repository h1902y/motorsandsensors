// mns/commands/migrate.mjs
// `mns migrate` — one-time proposal schema migrator (WS2-T5).
//
// Tidies on-disk legacy Knowledge proposals from the old {candidate, er} shape
// to the unified spine shape {payload, analysis, faculty}.  The spine already
// dual-reads both formats; this migrator exists so on-disk records are clean.
//
// Pure core:   migrateProposals(mnsDir) → { scanned, migrated, skipped }
// CLI surface: migrate(args) — resolves mnsDir, runs core, prints summary.

import { existsSync, readdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { paths, repoRoot } from '../store.mjs';
import { proposalsDir, archiveDir } from '../faculty/contract.mjs';
import { ensureGitignore } from '../scaffold.mjs';
import { injectBlock, BLOCK_VERSION } from '../inject.mjs';
import { enable } from './enable.mjs';

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
export function migrateProposals(mnsDir) {
  const pending = migrateDir(proposalsDir(mnsDir, 'knowledge'));
  const archived = migrateDir(archiveDir(mnsDir, 'knowledge'));

  return {
    scanned: pending.scanned + archived.scanned,
    migrated: pending.migrated + archived.migrated,
    skipped: pending.skipped + archived.skipped,
  };
}

// ---------------------------------------------------------------------------
// CLI surface
// ---------------------------------------------------------------------------

/**
 * One-shot HOME migration: legacy hidden `.mns/` → visible `agent/` with
 * dot-prefixed internals (traces→.traces, live→.live, knowledge/index.db→
 * knowledge/.index.db) and mns.json→agent.json. Idempotent + fail-open; NEVER
 * clobbers an existing agent/. Pure FS move (renameSync, git-native).
 * @returns {{migrated: boolean}}
 */
export function migrateHome(root = repoRoot()) {
  const legacy = join(root, '.mns');
  const agent = join(root, 'agent');
  if (existsSync(agent) || !existsSync(legacy)) return { migrated: false };

  renameSync(legacy, agent); // move the whole home (atomic on same filesystem)

  const mv = (from, to) => {
    const f = join(agent, from), t = join(agent, to);
    if (existsSync(f) && !existsSync(t)) renameSync(f, t);
  };
  mv('traces', '.traces');
  mv('live', '.live');
  mv('mns.json', 'agent.json');
  mv(join('knowledge', 'index.db'), join('knowledge', '.index.db'));

  rewriteGitignore(root);
  return { migrated: true };
}

/** Drop legacy `.mns/` ignore lines, then append the canonical agent/ ones. */
function rewriteGitignore(root) {
  const path = join(root, '.gitignore');
  if (existsSync(path)) {
    const kept = readFileSync(path, 'utf8')
      .split('\n')
      .filter((l) => !l.trim().startsWith('.mns/'))
      .join('\n');
    writeFileSync(path, kept.endsWith('\n') || kept === '' ? kept : kept + '\n');
  }
  ensureGitignore(root); // appends agent/.traces/, agent/.live/, agent/knowledge/.index.db
}

export function migrate(args = {}) {
  if (args.home) {
    const root = repoRoot(process.cwd());
    const { migrated } = migrateHome(root);
    if (!migrated) { console.log('migrate --home: nothing to do (already agent/ or no legacy .mns/)'); return; }
    // re-inject the v7 block into host files + re-enable to rewrite host deny rules
    try { reinjectHostBlocks(root); } catch { /* fail-open */ }
    try { enable({ host: 'opencode', quiet: true, cwd: root }); } catch { /* fail-open */ }
    console.log('migrate --home: .mns/ → agent/ (internals dot-prefixed, block v7, deny rules rewritten)');
    return;
  }
  const mnsDir = paths().dir;
  const { scanned, migrated, skipped } = migrateProposals(mnsDir);
  console.log(`migrate: scanned ${scanned} proposal(s) — migrated ${migrated}, skipped ${skipped}`);
  if (migrated > 0) {
    console.log('  legacy candidate/er keys rewritten to payload/analysis.er + faculty:knowledge');
  } else {
    console.log('  nothing to migrate (all records already in new shape)');
  }
}

/** Re-inject the current faculties block into any existing host instruction files. */
function reinjectHostBlocks(root) {
  for (const f of ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md']) {
    const p = join(root, f);
    if (existsSync(p)) {
      const text = readFileSync(p, 'utf8');
      if (!text.includes(`mns:faculties:v${BLOCK_VERSION}`)) writeFileSync(p, injectBlock(text));
    }
  }
}
