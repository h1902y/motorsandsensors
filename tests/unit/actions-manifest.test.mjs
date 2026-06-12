import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadManifest, allActions, listActions, inboxDir } from '../../zuzuu/actions/manifest.mjs';

function withActions(fn) {
  const root = mkdtempSync(join(tmpdir(), 'zuzuu-act-'));
  const home = join(root, '.zuzuu');
  const A = join(home, 'actions');
  mkdirSync(A, { recursive: true });
  writeFileSync(join(A, 'README.md'), '# actions'); // must be ignored
  mkdirSync(join(A, 'run-tests'), { recursive: true });
  writeFileSync(join(A, 'run-tests', 'action.json'), JSON.stringify({
    slug: 'run-tests', title: 'Run tests', description: 'runs the suite',
    promptSnippet: 'run the test suite', inputs: { type: 'object' }, outputs: { type: 'object' },
  }));
  writeFileSync(join(A, 'run-tests', 'run.mjs'), 'export async function main(){ return { ok: true }; }');
  mkdirSync(join(A, 'deploy'), { recursive: true });
  writeFileSync(join(A, 'deploy', 'SKILL.md'), '---\nname: Deploy\ndescription: how to ship\n---\nsteps...');
  try {
    return fn(home);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('loadManifest reads action.json or returns null', () => {
  withActions((home) => {
    const m = loadManifest(home, 'run-tests');
    assert.equal(m.slug, 'run-tests');
    assert.equal(m.promptSnippet, 'run the test suite');
    assert.equal(loadManifest(home, 'nope'), null);
    assert.equal(loadManifest(home, 'deploy'), null); // runbook has no action.json
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

test('script dir without action.json falls back to slug', () => {
  const root = mkdtempSync(join(tmpdir(), 'zuzuu-noman-'));
  const A = join(root, '.zuzuu', 'actions', 'bare');
  mkdirSync(A, { recursive: true });
  writeFileSync(join(A, 'run.mjs'), 'export async function main(){ return {}; }'); // no action.json
  try {
    const list = allActions(join(root, '.zuzuu'));
    assert.equal(list.length, 1);
    assert.equal(list[0].kind, 'script');
    assert.equal(list[0].title, 'bare');
    assert.equal(list[0].promptSnippet, 'bare');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('allActions skips the inbox subdir', () => {
  withActions((home) => {
    const inb = join(home, 'actions', 'inbox', 'proposed');
    mkdirSync(inb, { recursive: true });
    writeFileSync(join(inb, 'action.json'), JSON.stringify({ slug: 'proposed' }));
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
    writeFileSync(join(inb, 'action.json'), JSON.stringify({ slug: 'proposed', promptSnippet: 'do a thing' }));
    writeFileSync(join(inb, 'run.mjs'), 'export async function main(){ return {}; }');
    const list = listActions(inboxDir(home));
    assert.equal(list.length, 1);
    assert.equal(list[0].slug, 'proposed');
    assert.equal(list[0].kind, 'script');
    assert.equal(list[0].promptSnippet, 'do a thing');
  });
});
