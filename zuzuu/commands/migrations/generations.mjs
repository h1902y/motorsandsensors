// zuzuu/commands/migrations/generations.mjs — the global→per-module generation
// migrator (W2.5 Phase 2, 2026-06-13). Generations went modular: each module
// owns its own lineage and a *checkpoint* composes them. This migrator rewrites
// an EXISTING home from the OLD global shape to the new per-module shape:
//
//   OLD: .zuzuu/generations/<id>.json       global lockfile {modules:{<m>:{items}}}
//        .zuzuu/generations/snapshots/<id>/<m>/…  item bytes
//        .zuzuu/generations/active           {active}
//   NEW: .zuzuu/<m>/generations/gen_001.json  per-module lockfile {items}
//        .zuzuu/<m>/generations/snapshots/gen_001/…  item bytes (faculty:→module:)
//        .zuzuu/<m>/generations/active        {active: gen_001}
//        .zuzuu/checkpoints/cp_001.json       {pins:{<m>: gen_001}}
//
// For each module the ACTIVE global generation pinned, we create that module's
// gen_001 from the SAME snapshot bytes, rewriting any `faculty:` frontmatter to
// `module:` so a future rollback restores parser-valid items (the Phase-1
// rename consequence). Then one checkpoint cp_001 pins every migrated module.
// The old global generations/ dir is removed only AFTER everything landed.
//
// Idempotent (a home already per-module — no global generations/ — is a no-op),
// fail-soft per file, detection-gated. Auto-runs from `zuzuu init` after the
// faculty→module migrator in the same chain.

import {
  existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, statSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { MODULES } from '../../module/contract.mjs';

const writeJson = (p, obj) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
};
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

/** Rewrite a leading-frontmatter `faculty:` key → `module:` (idempotent). Returns
 *  the input unchanged when there's no such key. */
function rewriteEnvelopeKey(text) {
  const m = String(text).match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
  if (!m) return text;
  const [, open, fm, close] = m;
  if (!/^faculty:/m.test(fm)) return text;
  return open + fm.replace(/^faculty:/m, 'module:') + close + text.slice(open.length + fm.length + close.length);
}

/** Recursively copy a snapshot subtree, rewriting *.md `faculty:`→`module:`. */
function copySnapshotTree(srcDir, destDir, out) {
  let entries;
  try { entries = readdirSync(srcDir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const src = join(srcDir, e.name);
    const dest = join(destDir, e.name);
    let isDir = e.isDirectory();
    if (!isDir && !e.isFile()) { try { isDir = statSync(src).isDirectory(); } catch { continue; } }
    if (isDir) { copySnapshotTree(src, dest, out); continue; }
    try {
      mkdirSync(dirname(dest), { recursive: true });
      if (e.name.endsWith('.md')) {
        writeFileSync(dest, rewriteEnvelopeKey(readFileSync(src, 'utf8')));
      } else {
        writeFileSync(dest, readFileSync(src)); // byte-exact for non-envelope bytes
      }
    } catch (err) {
      out.errors.push({ file: src, error: err.message });
    }
  }
}

const globalGenerationsDir = (agentDir) => join(agentDir, 'generations');

/** Detect the OLD global-generation shape: a generations/ dir holding gen_NNN
 *  lockfiles AT THE HOME ROOT (not under a module). Per-module homes have no
 *  such top-level dir. */
export function needsGenerationsMigration(agentDir) {
  if (!existsSync(agentDir)) return false;
  const gdir = globalGenerationsDir(agentDir);
  if (!existsSync(gdir)) return false;
  try {
    return readdirSync(gdir).some((f) => /^gen_\d+\.json$/.test(f));
  } catch { return false; }
}

/**
 * One-shot global→per-module generation migration. Idempotent + fail-soft.
 * @returns {{ migrated: boolean, modules: Array<{module:string, generation:string, items:number}>,
 *             checkpoint: string|null, removedGlobal: boolean, errors: Array<{file,error}> }}
 */
export function migrateGenerations(agentDir) {
  const out = { migrated: false, modules: [], checkpoint: null, removedGlobal: false, errors: [] };
  const gdir = globalGenerationsDir(agentDir);
  if (!needsGenerationsMigration(agentDir)) return out;

  // 1) resolve the ACTIVE global generation (fall back to the highest gen_NNN).
  let activeId = null;
  try { activeId = readJson(join(gdir, 'active')).active ?? null; } catch { /* no active pointer */ }
  let lockfileIds;
  try {
    lockfileIds = readdirSync(gdir).filter((f) => /^gen_\d+\.json$/.test(f)).map((f) => f.replace(/\.json$/, '')).sort();
  } catch (e) { out.errors.push({ file: gdir, error: e.message }); return out; }
  if (!lockfileIds.length) return out;
  if (!activeId || !lockfileIds.includes(activeId)) activeId = lockfileIds[lockfileIds.length - 1];

  let lockfile;
  try { lockfile = readJson(join(gdir, `${activeId}.json`)); }
  catch (e) { out.errors.push({ file: join(gdir, `${activeId}.json`), error: e.message }); return out; }

  const snapBase = join(gdir, 'snapshots', activeId);
  const agent = lockfile.agent ?? null;
  const mintedFrom = Array.isArray(lockfile.mintedFrom) ? lockfile.mintedFrom : [];
  const mintedAt = lockfile.mintedAt ?? new Date().toISOString();
  const pins = {};

  // 2) per module the global gen pinned → that module's gen_001.
  const sections = lockfile.modules || {};
  for (const module of MODULES) {
    const sec = sections[module];
    if (!sec) continue; // module not pinned by the global gen → no per-module gen
    // Idempotency / partial-re-run: the lockfile is the COMPLETION marker. If a
    // gen_001.json already exists, this module is done — just pin it (don't
    // re-copy). A bare generations/ dir with no lockfile is an incomplete prior
    // run → fall through and (re)complete it; writeJson overwrites cleanly.
    if (existsSync(join(agentDir, module, 'generations', 'gen_001.json'))) {
      pins[module] = 'gen_001';
      continue;
    }
    const items = Array.isArray(sec.items) ? sec.items.map(({ id, hash }) => ({ id, hash })) : [];
    const perModuleLock = {
      id: 'gen_001',
      module,
      ...(agent ? { agent } : {}),
      mintedAt,
      forkedFrom: null,
      mintedFrom,
      items,
    };
    try {
      // copy this module's snapshot bytes (faculty:→module:) into the per-module snapshot
      const srcModuleSnap = join(snapBase, module);
      if (existsSync(srcModuleSnap)) {
        copySnapshotTree(srcModuleSnap, join(agentDir, module, 'generations', 'snapshots', 'gen_001'), out);
      } else {
        mkdirSync(join(agentDir, module, 'generations', 'snapshots', 'gen_001'), { recursive: true });
      }
      writeJson(join(agentDir, module, 'generations', 'gen_001.json'), perModuleLock);
      writeJson(join(agentDir, module, 'generations', 'active'), { active: 'gen_001' });
      pins[module] = 'gen_001';
      out.modules.push({ module, generation: 'gen_001', items: items.length });
    } catch (err) {
      out.errors.push({ file: join(agentDir, module, 'generations', 'gen_001.json'), error: err.message });
    }
  }

  // 3) one checkpoint cp_001 pinning each migrated module → gen_001.
  if (Object.keys(pins).length) {
    try {
      const cpDir = join(agentDir, 'checkpoints');
      // don't clobber an existing cp_001
      const cpId = existsSync(join(cpDir, 'cp_001.json')) ? null : 'cp_001';
      if (cpId) {
        writeJson(join(cpDir, `${cpId}.json`), {
          id: cpId,
          createdAt: mintedAt,
          label: `migrated from ${activeId}`,
          pins,
        });
        out.checkpoint = cpId;
      }
    } catch (err) {
      out.errors.push({ file: join(agentDir, 'checkpoints', 'cp_001.json'), error: err.message });
    }
  }

  // 4) remove the old global generations/ dir — ONLY after everything landed and
  //    no per-module write errored (fail-soft: leave it for the human otherwise).
  if (!out.errors.length) {
    try { rmSync(gdir, { recursive: true, force: true }); out.removedGlobal = true; }
    catch (err) { out.errors.push({ file: gdir, error: err.message }); }
  }

  out.migrated = out.modules.length > 0 || out.removedGlobal;
  return out;
}
