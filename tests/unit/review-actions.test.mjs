import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'zuzuu.mjs');

function withProposed(slug, fn) {
  const root = mkdtempSync(join(tmpdir(), 'mns-rev-'));
  const mns = join(root, 'agent');
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

test('piped review: one stdin drives BOTH the actions pass and the knowledge pass', () => {
  const root = mkdtempSync(join(tmpdir(), 'mns-rev-combo-'));
  const mns = join(root, 'agent');
  for (const d of ['knowledge/items', 'knowledge/inbox', 'knowledge/proposals', 'knowledge/registry', 'actions/inbox/deploy']) {
    mkdirSync(join(mns, d), { recursive: true });
  }
  // seed the type registry so 'fact' is a valid type
  writeFileSync(join(mns, 'knowledge', 'registry', 'types.json'), JSON.stringify([{ name: 'fact', description: 'A declarative truth' }]));
  // a proposed action…
  writeFileSync(join(mns, 'actions', 'inbox', 'deploy', 'action.json'), JSON.stringify({ slug: 'deploy', promptSnippet: 'ship it' }));
  writeFileSync(join(mns, 'actions', 'inbox', 'deploy', 'run.mjs'), 'export async function main(){ return {}; }');
  // …and a knowledge inbox candidate (processInbox turns it into a pending proposal)
  writeFileSync(join(mns, 'knowledge', 'inbox', 'fact.md'), 'releases must be tagged before publishing');
  try {
    // first answer (s) skips the action; second answer (y) approves the knowledge proposal
    const r = spawnSync(process.execPath, [BIN, 'review'], { cwd: root, input: 's\ny\n', encoding: 'utf8' });
    // action skipped → still in inbox, not active
    assert.ok(existsSync(join(mns, 'actions', 'inbox', 'deploy')), 'action skipped → still in inbox');
    assert.ok(!existsSync(join(mns, 'actions', 'deploy')), 'action not activated');
    // knowledge proposal approved → an item file now exists
    const itemsDir = join(mns, 'knowledge', 'items');
    assert.ok(readdirSync(itemsDir).some((f) => f.endsWith('.md')), 'knowledge item created');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
