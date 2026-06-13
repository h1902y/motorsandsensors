// zuzuu/commands/migrations/modules.mjs — the faculty→module noun migrator
// (W2.5, 2026-06-13). The 2026-06-13 rename made `module` the abstract noun for
// what used to be a "faculty": the envelope key, the manifest filename, the
// proposal field, the generation lockfile section. The five module IDs
// (knowledge/memory/actions/instructions/guardrails) DID NOT change — only the
// noun. This migrator rewrites an EXISTING home from the old shape to the new:
//
//   • <module>/**/*.md  envelope frontmatter `faculty:` → `module:`
//   • <module>/faculty.json → module.json (self `faculty`/`id` field preserved)
//   • <module>/proposals/**.json  `"faculty"` key → `"module"`
//   • generations/*.json lockfiles  `"faculties"` section → `"modules"`
//   • seeds any missing <module>/module.json
//
// Idempotent (a home already on the new shape is a no-op), fail-soft per file
// (an unconvertible file is reported, never fatal; its source is left in place),
// and detection-gated (only fires when the old shape is present). Auto-runs from
// `zuzuu init` after the home/items migrators in the same chain.

import { existsSync, readdirSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { MODULES } from '../../module/contract.mjs';
import { BUILTIN_MODULES } from '../../module/registry.mjs';

/** Rewrite a leading-frontmatter `faculty:` key → `module:` (first match only,
 *  inside the `---` block). Returns null when there's nothing to change. */
function rewriteEnvelopeKey(text) {
  const m = String(text).match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
  if (!m) return null;
  const [, open, fm, close] = m;
  if (!/^faculty:/m.test(fm)) return null;
  const newFm = fm.replace(/^faculty:/m, 'module:');
  return open + newFm + close + text.slice(open.length + fm.length + close.length);
}

/** Walk a dir tree, applying `fn(absPath)` to every *.md / *.json file. */
function walk(dir, exts, fn) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = join(dir, e.name);
    let isDir = e.isDirectory();
    if (!isDir && !e.isFile()) { try { isDir = statSync(p).isDirectory(); } catch { continue; } }
    if (isDir) { walk(p, exts, fn); continue; }
    if (exts.some((x) => e.name.endsWith(x))) fn(p);
  }
}

/** Rewrite every envelope *.md under a module dir: `faculty:` → `module:`. */
function migrateEnvelopes(moduleDir, out) {
  walk(moduleDir, ['.md'], (path) => {
    try {
      const text = readFileSync(path, 'utf8');
      const next = rewriteEnvelopeKey(text);
      if (next == null || next === text) return; // already module: (or no frontmatter)
      writeFileSync(path, next);
      out.items++;
    } catch (e) {
      out.errors.push({ file: path, error: e.message });
    }
  });
}

/** Rewrite proposal JSON files: top-level `"faculty"` → `"module"`. */
function migrateProposalField(moduleDir, out) {
  for (const sub of ['proposals', 'inbox']) {
    walk(join(moduleDir, sub), ['.json'], (path) => {
      try {
        const raw = readFileSync(path, 'utf8');
        let data;
        try { data = JSON.parse(raw); } catch { return; } // not our shape — leave it
        if (data == null || typeof data !== 'object' || !('faculty' in data) || 'module' in data) return;
        data.module = data.faculty;
        delete data.faculty;
        writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
        out.proposals++;
      } catch (e) {
        out.errors.push({ file: path, error: e.message });
      }
    });
  }
}

/** Rename <module>/faculty.json → module.json (rewriting a self `faculty` field
 *  to `module` if one is present). Never clobbers an existing module.json. */
function migrateManifest(moduleDir, out) {
  const oldP = join(moduleDir, 'faculty.json');
  const newP = join(moduleDir, 'module.json');
  if (!existsSync(oldP) || existsSync(newP)) return;
  try {
    let text = readFileSync(oldP, 'utf8');
    try {
      const data = JSON.parse(text);
      if (data && typeof data === 'object' && 'faculty' in data && !('module' in data)) {
        data.module = data.faculty;
        delete data.faculty;
        text = JSON.stringify(data, null, 2) + '\n';
      }
    } catch { /* unparseable manifest — move bytes verbatim, never destroy */ }
    writeFileSync(newP, text);
    // remove the old file only after the new one landed (fail-soft)
    try { rmSync(oldP, { force: true }); } catch { /* leave it for the human */ }
    out.manifests++;
  } catch (e) {
    out.errors.push({ file: oldP, error: e.message });
  }
}

/** Seed a missing <module>/module.json from the built-in manifest. */
function seedMissingManifest(moduleDir, id, out) {
  const newP = join(moduleDir, 'module.json');
  if (existsSync(newP) || existsSync(join(moduleDir, 'faculty.json'))) return;
  try {
    writeFileSync(newP, JSON.stringify(BUILTIN_MODULES[id]?.manifest ?? { id }, null, 2) + '\n');
    out.seeded++;
  } catch (e) {
    out.errors.push({ file: newP, error: e.message });
  }
}

/** Generation lockfiles: rename the `"faculties"` section → `"modules"`. */
function migrateGenerations(agentDir, out) {
  const gensDir = join(agentDir, 'generations');
  walk(gensDir, ['.json'], (path) => {
    // only top-level lockfiles, not snapshot item bytes
    if (path.includes(`${join(gensDir, 'snapshots')}`)) return;
    try {
      const raw = readFileSync(path, 'utf8');
      let data;
      try { data = JSON.parse(raw); } catch { return; }
      if (data == null || typeof data !== 'object' || !('faculties' in data) || 'modules' in data) return;
      // preserve key order: rebuild with `modules` where `faculties` sat
      const next = {};
      for (const [k, v] of Object.entries(data)) next[k === 'faculties' ? 'modules' : k] = v;
      writeFileSync(path, JSON.stringify(next, null, 2) + '\n');
      out.generations++;
    } catch (e) {
      out.errors.push({ file: path, error: e.message });
    }
  });
}

/**
 * Is the old (faculty-shaped) shape present anywhere in this home? Cheap checks
 * gate the init auto-run and the porcelain summary. Returns true if ANY:
 *   a legacy faculty.json · an envelope with a `faculty:` key · a proposal with
 *   a `"faculty"` field · a generation lockfile with a `"faculties"` section.
 */
export function needsModulesMigration(agentDir) {
  if (!existsSync(agentDir)) return false;
  for (const id of MODULES) {
    const dir = join(agentDir, id);
    if (existsSync(join(dir, 'faculty.json'))) return true;
    let found = false;
    walk(dir, ['.md'], (path) => {
      if (found) return;
      try {
        const m = readFileSync(path, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (m && /^faculty:/m.test(m[1])) found = true;
      } catch { /* unreadable never forces */ }
    });
    if (found) return true;
    walk(join(dir, 'proposals'), ['.json'], (path) => {
      if (found) return;
      try { if ('faculty' in JSON.parse(readFileSync(path, 'utf8'))) found = true; } catch { /* skip */ }
    });
    if (found) return true;
  }
  let genFound = false;
  walk(join(agentDir, 'generations'), ['.json'], (path) => {
    if (genFound || path.includes(join(agentDir, 'generations', 'snapshots'))) return;
    try { if ('faculties' in JSON.parse(readFileSync(path, 'utf8'))) genFound = true; } catch { /* skip */ }
  });
  return genFound;
}

/**
 * One-shot faculty→module migration for a home. Idempotent + fail-soft per file.
 * @returns {{items:number, manifests:number, proposals:number, generations:number,
 *            seeded:number, errors:Array<{file,error}>}}
 */
export function migrateModules(agentDir) {
  const out = { items: 0, manifests: 0, proposals: 0, generations: 0, seeded: 0, errors: [] };
  for (const id of MODULES) {
    const dir = join(agentDir, id);
    if (!existsSync(dir)) continue;
    migrateEnvelopes(dir, out);
    migrateProposalField(dir, out);
    migrateManifest(dir, out);
    seedMissingManifest(dir, id, out);
  }
  // declarative (non-built-in) module folders carrying a faculty.json too
  try {
    for (const e of readdirSync(agentDir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name.startsWith('_')) continue;
      if (MODULES.includes(e.name) || e.name === 'generations') continue;
      const dir = join(agentDir, e.name);
      if (!existsSync(join(dir, 'faculty.json'))) continue;
      migrateEnvelopes(dir, out);
      migrateProposalField(dir, out);
      migrateManifest(dir, out);
    }
  } catch { /* no home dir → nothing */ }
  migrateGenerations(agentDir, out);
  return out;
}
