// zuzuu/commands/migrations/proposals.mjs — legacy proposal-schema migrator.
// {candidate, er} → spine {payload, analysis, module} (WS2-T5). Pure core:
// migrateProposals(agentDir) → { scanned, migrated, skipped }. Fail-soft per file.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { proposalsDir, archiveDir } from '../../module/contract.mjs';

/**
 * Determine whether a parsed JSON record is already in the new shape.
 * A record is "new" when it has `payload` AND `module` set.
 * If it only has `candidate` and/or lacks `module` it is legacy.
 */
function isLegacy(rec) {
  if (!rec || typeof rec !== 'object') return false;
  // already migrated: has payload and module
  if (rec.payload !== undefined && rec.module !== undefined) return false;
  // legacy if it has candidate or er keys, or is simply missing module/payload
  return rec.candidate !== undefined || rec.er !== undefined || rec.module === undefined;
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

  // module defaults to 'knowledge' (only knowledge proposals exist pre-spine)
  if (!out.module) out.module = 'knowledge';

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

