import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordOutcome } from '../../zuzuu/actions/trail.mjs';

function withHome(fn) {
  const root = mkdtempSync(join(tmpdir(), 'zuzuu-trail-'));
  mkdirSync(join(root, '.zuzuu'), { recursive: true });
  try { return fn(join(root, '.zuzuu')); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('recordOutcome appends a JSONL line with slug + ok + error', () => {
  withHome((home) => {
    recordOutcome(home, { slug: 'deploy', ok: true });
    recordOutcome(home, { slug: 'deploy', ok: false, error: 'invalid_input' });
    const path = join(home, '.live', 'actions.jsonl');
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

test('recordOutcome is fail-soft: a bad agentDir never throws', () => {
  assert.doesNotThrow(() => recordOutcome('/nonexistent/ /bad', { slug: 'x', ok: true }));
});
