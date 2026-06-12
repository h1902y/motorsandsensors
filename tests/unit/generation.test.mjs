import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  sha256,
  snapshotFaculties,
  agentId,
  ensureAgent,
  activeGeneration,
  listGenerations,
  readGeneration,
  mintGeneration,
  rollback,
  diffGenerations,
} from '../../zuzuu/faculty/generation.mjs';

// Build a minimal .mns home with a couple knowledge items + a rules.json.
function freshHome(fn) {
  const root = mkdtempSync(join(tmpdir(), 'mns-gen-'));
  const mnsDir = join(root, '.mns');
  mkdirSync(join(mnsDir, 'knowledge', 'items'), { recursive: true });
  mkdirSync(join(mnsDir, 'knowledge', 'registry'), { recursive: true });
  mkdirSync(join(mnsDir, 'guardrails'), { recursive: true });
  mkdirSync(join(mnsDir, 'generations', 'snapshots'), { recursive: true });
  writeFileSync(join(mnsDir, 'agent.json'), JSON.stringify({ version: 1, initializedAt: '2026-01-01T00:00:00.000Z', layout: [] }, null, 2) + '\n');
  writeFileSync(join(mnsDir, 'knowledge', 'items', 'alpha.md'), '---\nid: alpha\ntype: fact\n---\nAlpha body.\n');
  writeFileSync(join(mnsDir, 'knowledge', 'items', 'beta.md'), '---\nid: beta\ntype: fact\n---\nBeta body.\n');
  writeFileSync(join(mnsDir, 'knowledge', 'registry', 'types.json'), JSON.stringify([{ name: 'fact' }]) + '\n');
  writeFileSync(join(mnsDir, 'guardrails', 'rules.json'), JSON.stringify({ version: 1, rules: [] }) + '\n');
  try {
    return fn(mnsDir);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('mintGeneration mints gen_001, sets active, snapshots knowledge with hashes', () => {
  freshHome((mnsDir) => {
    const lf = mintGeneration(mnsDir);
    assert.equal(lf.id, 'gen_001');
    assert.equal(activeGeneration(mnsDir), 'gen_001');
    assert.ok(lf.agent && lf.agent.startsWith('agt_'));
    const items = lf.faculties.knowledge.items;
    assert.equal(items.length, 2);
    const alpha = items.find((i) => i.id === 'alpha');
    assert.ok(alpha && /^[0-9a-f]{64}$/.test(alpha.hash));
    // snapshot files copied
    assert.ok(existsSync(join(mnsDir, 'generations', 'snapshots', 'gen_001', 'knowledge', 'alpha.md')));
    assert.ok(existsSync(join(mnsDir, 'generations', 'gen_001.json')));
    assert.deepEqual(listGenerations(mnsDir), ['gen_001']);
  });
});

test('second mint bumps to gen_002 forkedFrom gen_001; changed item hash differs', () => {
  freshHome((mnsDir) => {
    const g1 = mintGeneration(mnsDir);
    writeFileSync(join(mnsDir, 'knowledge', 'items', 'alpha.md'), '---\nid: alpha\ntype: fact\n---\nAlpha CHANGED.\n');
    const g2 = mintGeneration(mnsDir, { forkedFrom: 'gen_001' });
    assert.equal(g2.id, 'gen_002');
    assert.equal(g2.forkedFrom, 'gen_001');
    const h1 = g1.faculties.knowledge.items.find((i) => i.id === 'alpha').hash;
    const h2 = g2.faculties.knowledge.items.find((i) => i.id === 'alpha').hash;
    assert.notEqual(h1, h2);
    assert.equal(activeGeneration(mnsDir), 'gen_002');
  });
});

test('rollback restores file content from the target snapshot and sets active', () => {
  freshHome((mnsDir) => {
    mintGeneration(mnsDir);
    const live = join(mnsDir, 'knowledge', 'items', 'alpha.md');
    writeFileSync(live, '---\nid: alpha\ntype: fact\n---\nAlpha CHANGED.\n');
    mintGeneration(mnsDir, { forkedFrom: 'gen_001' });
    const r = rollback(mnsDir, 'gen_001');
    assert.equal(r.ok, true);
    assert.equal(readFileSync(live, 'utf8'), '---\nid: alpha\ntype: fact\n---\nAlpha body.\n');
    assert.equal(activeGeneration(mnsDir), 'gen_001');
  });
});

test('rollback archives active items not present in the target (no delete)', () => {
  freshHome((mnsDir) => {
    mintGeneration(mnsDir); // gen_001 with alpha, beta
    // add a new item, mint gen_002
    writeFileSync(join(mnsDir, 'knowledge', 'items', 'gamma.md'), '---\nid: gamma\ntype: fact\n---\nGamma.\n');
    mintGeneration(mnsDir, { forkedFrom: 'gen_001' });
    rollback(mnsDir, 'gen_001');
    // gamma was not in gen_001 → archived, not deleted
    assert.ok(!existsSync(join(mnsDir, 'knowledge', 'items', 'gamma.md')));
    assert.ok(existsSync(join(mnsDir, 'knowledge', '_rolledback', 'gamma.md')));
  });
});

test('agentId stable across calls; agent.json bumped to v2 with agent block', () => {
  freshHome((mnsDir) => {
    const a1 = agentId(mnsDir);
    const a2 = agentId(mnsDir);
    assert.equal(a1, a2);
    assert.ok(a1.startsWith('agt_'));
    ensureAgent(mnsDir);
    const m = JSON.parse(readFileSync(join(mnsDir, 'agent.json'), 'utf8'));
    assert.equal(m.version, 2);
    assert.equal(m.agent.id, a1);
    assert.ok(m.agent.createdAt);
    // preserves existing fields
    assert.equal(m.initializedAt, '2026-01-01T00:00:00.000Z');
  });
});

test('snapshot hash deterministic for identical content', () => {
  const buf = 'identical content\n';
  assert.equal(sha256(buf), sha256(Buffer.from(buf)));
  assert.equal(sha256(buf).length, 64);
});

test('diffGenerations reports added + changed knowledge items vs forkedFrom', () => {
  freshHome((mnsDir) => {
    mintGeneration(mnsDir); // gen_001: alpha, beta
    // change alpha, add gamma
    writeFileSync(join(mnsDir, 'knowledge', 'items', 'alpha.md'), '---\nid: alpha\ntype: fact\n---\nAlpha CHANGED.\n');
    writeFileSync(join(mnsDir, 'knowledge', 'items', 'gamma.md'), '---\nid: gamma\ntype: fact\n---\nGamma.\n');
    mintGeneration(mnsDir, { forkedFrom: 'gen_001' }); // gen_002

    const d = diffGenerations(mnsDir, 'gen_002');
    assert.equal(d.forkedFrom, 'gen_001');
    assert.deepEqual(d.faculties.knowledge.added, ['gamma']);
    assert.deepEqual(d.faculties.knowledge.changed, ['alpha']);
    assert.deepEqual(d.faculties.knowledge.removed, []);
  });
});

test('diffGenerations of the first generation reports everything as added (no parent)', () => {
  freshHome((mnsDir) => {
    mintGeneration(mnsDir); // gen_001, forkedFrom null
    const d = diffGenerations(mnsDir, 'gen_001');
    assert.equal(d.forkedFrom, null);
    assert.deepEqual(d.faculties.knowledge.added.sort(), ['alpha', 'beta']);
    assert.deepEqual(d.faculties.knowledge.changed, []);
  });
});

test('diffGenerations of an unknown id returns null', () => {
  freshHome((mnsDir) => {
    assert.equal(diffGenerations(mnsDir, 'gen_999'), null);
  });
});

test('readGeneration round-trips the lockfile; activeGeneration null before any mint', () => {
  freshHome((mnsDir) => {
    assert.equal(activeGeneration(mnsDir), null);
    const lf = mintGeneration(mnsDir);
    assert.deepEqual(readGeneration(mnsDir, lf.id), lf);
  });
});
