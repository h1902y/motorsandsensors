// tests/unit/migrate-modules.test.mjs
// W2.5 — the faculty→module noun migrator. Seeds a REAL old-shape home (the
// `faculty:` envelope key, faculty.json manifests, a proposal `"faculty"` field,
// a generation lockfile `"faculties"` section), migrates, then asserts the new
// shape parses + the ids are untouched. Idempotent + fail-soft.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateModules, needsModulesMigration } from '../../zuzuu/commands/migrations/modules.mjs';
import { parseEnvelope } from '../../zuzuu/module/envelope.mjs';

// A real old-shape envelope (the legacy `faculty:` key).
const OLD_ITEM = `---
id: hot-file
faculty: knowledge
kind: entity
title: "A hot file"
status: active
created_at: 2026-06-12T10:47:29Z
---
A fact body.
`;

const OLD_MANIFEST = JSON.stringify({ id: 'knowledge', title: 'Knowledge', faculty: 'knowledge', version: '1.0.0' }, null, 2) + '\n';
const OLD_PROPOSAL = JSON.stringify({ id: 'p1', kind: 'item', status: 'pending', faculty: 'knowledge', payload: {} }, null, 2) + '\n';
const OLD_LOCKFILE = JSON.stringify({ id: 'gen_001', mintedAt: '2026-06-12T00:00:00Z', faculties: { knowledge: { items: [{ id: 'hot-file', hash: 'abc' }] } } }, null, 2) + '\n';

function seedOldHome() {
  const dir = mkdtempSync(join(tmpdir(), 'zz-modmig-'));
  const home = join(dir, '.zuzuu');
  for (const sub of ['knowledge/items', 'knowledge/proposals', 'generations']) mkdirSync(join(home, sub), { recursive: true });
  writeFileSync(join(home, 'knowledge', 'items', 'hot-file.md'), OLD_ITEM);
  writeFileSync(join(home, 'knowledge', 'faculty.json'), OLD_MANIFEST);
  writeFileSync(join(home, 'knowledge', 'proposals', 'p1.json'), OLD_PROPOSAL);
  writeFileSync(join(home, 'generations', 'gen_001.json'), OLD_LOCKFILE);
  return { dir, home };
}

test('needsModulesMigration detects every old-shape signal', () => {
  const { dir, home } = seedOldHome();
  try {
    assert.equal(needsModulesMigration(home), true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('migrateModules rewrites faculty → module across keys/manifest/proposal/lockfile', () => {
  const { dir, home } = seedOldHome();
  try {
    const r = migrateModules(home);
    assert.equal(r.items, 1, 'one envelope rewritten');
    assert.equal(r.manifests, 1, 'one manifest renamed');
    assert.equal(r.proposals, 1, 'one proposal field rewritten');
    assert.equal(r.generations, 1, 'one lockfile section renamed');
    assert.equal(r.errors.length, 0, 'no errors');

    // envelope: faculty: → module:, id untouched
    const itemText = readFileSync(join(home, 'knowledge', 'items', 'hot-file.md'), 'utf8');
    assert.match(itemText, /^module: knowledge$/m);
    assert.doesNotMatch(itemText, /^faculty:/m);
    const parsed = parseEnvelope(itemText);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.item.module, 'knowledge');
    assert.equal(parsed.item.id, 'hot-file', 'id is preserved');

    // manifest: faculty.json → module.json with self field rewritten
    assert.equal(existsSync(join(home, 'knowledge', 'faculty.json')), false, 'old manifest gone');
    const man = JSON.parse(readFileSync(join(home, 'knowledge', 'module.json'), 'utf8'));
    assert.equal(man.module, 'knowledge');
    assert.equal('faculty' in man, false);
    assert.equal(man.id, 'knowledge', 'id preserved');

    // proposal: "faculty" → "module"
    const prop = JSON.parse(readFileSync(join(home, 'knowledge', 'proposals', 'p1.json'), 'utf8'));
    assert.equal(prop.module, 'knowledge');
    assert.equal('faculty' in prop, false);

    // lockfile: "faculties" → "modules" (data intact, ids untouched)
    const lock = JSON.parse(readFileSync(join(home, 'generations', 'gen_001.json'), 'utf8'));
    assert.equal('faculties' in lock, false);
    assert.deepEqual(lock.modules.knowledge.items, [{ id: 'hot-file', hash: 'abc' }]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('migrateModules is idempotent — a migrated home needs no further migration', () => {
  const { dir, home } = seedOldHome();
  try {
    migrateModules(home);
    assert.equal(needsModulesMigration(home), false, 'no old shape remains');
    const r2 = migrateModules(home);
    assert.equal(r2.items + r2.manifests + r2.proposals + r2.generations, 0, 'second run is a no-op');
    assert.equal(r2.errors.length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('needsModulesMigration is false for a clean (module-shaped) home', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zz-modmig-clean-'));
  const home = join(dir, '.zuzuu');
  try {
    mkdirSync(join(home, 'knowledge', 'items'), { recursive: true });
    writeFileSync(join(home, 'knowledge', 'items', 'x.md'), OLD_ITEM.replace('faculty: knowledge', 'module: knowledge'));
    writeFileSync(join(home, 'knowledge', 'module.json'), JSON.stringify({ id: 'knowledge', module: 'knowledge' }, null, 2));
    assert.equal(needsModulesMigration(home), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
