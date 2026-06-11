import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listProposedActions, activateAction, rejectAction } from '../../mns/actions/inbox.mjs';

function withInbox(slug, fn, { manifest, run } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'mns-inbox-'));
  const mns = join(root, '.mns');
  const dir = join(mns, 'actions', 'inbox', slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'action.json'), manifest ?? JSON.stringify({ slug, promptSnippet: 'proposed thing' }));
  writeFileSync(join(dir, 'run.mjs'), run ?? 'export async function main(){ return { ok: true }; }');
  try { return fn(mns); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('listProposedActions returns inbox entries', () => {
  withInbox('deploy', (mns) => {
    const list = listProposedActions(mns);
    assert.equal(list.length, 1);
    assert.equal(list[0].slug, 'deploy');
    assert.equal(list[0].promptSnippet, 'proposed thing');
  });
});

test('activateAction moves inbox → active and clears the inbox entry', () => {
  withInbox('deploy', (mns) => {
    const r = activateAction(mns, 'deploy');
    assert.equal(r.ok, true);
    assert.ok(existsSync(join(mns, 'actions', 'deploy', 'run.mjs')), 'now active');
    assert.ok(!existsSync(join(mns, 'actions', 'inbox', 'deploy')), 'inbox entry gone');
    assert.equal(listProposedActions(mns).length, 0);
  });
});

test('activateAction refuses when an active action of that slug already exists', () => {
  withInbox('dup', (mns) => {
    mkdirSync(join(mns, 'actions', 'dup'), { recursive: true });
    writeFileSync(join(mns, 'actions', 'dup', 'run.mjs'), 'export async function main(){ return { mine: true }; }');
    const r = activateAction(mns, 'dup');
    assert.equal(r.ok, false);
    assert.match(r.error, /exists/i);
    assert.ok(existsSync(join(mns, 'actions', 'inbox', 'dup')), 'inbox entry preserved on conflict');
  });
});

test('activateAction refuses a malformed manifest', () => {
  withInbox('bad', (mns) => {
    const r = activateAction(mns, 'bad');
    assert.equal(r.ok, false);
    assert.match(r.error, /manifest/i);
    assert.ok(!existsSync(join(mns, 'actions', 'bad')), 'not activated');
  }, { manifest: '{ not json' });
});

test('rejectAction archives the inbox entry instead of deleting it', () => {
  withInbox('nope', (mns) => {
    const r = rejectAction(mns, 'nope');
    assert.equal(r.ok, true);
    assert.ok(!existsSync(join(mns, 'actions', 'inbox', 'nope')), 'inbox entry gone');
    // intended behaviour change (WS2-T3): reject archives the dir, never destroys it
    assert.ok(existsSync(join(mns, 'actions', 'proposals', 'archive', 'nope', 'run.mjs')), 'dir archived, not deleted');
  });
});

test('activate/reject reject unsafe slugs', () => {
  withInbox('ok', (mns) => {
    assert.equal(activateAction(mns, '../../escape').ok, false);
    assert.equal(rejectAction(mns, '../../escape').ok, false);
  });
});
