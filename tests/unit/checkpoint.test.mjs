// tests/unit/checkpoint.test.mjs — CHECKPOINTS (W2.5 Phase 2). A checkpoint
// pins each module's active generation; rollback restores every pinned module
// to its pin (bytes + active). Compose/restore across modules at different gens.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mintModuleGeneration } from '../../zuzuu/module/generation/write.mjs';
import { activeModuleGeneration } from '../../zuzuu/module/generation/read.mjs';
import {
  mintCheckpoint, listCheckpoints, readCheckpoint, rollbackCheckpoint, diffCheckpoint, listCheckpointIds,
} from '../../zuzuu/module/generation/checkpoint.mjs';

const KITEM = (id, body) => `---\nid: ${id}\nmodule: knowledge\nkind: fact\n---\n${body}\n`;
const GITEM = (id, body) => `---\nid: ${id}\nmodule: guardrails\nkind: rule\n---\n${body}\n`;

function freshHome(fn) {
  const root = mkdtempSync(join(tmpdir(), 'zuzuu-cp-'));
  const agentDir = join(root, '.zuzuu');
  mkdirSync(join(agentDir, 'knowledge', 'items'), { recursive: true });
  mkdirSync(join(agentDir, 'knowledge', 'registry'), { recursive: true });
  mkdirSync(join(agentDir, 'guardrails', 'items'), { recursive: true });
  writeFileSync(join(agentDir, 'agent.json'), JSON.stringify({ version: 1 }, null, 2) + '\n');
  writeFileSync(join(agentDir, 'knowledge', 'items', 'alpha.md'), KITEM('alpha', 'Alpha v1.'));
  writeFileSync(join(agentDir, 'guardrails', 'items', 'no-wipe.md'), GITEM('no-wipe', 'Rule v1.'));
  try { return fn(agentDir); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('mintCheckpoint pins the current active of every module that has one', () => {
  freshHome((agentDir) => {
    mintModuleGeneration(agentDir, 'knowledge'); // k gen_001
    mintModuleGeneration(agentDir, 'knowledge'); // k gen_002
    mintModuleGeneration(agentDir, 'guardrails'); // g gen_001
    const cp = mintCheckpoint(agentDir, { label: 'first' });
    assert.equal(cp.id, 'cp_001');
    assert.equal(cp.label, 'first');
    assert.deepEqual(cp.pins, { knowledge: 'gen_002', guardrails: 'gen_001' });
    assert.ok(existsSync(join(agentDir, 'checkpoints', 'cp_001.json')));
  });
});

test('mintCheckpoint skips modules with no generation', () => {
  freshHome((agentDir) => {
    mintModuleGeneration(agentDir, 'knowledge');
    const cp = mintCheckpoint(agentDir);
    assert.deepEqual(Object.keys(cp.pins), ['knowledge']);
    assert.equal('guardrails' in cp.pins, false);
  });
});

test('rollbackCheckpoint restores EACH pinned module to its pin (bytes + active)', () => {
  freshHome((agentDir) => {
    // set up: knowledge gen_001, guardrails gen_001 — capture coherent state
    mintModuleGeneration(agentDir, 'knowledge');
    mintModuleGeneration(agentDir, 'guardrails');
    const cp = mintCheckpoint(agentDir, { label: 'coherent' });
    const kLive = join(agentDir, 'knowledge', 'items', 'alpha.md');
    const gLive = join(agentDir, 'guardrails', 'items', 'no-wipe.md');
    const kOrig = readFileSync(kLive, 'utf8');
    const gOrig = readFileSync(gLive, 'utf8');

    // now drift BOTH modules forward and mint new gens
    writeFileSync(kLive, KITEM('alpha', 'Alpha v2.'));
    writeFileSync(gLive, GITEM('no-wipe', 'Rule v2.'));
    mintModuleGeneration(agentDir, 'knowledge'); // gen_002
    mintModuleGeneration(agentDir, 'guardrails'); // gen_002
    assert.equal(activeModuleGeneration(agentDir, 'knowledge'), 'gen_002');
    assert.equal(activeModuleGeneration(agentDir, 'guardrails'), 'gen_002');

    // roll the WHOLE brain back to the checkpoint
    const r = rollbackCheckpoint(agentDir, cp.id);
    assert.equal(r.ok, true);
    assert.equal(r.results.length, 2);
    // both modules back to their pinned generation + byte-exact content
    assert.equal(activeModuleGeneration(agentDir, 'knowledge'), 'gen_001');
    assert.equal(activeModuleGeneration(agentDir, 'guardrails'), 'gen_001');
    assert.equal(readFileSync(kLive, 'utf8'), kOrig);
    assert.equal(readFileSync(gLive, 'utf8'), gOrig);
  });
});

test('checkpoint sequence cp_001, cp_002; listCheckpoints reads all', () => {
  freshHome((agentDir) => {
    mintModuleGeneration(agentDir, 'knowledge');
    mintCheckpoint(agentDir);
    mintCheckpoint(agentDir, { label: 'second' });
    assert.deepEqual(listCheckpointIds(agentDir), ['cp_001', 'cp_002']);
    const all = listCheckpoints(agentDir);
    assert.equal(all.length, 2);
    assert.equal(all[1].label, 'second');
  });
});

test('rollbackCheckpoint with a missing pinned generation is fail-soft (skip, never crash)', () => {
  freshHome((agentDir) => {
    mintModuleGeneration(agentDir, 'knowledge');
    // hand-write a checkpoint pinning a module gen that does not exist
    mkdirSync(join(agentDir, 'checkpoints'), { recursive: true });
    writeFileSync(join(agentDir, 'checkpoints', 'cp_001.json'),
      JSON.stringify({ id: 'cp_001', createdAt: 't', pins: { knowledge: 'gen_001', guardrails: 'gen_777' } }, null, 2));
    const r = rollbackCheckpoint(agentDir, 'cp_001');
    assert.equal(r.ok, false, 'overall not ok because one pin failed');
    const k = r.results.find((x) => x.module === 'knowledge');
    const g = r.results.find((x) => x.module === 'guardrails');
    assert.equal(k.ok, true, 'knowledge restored');
    assert.equal(g.ok, false, 'missing guardrails gen skipped, not crashed');
    assert.equal(activeModuleGeneration(agentDir, 'knowledge'), 'gen_001');
  });
});

test('readCheckpoint corrupt → null; rollbackCheckpoint unknown id throws', () => {
  freshHome((agentDir) => {
    mkdirSync(join(agentDir, 'checkpoints'), { recursive: true });
    writeFileSync(join(agentDir, 'checkpoints', 'cp_001.json'), '{ bad');
    assert.equal(readCheckpoint(agentDir, 'cp_001'), null);
    assert.throws(() => rollbackCheckpoint(agentDir, 'cp_999'), /no checkpoint/);
  });
});

test('diffCheckpoint shows pins as module/generation pairs', () => {
  freshHome((agentDir) => {
    mintModuleGeneration(agentDir, 'knowledge');
    mintModuleGeneration(agentDir, 'guardrails');
    const cp = mintCheckpoint(agentDir, { label: 'lbl' });
    const d = diffCheckpoint(agentDir, cp.id);
    assert.equal(d.label, 'lbl');
    assert.deepEqual(
      d.pins.sort((a, b) => a.module.localeCompare(b.module)),
      [{ module: 'guardrails', generation: 'gen_001' }, { module: 'knowledge', generation: 'gen_001' }],
    );
    assert.equal(diffCheckpoint(agentDir, 'cp_999'), null);
  });
});
