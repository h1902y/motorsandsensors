import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'mns.mjs');

function withProposed(slug, fn) {
  const root = mkdtempSync(join(tmpdir(), 'mns-rev-'));
  const mns = join(root, '.mns');
  for (const d of ['knowledge/items', 'knowledge/inbox', 'knowledge/proposals', 'knowledge/registry', 'actions/inbox/' + slug]) {
    mkdirSync(join(mns, d), { recursive: true });
  }
  writeFileSync(join(mns, 'actions', 'inbox', slug, 'action.json'), JSON.stringify({ slug, promptSnippet: 'do it' }));
  writeFileSync(join(mns, 'actions', 'inbox', slug, 'run.mjs'), 'export async function main(){ return {}; }');
  try { return fn(root, mns); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('piped review: y activates a proposed action', () => {
  withProposed('deploy', (root, mns) => {
    const r = spawnSync(process.execPath, [BIN, 'review'], { cwd: root, input: 'y\n', encoding: 'utf8' });
    assert.match(r.stdout, /deploy/);
    assert.ok(existsSync(join(mns, 'actions', 'deploy', 'run.mjs')), 'activated');
    assert.ok(!existsSync(join(mns, 'actions', 'inbox', 'deploy')), 'inbox cleared');
  });
});

test('piped review: n rejects a proposed action', () => {
  withProposed('scratch', (root, mns) => {
    const r = spawnSync(process.execPath, [BIN, 'review'], { cwd: root, input: 'n\n', encoding: 'utf8' });
    assert.ok(!existsSync(join(mns, 'actions', 'scratch')), 'not activated');
    assert.ok(!existsSync(join(mns, 'actions', 'inbox', 'scratch')), 'inbox entry removed');
  });
});
