import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordOutcome } from '../../mns/actions/trail.mjs';

function withHome(fn) {
  const root = mkdtempSync(join(tmpdir(), 'mns-trail-'));
  mkdirSync(join(root, '.mns'), { recursive: true });
  try { return fn(join(root, '.mns')); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('recordOutcome appends a JSONL line with slug + ok + error', () => {
  withHome((mns) => {
    recordOutcome(mns, { slug: 'deploy', ok: true });
    recordOutcome(mns, { slug: 'deploy', ok: false, error: 'invalid_input' });
    const path = join(mns, 'live', 'actions.jsonl');
    assert.ok(existsSync(path));
    const lines = readFileSync(path, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.length, 2);
    assert.equal(lines[0].slug, 'deploy');
    assert.equal(lines[0].ok, true);
    assert.ok(lines[0].at, 'has a timestamp');
    assert.equal(lines[1].ok, false);
    assert.equal(lines[1].error, 'invalid_input');
  });
});

test('recordOutcome is fail-soft: a bad mnsDir never throws', () => {
  assert.doesNotThrow(() => recordOutcome('/nonexistent/ /bad', { slug: 'x', ok: true }));
});
