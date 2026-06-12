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

// Build a minimal .home home with a couple knowledge items + a rules.json.
function freshHome(fn) {
  const root = mkdtempSync(join(tmpdir(), 'zuzuu-gen-'));
  const agentDir = join(root, '.zuzuu');
  mkdirSync(join(agentDir, 'knowledge', 'items'), { recursive: true });
  mkdirSync(join(agentDir, 'knowledge', 'registry'), { recursive: true });
  mkdirSync(join(agentDir, 'guardrails'), { recursive: true });
  mkdirSync(join(agentDir, 'generations', 'snapshots'), { recursive: true });
  writeFileSync(join(agentDir, 'agent.json'), JSON.stringify({ version: 1, initializedAt: '2026-01-01T00:00:00.000Z', layout: [] }, null, 2) + '\n');
  writeFileSync(join(agentDir, 'knowledge', 'items', 'alpha.md'), '---\nid: alpha\ntype: fact\n---\nAlpha body.\n');
  writeFileSync(join(agentDir, 'knowledge', 'items', 'beta.md'), '---\nid: beta\ntype: fact\n---\nBeta body.\n');
  writeFileSync(join(agentDir, 'knowledge', 'registry', 'types.json'), JSON.stringify([{ name: 'fact' }]) + '\n');
  writeFileSync(join(agentDir, 'guardrails', 'rules.json'), JSON.stringify({ version: 1, rules: [] }) + '\n');
  try {
    return fn(agentDir);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('mintGeneration mints gen_001, sets active, snapshots knowledge with hashes', () => {
  freshHome((agentDir) => {
    const lf = mintGeneration(agentDir);
    assert.equal(lf.id, 'gen_001');
    assert.equal(activeGeneration(agentDir), 'gen_001');
    assert.ok(lf.agent && lf.agent.startsWith('agt_'));
    const items = lf.faculties.knowledge.items;
    assert.equal(items.length, 2);
    const alpha = items.find((i) => i.id === 'alpha');
    assert.ok(alpha && /^[0-9a-f]{64}$/.test(alpha.hash));
    // snapshot files copied
    assert.ok(existsSync(join(agentDir, 'generations', 'snapshots', 'gen_001', 'knowledge', 'alpha.md')));
    assert.ok(existsSync(join(agentDir, 'generations', 'gen_001.json')));
    assert.deepEqual(listGenerations(agentDir), ['gen_001']);
  });
});

test('second mint bumps to gen_002 forkedFrom gen_001; changed item hash differs', () => {
  freshHome((agentDir) => {
    const g1 = mintGeneration(agentDir);
    writeFileSync(join(agentDir, 'knowledge', 'items', 'alpha.md'), '---\nid: alpha\ntype: fact\n---\nAlpha CHANGED.\n');
    const g2 = mintGeneration(agentDir, { forkedFrom: 'gen_001' });
    assert.equal(g2.id, 'gen_002');
    assert.equal(g2.forkedFrom, 'gen_001');
    const h1 = g1.faculties.knowledge.items.find((i) => i.id === 'alpha').hash;
    const h2 = g2.faculties.knowledge.items.find((i) => i.id === 'alpha').hash;
    assert.notEqual(h1, h2);
    assert.equal(activeGeneration(agentDir), 'gen_002');
  });
});

test('rollback restores file content from the target snapshot and sets active', () => {
  freshHome((agentDir) => {
    mintGeneration(agentDir);
    const live = join(agentDir, 'knowledge', 'items', 'alpha.md');
    writeFileSync(live, '---\nid: alpha\ntype: fact\n---\nAlpha CHANGED.\n');
    mintGeneration(agentDir, { forkedFrom: 'gen_001' });
    const r = rollback(agentDir, 'gen_001');
    assert.equal(r.ok, true);
    assert.equal(readFileSync(live, 'utf8'), '---\nid: alpha\ntype: fact\n---\nAlpha body.\n');
    assert.equal(activeGeneration(agentDir), 'gen_001');
  });
});

test('rollback archives active items not present in the target (no delete)', () => {
  freshHome((agentDir) => {
    mintGeneration(agentDir); // gen_001 with alpha, beta
    // add a new item, mint gen_002
    writeFileSync(join(agentDir, 'knowledge', 'items', 'gamma.md'), '---\nid: gamma\ntype: fact\n---\nGamma.\n');
    mintGeneration(agentDir, { forkedFrom: 'gen_001' });
    rollback(agentDir, 'gen_001');
    // gamma was not in gen_001 → archived, not deleted
    assert.ok(!existsSync(join(agentDir, 'knowledge', 'items', 'gamma.md')));
    assert.ok(existsSync(join(agentDir, 'knowledge', '_rolledback', 'gamma.md')));
  });
});

test('agentId stable across calls; agent.json bumped to v2 with agent block', () => {
  freshHome((agentDir) => {
    const a1 = agentId(agentDir);
    const a2 = agentId(agentDir);
    assert.equal(a1, a2);
    assert.ok(a1.startsWith('agt_'));
    ensureAgent(agentDir);
    const m = JSON.parse(readFileSync(join(agentDir, 'agent.json'), 'utf8'));
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
  freshHome((agentDir) => {
    mintGeneration(agentDir); // gen_001: alpha, beta
    // change alpha, add gamma
    writeFileSync(join(agentDir, 'knowledge', 'items', 'alpha.md'), '---\nid: alpha\ntype: fact\n---\nAlpha CHANGED.\n');
    writeFileSync(join(agentDir, 'knowledge', 'items', 'gamma.md'), '---\nid: gamma\ntype: fact\n---\nGamma.\n');
    mintGeneration(agentDir, { forkedFrom: 'gen_001' }); // gen_002

    const d = diffGenerations(agentDir, 'gen_002');
    assert.equal(d.forkedFrom, 'gen_001');
    assert.deepEqual(d.faculties.knowledge.added, ['gamma']);
    assert.deepEqual(d.faculties.knowledge.changed, ['alpha']);
    assert.deepEqual(d.faculties.knowledge.removed, []);
  });
});

test('diffGenerations of the first generation reports everything as added (no parent)', () => {
  freshHome((agentDir) => {
    mintGeneration(agentDir); // gen_001, forkedFrom null
    const d = diffGenerations(agentDir, 'gen_001');
    assert.equal(d.forkedFrom, null);
    assert.deepEqual(d.faculties.knowledge.added.sort(), ['alpha', 'beta']);
    assert.deepEqual(d.faculties.knowledge.changed, []);
  });
});

test('diffGenerations of an unknown id returns null', () => {
  freshHome((agentDir) => {
    assert.equal(diffGenerations(agentDir, 'gen_999'), null);
  });
});

test('readGeneration round-trips the lockfile; activeGeneration null before any mint', () => {
  freshHome((agentDir) => {
    assert.equal(activeGeneration(agentDir), null);
    const lf = mintGeneration(agentDir);
    assert.deepEqual(readGeneration(agentDir, lf.id), lf);
  });
});
