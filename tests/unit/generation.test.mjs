// tests/unit/generation.test.mjs — PER-MODULE generations (W2.5 Phase 2).
// Module generation = the atom: each module owns its lineage; minting/rolling
// one module never touches another. Round-trip byte-exactness, independence,
// forkedFrom lineage, per-module diff + sequence numbering, fail-soft.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  sha256,
  agentId,
  snapshotModuleItems,
  moduleItemFiles,
  activeModuleGeneration,
  listModuleGenerations,
  readModuleGeneration,
  diffModuleGenerations,
  moduleGenerations,
} from '../../zuzuu/module/generation/read.mjs';
import { ensureAgent, mintModuleGeneration, rollbackModule } from '../../zuzuu/module/generation/write.mjs';

const KITEM = (id, body) => `---\nid: ${id}\nmodule: knowledge\nkind: fact\n---\n${body}\n`;
const GITEM = (id, body) => `---\nid: ${id}\nmodule: guardrails\nkind: rule\n---\n${body}\n`;

// A minimal home with knowledge + guardrails items + a registry.
function freshHome(fn) {
  const root = mkdtempSync(join(tmpdir(), 'zuzuu-gen-'));
  const agentDir = join(root, '.zuzuu');
  mkdirSync(join(agentDir, 'knowledge', 'items'), { recursive: true });
  mkdirSync(join(agentDir, 'knowledge', 'registry'), { recursive: true });
  mkdirSync(join(agentDir, 'guardrails', 'items'), { recursive: true });
  writeFileSync(join(agentDir, 'agent.json'), JSON.stringify({ version: 1, initializedAt: '2026-01-01T00:00:00.000Z' }, null, 2) + '\n');
  writeFileSync(join(agentDir, 'knowledge', 'items', 'alpha.md'), KITEM('alpha', 'Alpha body.'));
  writeFileSync(join(agentDir, 'knowledge', 'items', 'beta.md'), KITEM('beta', 'Beta body.'));
  writeFileSync(join(agentDir, 'knowledge', 'registry', 'types.json'), JSON.stringify([{ name: 'fact' }]) + '\n');
  writeFileSync(join(agentDir, 'guardrails', 'items', 'no-wipe.md'), GITEM('no-wipe', 'No wipe.'));
  try { return fn(agentDir); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('mintModuleGeneration mints gen_001 for one module, sets that module active, snapshots items', () => {
  freshHome((agentDir) => {
    const lf = mintModuleGeneration(agentDir, 'knowledge');
    assert.equal(lf.id, 'gen_001');
    assert.equal(lf.module, 'knowledge');
    assert.equal(activeModuleGeneration(agentDir, 'knowledge'), 'gen_001');
    assert.ok(lf.agent && lf.agent.startsWith('agt_'));
    assert.equal(lf.items.length, 2);
    const alpha = lf.items.find((i) => i.id === 'alpha');
    assert.ok(alpha && /^[0-9a-f]{64}$/.test(alpha.hash));
    assert.ok(existsSync(join(agentDir, 'knowledge', 'generations', 'snapshots', 'gen_001', 'alpha.md')));
    assert.ok(existsSync(join(agentDir, 'knowledge', 'generations', 'gen_001.json')));
    assert.deepEqual(listModuleGenerations(agentDir, 'knowledge'), ['gen_001']);
  });
});

test('module independence: minting knowledge leaves guardrails active null + files untouched', () => {
  freshHome((agentDir) => {
    const gBefore = readFileSync(join(agentDir, 'guardrails', 'items', 'no-wipe.md'), 'utf8');
    mintModuleGeneration(agentDir, 'knowledge');
    // guardrails has NO generations dir, NO active, files byte-identical
    assert.equal(activeModuleGeneration(agentDir, 'guardrails'), null);
    assert.equal(existsSync(join(agentDir, 'guardrails', 'generations')), false);
    assert.equal(readFileSync(join(agentDir, 'guardrails', 'items', 'no-wipe.md'), 'utf8'), gBefore);
    assert.deepEqual(listModuleGenerations(agentDir, 'guardrails'), []);
  });
});

test('per-module sequence: knowledge can be gen_002 while guardrails is gen_001', () => {
  freshHome((agentDir) => {
    mintModuleGeneration(agentDir, 'knowledge'); // k gen_001
    mintModuleGeneration(agentDir, 'knowledge'); // k gen_002
    mintModuleGeneration(agentDir, 'guardrails'); // g gen_001
    assert.equal(activeModuleGeneration(agentDir, 'knowledge'), 'gen_002');
    assert.equal(activeModuleGeneration(agentDir, 'guardrails'), 'gen_001');
    assert.deepEqual(listModuleGenerations(agentDir, 'knowledge'), ['gen_001', 'gen_002']);
    assert.deepEqual(listModuleGenerations(agentDir, 'guardrails'), ['gen_001']);
  });
});

test('second mint bumps to gen_002 forkedFrom gen_001; changed hash differs', () => {
  freshHome((agentDir) => {
    const g1 = mintModuleGeneration(agentDir, 'knowledge');
    writeFileSync(join(agentDir, 'knowledge', 'items', 'alpha.md'), KITEM('alpha', 'Alpha CHANGED.'));
    const g2 = mintModuleGeneration(agentDir, 'knowledge');
    assert.equal(g2.id, 'gen_002');
    assert.equal(g2.forkedFrom, 'gen_001');
    const h1 = g1.items.find((i) => i.id === 'alpha').hash;
    const h2 = g2.items.find((i) => i.id === 'alpha').hash;
    assert.notEqual(h1, h2);
    assert.equal(activeModuleGeneration(agentDir, 'knowledge'), 'gen_002');
  });
});

test('rollback restores byte-exact content from the target snapshot and flips active', () => {
  freshHome((agentDir) => {
    mintModuleGeneration(agentDir, 'knowledge'); // gen_001
    const live = join(agentDir, 'knowledge', 'items', 'alpha.md');
    const original = readFileSync(live, 'utf8');
    writeFileSync(live, KITEM('alpha', 'Alpha CHANGED.'));
    mintModuleGeneration(agentDir, 'knowledge'); // gen_002
    const r = rollbackModule(agentDir, 'knowledge', 'gen_001');
    assert.equal(r.ok, true);
    assert.equal(readFileSync(live, 'utf8'), original, 'restored byte-exact');
    assert.equal(activeModuleGeneration(agentDir, 'knowledge'), 'gen_001');
  });
});

test('rollback archives active items absent from the target (move, never delete)', () => {
  freshHome((agentDir) => {
    mintModuleGeneration(agentDir, 'knowledge'); // gen_001: alpha, beta
    writeFileSync(join(agentDir, 'knowledge', 'items', 'gamma.md'), KITEM('gamma', 'Gamma.'));
    mintModuleGeneration(agentDir, 'knowledge'); // gen_002
    rollbackModule(agentDir, 'knowledge', 'gen_001');
    assert.equal(existsSync(join(agentDir, 'knowledge', 'items', 'gamma.md')), false);
    assert.ok(existsSync(join(agentDir, 'knowledge', '_rolledback', 'gamma.md')), 'displaced item parked, not deleted');
  });
});

test('rollback of one module never touches another module', () => {
  freshHome((agentDir) => {
    mintModuleGeneration(agentDir, 'knowledge');
    mintModuleGeneration(agentDir, 'guardrails');
    const gActive = activeModuleGeneration(agentDir, 'guardrails');
    const gFile = readFileSync(join(agentDir, 'guardrails', 'items', 'no-wipe.md'), 'utf8');
    writeFileSync(join(agentDir, 'knowledge', 'items', 'alpha.md'), KITEM('alpha', 'X.'));
    mintModuleGeneration(agentDir, 'knowledge');
    rollbackModule(agentDir, 'knowledge', 'gen_001');
    assert.equal(activeModuleGeneration(agentDir, 'guardrails'), gActive, 'guardrails active unchanged');
    assert.equal(readFileSync(join(agentDir, 'guardrails', 'items', 'no-wipe.md'), 'utf8'), gFile, 'guardrails bytes unchanged');
  });
});

test('rollback to an unknown id throws (and never half-mutates)', () => {
  freshHome((agentDir) => {
    mintModuleGeneration(agentDir, 'knowledge');
    assert.throws(() => rollbackModule(agentDir, 'knowledge', 'gen_999'), /no knowledge generation/);
    assert.equal(activeModuleGeneration(agentDir, 'knowledge'), 'gen_001', 'active untouched after a failed rollback');
  });
});

test('diffModuleGenerations reports added + changed vs forkedFrom parent', () => {
  freshHome((agentDir) => {
    mintModuleGeneration(agentDir, 'knowledge'); // gen_001: alpha, beta
    writeFileSync(join(agentDir, 'knowledge', 'items', 'alpha.md'), KITEM('alpha', 'Alpha CHANGED.'));
    writeFileSync(join(agentDir, 'knowledge', 'items', 'gamma.md'), KITEM('gamma', 'Gamma.'));
    mintModuleGeneration(agentDir, 'knowledge'); // gen_002
    const d = diffModuleGenerations(agentDir, 'knowledge', 'gen_002');
    assert.equal(d.module, 'knowledge');
    assert.equal(d.forkedFrom, 'gen_001');
    assert.deepEqual(d.added, ['gamma']);
    assert.deepEqual(d.changed, ['alpha']);
    assert.deepEqual(d.removed, []);
  });
});

test('diffModuleGenerations of the first generation reports everything added (no parent)', () => {
  freshHome((agentDir) => {
    mintModuleGeneration(agentDir, 'knowledge');
    const d = diffModuleGenerations(agentDir, 'knowledge', 'gen_001');
    assert.equal(d.forkedFrom, null);
    assert.deepEqual(d.added.sort(), ['alpha', 'beta']);
    assert.deepEqual(d.changed, []);
  });
});

test('diffModuleGenerations of an unknown id returns null', () => {
  freshHome((agentDir) => {
    assert.equal(diffModuleGenerations(agentDir, 'knowledge', 'gen_999'), null);
  });
});

test('moduleGenerations lists + active; activeModuleGeneration null before any mint', () => {
  freshHome((agentDir) => {
    assert.equal(activeModuleGeneration(agentDir, 'knowledge'), null);
    const empty = moduleGenerations(agentDir, 'knowledge');
    assert.deepEqual(empty.generations, []);
    assert.equal(empty.active, null);
    const lf = mintModuleGeneration(agentDir, 'knowledge');
    const mg = moduleGenerations(agentDir, 'knowledge');
    assert.equal(mg.active, lf.id);
    assert.equal(mg.generations[0].id, 'gen_001');
  });
});

test('readModuleGeneration round-trips the lockfile; corrupt lockfile → null (fail-soft)', () => {
  freshHome((agentDir) => {
    const lf = mintModuleGeneration(agentDir, 'knowledge');
    assert.deepEqual(readModuleGeneration(agentDir, 'knowledge', lf.id), lf);
    writeFileSync(join(agentDir, 'knowledge', 'generations', 'gen_001.json'), '{ not json');
    assert.equal(readModuleGeneration(agentDir, 'knowledge', 'gen_001'), null);
  });
});

test('actions module: dir-shaped snapshot + rollback round-trip', () => {
  freshHome((agentDir) => {
    const slug = join(agentDir, 'actions', 'run-tests');
    mkdirSync(slug, { recursive: true });
    writeFileSync(join(slug, 'ACTION.md'), '---\nid: run-tests\nmodule: actions\n---\nrun the tests\n');
    writeFileSync(join(slug, 'run.mjs'), 'export default () => {};\n');
    mintModuleGeneration(agentDir, 'actions'); // gen_001
    // mutate the action, re-snapshot
    writeFileSync(join(slug, 'run.mjs'), 'export default () => 42;\n');
    mintModuleGeneration(agentDir, 'actions'); // gen_002
    rollbackModule(agentDir, 'actions', 'gen_001');
    assert.equal(readFileSync(join(slug, 'run.mjs'), 'utf8'), 'export default () => {};\n');
  });
});

test('double rollback with the same displaced item never crashes and keeps both parked copies', () => {
  freshHome((agentDir) => {
    mintModuleGeneration(agentDir, 'knowledge'); // gen_001: alpha, beta
    // add gamma, mint gen_002; rollback to gen_001 archives gamma
    writeFileSync(join(agentDir, 'knowledge', 'items', 'gamma.md'), KITEM('gamma', 'G1.'));
    mintModuleGeneration(agentDir, 'knowledge');
    rollbackModule(agentDir, 'knowledge', 'gen_001');
    // re-create gamma, mint gen_003, roll back AGAIN → second gamma must not clobber the parked one
    writeFileSync(join(agentDir, 'knowledge', 'items', 'gamma.md'), KITEM('gamma', 'G2.'));
    mintModuleGeneration(agentDir, 'knowledge');
    assert.doesNotThrow(() => rollbackModule(agentDir, 'knowledge', 'gen_001'));
    const parked = readdirSync(join(agentDir, 'knowledge', '_rolledback'));
    assert.ok(parked.length >= 2, 'both displaced gamma copies are parked, none lost');
  });
});

test('mint after rollback forks from the ACTIVE generation, not the max-numbered one', () => {
  freshHome((agentDir) => {
    mintModuleGeneration(agentDir, 'knowledge'); // gen_001
    writeFileSync(join(agentDir, 'knowledge', 'items', 'alpha.md'), KITEM('alpha', 'Alpha v2.'));
    mintModuleGeneration(agentDir, 'knowledge'); // gen_002
    rollbackModule(agentDir, 'knowledge', 'gen_001'); // active back to gen_001
    assert.equal(activeModuleGeneration(agentDir, 'knowledge'), 'gen_001');
    // edit an item, then mint — the new gen must fork from the ACTIVE (gen_001),
    // not the highest-numbered gen (gen_002), or the lineage/diff is garbage.
    writeFileSync(join(agentDir, 'knowledge', 'items', 'alpha.md'), KITEM('alpha', 'Alpha v3.'));
    const g3 = mintModuleGeneration(agentDir, 'knowledge'); // gen_003
    assert.equal(g3.id, 'gen_003');
    assert.equal(g3.forkedFrom, 'gen_001', 'forked from the active gen, not the max-numbered');
  });
});

test('rollback is honest about a missing snapshot file: ok:false, missing counted, live item NOT lost', () => {
  freshHome((agentDir) => {
    mintModuleGeneration(agentDir, 'knowledge'); // gen_001: alpha, beta
    // delete one snapshot file so it cannot be restored
    rmSync(join(agentDir, 'knowledge', 'generations', 'snapshots', 'gen_001', 'beta.md'));
    // mutate the live beta so we can prove it stays in place (not archived/lost)
    const liveBeta = join(agentDir, 'knowledge', 'items', 'beta.md');
    writeFileSync(liveBeta, KITEM('beta', 'Beta MUTATED.'));
    const r = rollbackModule(agentDir, 'knowledge', 'gen_001');
    assert.equal(r.ok, false, 'partial restore is reported as not-ok');
    assert.equal(r.missing, 1, 'one item could not be restored');
    assert.equal(r.restored, 1, 'the other item was restored');
    // beta (the one that could not be restored) must NOT be archived/lost — it
    // is a target item, so it stays live exactly as-is.
    assert.ok(existsSync(liveBeta), 'unrestorable live item stays in place');
    assert.equal(readFileSync(liveBeta, 'utf8'), KITEM('beta', 'Beta MUTATED.'), 'unrestored item untouched');
    assert.equal(existsSync(join(agentDir, 'knowledge', '_rolledback', 'beta.md')), false, 'not archived');
  });
});

test('a fully-intact rollback still returns ok:true with missing 0', () => {
  freshHome((agentDir) => {
    mintModuleGeneration(agentDir, 'knowledge'); // gen_001: alpha, beta
    writeFileSync(join(agentDir, 'knowledge', 'items', 'alpha.md'), KITEM('alpha', 'X.'));
    mintModuleGeneration(agentDir, 'knowledge'); // gen_002
    const r = rollbackModule(agentDir, 'knowledge', 'gen_001');
    assert.equal(r.ok, true);
    assert.equal(r.missing, 0);
    assert.equal(r.restored, 2);
  });
});

test('actions rollback is honest about a missing snapshot base: ok:false, missing counted', () => {
  freshHome((agentDir) => {
    const slug = join(agentDir, 'actions', 'run-tests');
    mkdirSync(slug, { recursive: true });
    writeFileSync(join(slug, 'ACTION.md'), '---\nid: run-tests\nmodule: actions\n---\nrun the tests\n');
    writeFileSync(join(slug, 'run.mjs'), 'export default () => {};\n');
    mintModuleGeneration(agentDir, 'actions'); // gen_001 pins run-tests
    // delete the snapshotted slug dir so it cannot be restored
    rmSync(join(agentDir, 'actions', 'generations', 'snapshots', 'gen_001', 'run-tests'), { recursive: true, force: true });
    const r = rollbackModule(agentDir, 'actions', 'gen_001');
    assert.equal(r.ok, false, 'a pinned slug that cannot be restored is reported');
    assert.equal(r.missing, 1);
    // the live slug is a target item → must stay in place (not archived)
    assert.ok(existsSync(slug), 'pinned live slug stays in place');
    assert.equal(existsSync(join(agentDir, 'actions', '_rolledback', 'run-tests')), false, 'not archived');
  });
});

test('agentId stable; agent.json bumped to v2 preserving fields', () => {
  freshHome((agentDir) => {
    const a1 = agentId(agentDir);
    assert.equal(a1, agentId(agentDir));
    ensureAgent(agentDir);
    const m = JSON.parse(readFileSync(join(agentDir, 'agent.json'), 'utf8'));
    assert.equal(m.version, 2);
    assert.equal(m.agent.id, a1);
    assert.equal(m.initializedAt, '2026-01-01T00:00:00.000Z');
  });
});

test('sha256 deterministic 64-hex; snapshotModuleItems tolerant of empty module', () => {
  assert.equal(sha256('x\n'), sha256(Buffer.from('x\n')));
  assert.equal(sha256('x').length, 64);
  freshHome((agentDir) => {
    assert.deepEqual(snapshotModuleItems(agentDir, 'memory'), []);
    assert.deepEqual(moduleItemFiles(agentDir, 'nope'), []);
  });
});
