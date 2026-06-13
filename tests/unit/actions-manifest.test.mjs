import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadManifest, execOf, allActions, listActions, inboxDir } from '../../zuzuu/actions/manifest.mjs';
import { serializeEnvelope } from '../../zuzuu/module/envelope.mjs';

const actionMd = ({ slug, kind = 'script', title = slug, body = slug, payload = {} }) =>
  serializeEnvelope({
    id: slug, module: 'actions', kind, title, status: 'active',
    created_at: '2026-06-12T00:00:00Z', payload, body,
  });

function withActions(fn) {
  const root = mkdtempSync(join(tmpdir(), 'zuzuu-act-'));
  const home = join(root, '.zuzuu');
  const A = join(home, 'actions');
  mkdirSync(A, { recursive: true });
  writeFileSync(join(A, 'README.md'), '# actions'); // must be ignored
  mkdirSync(join(A, 'run-tests'), { recursive: true });
  writeFileSync(join(A, 'run-tests', 'ACTION.md'), actionMd({
    slug: 'run-tests', kind: 'script', title: 'Run tests',
    body: 'run the test suite\n\nRuns the whole hermetic suite.', payload: { exec: 'run.mjs' },
  }));
  writeFileSync(join(A, 'run-tests', 'run.mjs'), 'export async function main(){ return { ok: true }; }');
  mkdirSync(join(A, 'deploy'), { recursive: true });
  writeFileSync(join(A, 'deploy', 'ACTION.md'), actionMd({
    slug: 'deploy', kind: 'runbook', title: 'Deploy', body: 'how to ship\n\n## Steps\n1. build\n2. ship',
  }));
  try {
    return fn(home);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('loadManifest parses ACTION.md or returns null', () => {
  withActions((home) => {
    const m = loadManifest(home, 'run-tests');
    assert.equal(m.id, 'run-tests');
    assert.equal(m.kind, 'script');
    assert.equal(m.title, 'Run tests');
    assert.equal(m.promptSnippet, 'run the test suite', 'snippet = body first line');
    assert.equal(execOf(m), 'run.mjs');
    assert.equal(loadManifest(home, 'nope'), null);
    const rb = loadManifest(home, 'deploy');
    assert.equal(rb.kind, 'runbook');
  });
});

test('allActions lists scripts and runbooks, ignores README', () => {
  withActions((home) => {
    const list = allActions(home).sort((a, b) => a.slug.localeCompare(b.slug));
    assert.equal(list.length, 2);
    assert.deepEqual(list.map((a) => a.slug), ['deploy', 'run-tests']);
    const rt = list.find((a) => a.slug === 'run-tests');
    assert.equal(rt.kind, 'script');
    assert.equal(rt.promptSnippet, 'run the test suite');
    const dp = list.find((a) => a.slug === 'deploy');
    assert.equal(dp.kind, 'runbook');
    assert.equal(dp.title, 'Deploy');
    assert.equal(dp.promptSnippet, 'how to ship');
  });
});

test('allActions on a home with no actions dir returns []', () => {
  const root = mkdtempSync(join(tmpdir(), 'zuzuu-empty-'));
  try {
    assert.deepEqual(allActions(join(root, '.zuzuu')), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a dir without ACTION.md is not an action (standard is the contract)', () => {
  const root = mkdtempSync(join(tmpdir(), 'zuzuu-noman-'));
  const A = join(root, '.zuzuu', 'actions', 'bare');
  mkdirSync(A, { recursive: true });
  writeFileSync(join(A, 'run.mjs'), 'export async function main(){ return {}; }'); // no ACTION.md
  try {
    assert.deepEqual(allActions(join(root, '.zuzuu')), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a malformed ACTION.md is skipped, not fatal (fail-soft listing)', () => {
  withActions((home) => {
    const bad = join(home, 'actions', 'broken');
    mkdirSync(bad, { recursive: true });
    writeFileSync(join(bad, 'ACTION.md'), 'not an envelope at all');
    const slugs = allActions(home).map((a) => a.slug);
    assert.ok(!slugs.includes('broken'));
    assert.equal(slugs.length, 2, 'the good actions still list');
  });
});

test('allActions skips the inbox subdir', () => {
  withActions((home) => {
    const inb = join(home, 'actions', 'inbox', 'proposed');
    mkdirSync(inb, { recursive: true });
    writeFileSync(join(inb, 'ACTION.md'), actionMd({ slug: 'proposed', body: 'do a thing' }));
    writeFileSync(join(inb, 'run.mjs'), 'export async function main(){ return {}; }');
    const slugs = allActions(home).map((a) => a.slug);
    assert.ok(!slugs.includes('inbox'), 'inbox not listed as an action');
    assert.ok(!slugs.includes('proposed'), 'inbox contents not listed as active actions');
  });
});

test('listActions on the inbox dir lists proposed actions', () => {
  withActions((home) => {
    const inb = join(home, 'actions', 'inbox', 'proposed');
    mkdirSync(inb, { recursive: true });
    writeFileSync(join(inb, 'ACTION.md'), actionMd({ slug: 'proposed', body: 'do a thing' }));
    writeFileSync(join(inb, 'run.mjs'), 'export async function main(){ return {}; }');
    const list = listActions(inboxDir(home));
    assert.equal(list.length, 1);
    assert.equal(list[0].slug, 'proposed');
    assert.equal(list[0].kind, 'script');
    assert.equal(list[0].promptSnippet, 'do a thing');
  });
});
