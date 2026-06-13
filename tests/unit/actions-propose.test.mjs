import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { proposeAction } from '../../zuzuu/commands/act-author.mjs';
import { parseEnvelope } from '../../zuzuu/module/envelope.mjs';

function withHome(fn) {
  const root = mkdtempSync(join(tmpdir(), 'zuzuu-prop-'));
  mkdirSync(join(root, '.zuzuu', 'actions', 'inbox'), { recursive: true });
  try { return fn(join(root, '.zuzuu')); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('proposeAction scaffolds into actions/inbox/<slug>/, not the active dir', () => {
  withHome((home) => {
    const r = proposeAction(home, 'shipit');
    assert.equal(r.created.length, 2);
    assert.ok(existsSync(join(home, 'actions', 'inbox', 'shipit', 'ACTION.md')));
    assert.ok(existsSync(join(home, 'actions', 'inbox', 'shipit', 'run.mjs')));
    assert.ok(!existsSync(join(home, 'actions', 'shipit')), 'not active until reviewed');
    const { ok, item } = parseEnvelope(readFileSync(join(home, 'actions', 'inbox', 'shipit', 'ACTION.md'), 'utf8'));
    assert.ok(ok);
    assert.equal(item.id, 'shipit');
  });
});

test('proposeAction rejects an unsafe slug', () => {
  withHome((home) => {
    assert.throws(() => proposeAction(home, '../../escape'), /invalid slug/);
  });
});
