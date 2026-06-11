import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import '../../mns/knowledge/adapter.mjs'; // self-registers 'knowledge'
import { approve, reject } from '../../mns/faculty/gate.mjs';
import { register } from '../../mns/faculty/registry.mjs';
import { writeProposal, makeProposal } from '../../mns/faculty/proposal.mjs';
import { SEED_TYPES } from '../../mns/knowledge/registry.mjs';

function withHome(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'mns-gate-'));
  const mnsDir = join(dir, '.mns');
  const reg = join(mnsDir, 'knowledge', 'registry');
  mkdirSync(reg, { recursive: true });
  mkdirSync(join(mnsDir, 'knowledge', 'items'), { recursive: true });
  mkdirSync(join(mnsDir, 'knowledge', 'proposals'), { recursive: true });
  writeFileSync(join(reg, 'types.json'), JSON.stringify(SEED_TYPES));
  try { return fn(mnsDir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('gate.approve applies a knowledge proposal and archives it', () => {
  withHome((mnsDir) => {
    const p = makeProposal({
      faculty: 'knowledge', kind: 'item', source: 'test',
      payload: { id: 'ci-node', type: 'fact', body: 'CI runs Node 22 and 24' },
      analysis: { er: { verdict: 'new' } },
    });
    writeProposal(mnsDir, p);
    const r = approve(mnsDir, 'knowledge', p.id);
    assert.ok(r.ok, JSON.stringify(r));
    // item written
    assert.ok(r.itemIds.includes('ci-node'));
    // proposal archived, not pending
    assert.ok(!existsSync(join(mnsDir, 'knowledge', 'proposals', `${p.id}.json`)), 'pending gone');
    const archPath = join(mnsDir, 'knowledge', 'proposals', 'archive', `${p.id}.json`);
    assert.ok(existsSync(archPath), 'archived');
    const arch = JSON.parse(readFileSync(archPath, 'utf8'));
    assert.equal(arch.status, 'approved');
  });
});

test('gate.approve does NOT archive when apply fails — proposal stays pending for retry', () => {
  withHome((mnsDir) => {
    // a dummy faculty whose validate passes but apply fails (e.g. "already exists")
    register({
      name: 'dummy',
      validate: () => ({ ok: true, errors: [], warnings: [] }),
      apply: () => ({ ok: false, action: 'already exists', error: 'exists' }),
      render: () => ({ line: 'x', card: ['x'] }),
    });
    const p = makeProposal({ faculty: 'dummy', kind: 'thing', source: 'test', payload: { id: 'd1' } });
    writeProposal(mnsDir, p);
    const r = approve(mnsDir, 'dummy', p.id);
    assert.equal(r.ok, false, 'apply failure surfaced');
    // the pending proposal must SURVIVE (not archived as approved)
    assert.ok(existsSync(join(mnsDir, 'dummy', 'proposals', `${p.id}.json`)), 'still pending for retry');
    assert.ok(!existsSync(join(mnsDir, 'dummy', 'proposals', 'archive', `${p.id}.json`)), 'not archived');
  });
});

test('gate.reject archives the proposal with status rejected, does NOT delete', () => {
  withHome((mnsDir) => {
    const p = makeProposal({
      faculty: 'knowledge', kind: 'item', source: 'test',
      payload: { id: 'junk', type: 'fact', body: 'an unwanted fact' },
      analysis: { er: { verdict: 'new' } },
    });
    writeProposal(mnsDir, p);
    const r = reject(mnsDir, 'knowledge', p.id, 'too weak');
    assert.ok(r.ok);
    assert.ok(!existsSync(join(mnsDir, 'knowledge', 'proposals', `${p.id}.json`)), 'pending gone');
    const archPath = join(mnsDir, 'knowledge', 'proposals', 'archive', `${p.id}.json`);
    assert.ok(existsSync(archPath), 'archived not deleted');
    const arch = JSON.parse(readFileSync(archPath, 'utf8'));
    assert.equal(arch.status, 'rejected');
    assert.equal(arch.reason, 'too weak');
  });
});
