// tests/unit/migrate-generations.test.mjs — W2.5 Phase 2: the global→per-module
// generation migrator. Seeds a REAL old-shape home (a global generations/ dir
// with a lockfile pinning items per module + snapshot bytes carrying `faculty:`
// frontmatter), migrates, then asserts:
//   • per-module gen_001 from the SAME snapshot bytes, faculty:→module: rewritten
//   • a checkpoint cp_001 pinning every migrated module → gen_001
//   • the old global generations/ dir is gone
//   • a per-module rollback round-trips byte-exact (parser-valid items)
// Idempotent + fail-soft.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { migrateGenerations, needsGenerationsMigration } from '../../zuzuu/commands/migrations/generations.mjs';
import {
  listModuleGenerations, readModuleGeneration, activeModuleGeneration,
} from '../../zuzuu/module/generation/read.mjs';
import { rollbackModule } from '../../zuzuu/module/generation/write.mjs';
import { readCheckpoint, rollbackCheckpoint } from '../../zuzuu/module/generation/checkpoint.mjs';
import { parseEnvelope } from '../../zuzuu/module/envelope.mjs';

// Old-shape snapshot bytes still carry the legacy `faculty:` envelope key.
const OLD_K = `---\nid: fact-a\nfaculty: knowledge\nkind: fact\nstatus: active\n---\nA fact.\n`;
const OLD_G = `---\nid: no-wipe\nfaculty: guardrails\nkind: rule\nstatus: active\n---\nNo wipe.\n`;

function seedGlobalGenHome() {
  const dir = mkdtempSync(join(tmpdir(), 'zz-genmig-'));
  const home = join(dir, '.zuzuu');
  // live items (post faculty→module rename — module: key)
  mkdirSync(join(home, 'knowledge', 'items'), { recursive: true });
  mkdirSync(join(home, 'guardrails', 'items'), { recursive: true });
  writeFileSync(join(home, 'knowledge', 'items', 'fact-a.md'), OLD_K.replace('faculty:', 'module:'));
  writeFileSync(join(home, 'guardrails', 'items', 'no-wipe.md'), OLD_G.replace('faculty:', 'module:'));
  // OLD global generation: lockfile + snapshots (bytes still faculty:-keyed) + active
  const gdir = join(home, 'generations');
  mkdirSync(join(gdir, 'snapshots', 'gen_001', 'knowledge'), { recursive: true });
  mkdirSync(join(gdir, 'snapshots', 'gen_001', 'guardrails'), { recursive: true });
  writeFileSync(join(gdir, 'snapshots', 'gen_001', 'knowledge', 'fact-a.md'), OLD_K);
  writeFileSync(join(gdir, 'snapshots', 'gen_001', 'guardrails', 'no-wipe.md'), OLD_G);
  writeFileSync(join(gdir, 'gen_001.json'), JSON.stringify({
    id: 'gen_001', agent: 'agt_test', mintedAt: '2026-06-12T00:00:00Z', forkedFrom: null,
    mintedFrom: ['p1'],
    modules: {
      knowledge: { items: [{ id: 'fact-a', hash: 'kh' }], registryHash: 'rh' },
      guardrails: { items: [{ id: 'no-wipe', hash: 'gh' }] },
      actions: { items: [] },
      memory: { items: [] },
      instructions: { items: [] },
    },
  }, null, 2) + '\n');
  writeFileSync(join(gdir, 'active'), JSON.stringify({ active: 'gen_001' }, null, 2) + '\n');
  return { dir, home };
}

test('needsGenerationsMigration detects a global generations/ with a lockfile', () => {
  const { dir, home } = seedGlobalGenHome();
  try { assert.equal(needsGenerationsMigration(home), true); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test('migrateGenerations creates per-module gen_001 + a checkpoint, removes the global dir', () => {
  const { dir, home } = seedGlobalGenHome();
  try {
    const r = migrateGenerations(home);
    assert.equal(r.errors.length, 0, 'no errors');
    assert.equal(r.migrated, true);
    assert.equal(r.removedGlobal, true);
    assert.equal(r.checkpoint, 'cp_001');

    // only the modules the global gen pinned with items get a per-module gen
    const byModule = Object.fromEntries(r.modules.map((m) => [m.module, m]));
    assert.equal(byModule.knowledge.generation, 'gen_001');
    assert.equal(byModule.knowledge.items, 1);
    assert.equal(byModule.guardrails.items, 1);

    // per-module lockfiles + actives
    assert.deepEqual(listModuleGenerations(home, 'knowledge'), ['gen_001']);
    assert.equal(activeModuleGeneration(home, 'knowledge'), 'gen_001');
    assert.equal(activeModuleGeneration(home, 'guardrails'), 'gen_001');
    const klock = readModuleGeneration(home, 'knowledge', 'gen_001');
    assert.equal(klock.module, 'knowledge');
    assert.deepEqual(klock.items, [{ id: 'fact-a', hash: 'kh' }]);

    // snapshot bytes were rewritten faculty: → module: (parser-valid)
    const snap = readFileSync(join(home, 'knowledge', 'generations', 'snapshots', 'gen_001', 'fact-a.md'), 'utf8');
    assert.match(snap, /^module: knowledge$/m);
    assert.doesNotMatch(snap, /^faculty:/m);
    assert.equal(parseEnvelope(snap).ok, true, 'migrated snapshot parses');

    // checkpoint pins both modules
    const cp = readCheckpoint(home, 'cp_001');
    assert.equal(cp.pins.knowledge, 'gen_001');
    assert.equal(cp.pins.guardrails, 'gen_001');
    assert.match(cp.label, /migrated from gen_001/);

    // old global dir gone
    assert.equal(existsSync(join(home, 'generations')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a migrated home rolls back per-module to parser-valid bytes', () => {
  const { dir, home } = seedGlobalGenHome();
  try {
    migrateGenerations(home);
    // mutate the live item, then roll back to gen_001
    const live = join(home, 'knowledge', 'items', 'fact-a.md');
    writeFileSync(live, '---\nid: fact-a\nmodule: knowledge\nkind: fact\n---\nMUTATED.\n');
    const r = rollbackModule(home, 'knowledge', 'gen_001');
    assert.equal(r.ok, true);
    assert.equal(r.restored, 1);
    const restored = readFileSync(live, 'utf8');
    assert.match(restored, /^module: knowledge$/m, 'restored bytes are module:-keyed');
    assert.equal(parseEnvelope(restored).ok, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('checkpoint rollback restores every migrated module', () => {
  const { dir, home } = seedGlobalGenHome();
  try {
    migrateGenerations(home);
    const kLive = join(home, 'knowledge', 'items', 'fact-a.md');
    const gLive = join(home, 'guardrails', 'items', 'no-wipe.md');
    const kOrig = readFileSync(kLive, 'utf8');
    const gOrig = readFileSync(gLive, 'utf8');
    writeFileSync(kLive, '---\nid: fact-a\nmodule: knowledge\n---\nX\n');
    writeFileSync(gLive, '---\nid: no-wipe\nmodule: guardrails\n---\nY\n');
    const r = rollbackCheckpoint(home, 'cp_001');
    assert.equal(r.ok, true);
    assert.equal(readFileSync(kLive, 'utf8'), kOrig);
    assert.equal(readFileSync(gLive, 'utf8'), gOrig);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('migrateGenerations is idempotent — a per-module home needs no further migration', () => {
  const { dir, home } = seedGlobalGenHome();
  try {
    migrateGenerations(home);
    assert.equal(needsGenerationsMigration(home), false, 'no global dir remains');
    const r2 = migrateGenerations(home);
    assert.equal(r2.migrated, false, 'second run is a no-op');
    assert.equal(r2.modules.length, 0);
    assert.equal(r2.errors.length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('fail-soft: a corrupt global lockfile leaves the old dir in place, never crashes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zz-genmig-bad-'));
  const home = join(dir, '.zuzuu');
  const gdir = join(home, 'generations');
  mkdirSync(gdir, { recursive: true });
  try {
    writeFileSync(join(gdir, 'gen_001.json'), '{ not valid json');
    writeFileSync(join(gdir, 'active'), JSON.stringify({ active: 'gen_001' }));
    const r = migrateGenerations(home);
    assert.ok(r.errors.length >= 1, 'reports the corrupt lockfile');
    assert.equal(r.removedGlobal, false, 'old dir kept for the human');
    assert.equal(existsSync(gdir), true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('re-completes a partial run: a bare <module>/generations/ dir with no lockfile is redone', () => {
  const { dir, home } = seedGlobalGenHome();
  try {
    // simulate a prior partial run: knowledge has a generations/ dir but NO lockfile
    mkdirSync(join(home, 'knowledge', 'generations', 'snapshots', 'gen_001'), { recursive: true });
    const r = migrateGenerations(home);
    assert.equal(r.errors.length, 0);
    // knowledge gen_001 lockfile now exists (completion), and is pinned
    assert.ok(readModuleGeneration(home, 'knowledge', 'gen_001'), 'incomplete knowledge re-completed');
    const cp = readCheckpoint(home, 'cp_001');
    assert.equal(cp.pins.knowledge, 'gen_001');
    assert.equal(existsSync(join(home, 'generations')), false, 'global dir removed');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a partial snapshot copy throws → global dir kept, module unpinned, error reported', () => {
  const { dir, home } = seedGlobalGenHome();
  try {
    // Force a copy failure for the guardrails module: pre-create a READ-ONLY
    // FILE where the snapshot destination DIR must be written, so mkdirSync
    // (and the file write) for no-wipe.md fails inside copySnapshotTree.
    const destSnap = join(home, 'guardrails', 'generations', 'snapshots', 'gen_001');
    mkdirSync(dirname(destSnap), { recursive: true });
    // a regular file blocking the snapshot dir path → mkdirSync throws ENOTDIR/EEXIST
    writeFileSync(destSnap, 'I am a file, not a dir');

    const r = migrateGenerations(home);
    assert.ok(r.errors.length >= 1, 'the partial copy is reported as an error');
    assert.equal(r.removedGlobal, false, 'the old global dir is PRESERVED (only complete copy)');
    assert.equal(existsSync(join(home, 'generations')), true, 'global dir still on disk');
    // guardrails must NOT be pinned (its snapshot is incomplete)
    assert.equal(activeModuleGeneration(home, 'guardrails'), null, 'failed module not pinned');
    assert.equal(existsSync(join(home, 'guardrails', 'generations', 'gen_001.json')), false, 'no lockfile for failed module');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('re-run after a partial RE-COPIES the failed module and only then removes the global dir', () => {
  const { dir, home } = seedGlobalGenHome();
  try {
    // First run: block guardrails snapshot dest → partial.
    const destSnap = join(home, 'guardrails', 'generations', 'snapshots', 'gen_001');
    mkdirSync(dirname(destSnap), { recursive: true });
    writeFileSync(destSnap, 'blocker');
    const r1 = migrateGenerations(home);
    assert.ok(r1.errors.length >= 1);
    assert.equal(r1.removedGlobal, false);
    assert.equal(existsSync(join(home, 'guardrails', 'generations', 'gen_001.json')), false);

    // Clear the blocker (the human un-sticks it), re-run.
    rmSync(destSnap, { force: true });
    const r2 = migrateGenerations(home);
    assert.equal(r2.errors.length, 0, 'clean second run');
    // guardrails was RE-COPIED (not skipped) — its lockfile + snapshot now exist
    assert.ok(readModuleGeneration(home, 'guardrails', 'gen_001'), 'failed module re-completed');
    assert.ok(existsSync(join(home, 'guardrails', 'generations', 'snapshots', 'gen_001', 'no-wipe.md')), 'snapshot bytes re-copied');
    // only NOW is the global dir removed (all modules complete)
    assert.equal(r2.removedGlobal, true);
    assert.equal(existsSync(join(home, 'generations')), false, 'global dir removed once everything is complete');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('no global generations/ → migrateGenerations is a clean no-op', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zz-genmig-clean-'));
  const home = join(dir, '.zuzuu');
  mkdirSync(join(home, 'knowledge', 'items'), { recursive: true });
  try {
    assert.equal(needsGenerationsMigration(home), false);
    const r = migrateGenerations(home);
    assert.equal(r.migrated, false);
    assert.equal(r.modules.length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
