import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scaffoldAction } from '../../zuzuu/commands/act-author.mjs';
import { parseEnvelope } from '../../zuzuu/module/envelope.mjs';

function withHome(fn) {
  const root = mkdtempSync(join(tmpdir(), 'zuzuu-new-'));
  mkdirSync(join(root, '.zuzuu', 'actions'), { recursive: true });
  try { return fn(join(root, '.zuzuu')); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('scaffoldAction creates ACTION.md + run.mjs; ACTION.md is a valid envelope with the slug', () => {
  withHome((home) => {
    const r = scaffoldAction(home, 'deploy-thing');
    assert.equal(r.created.length, 2);
    const dir = join(home, 'actions', 'deploy-thing');
    assert.ok(existsSync(join(dir, 'ACTION.md')));
    assert.ok(existsSync(join(dir, 'run.mjs')));
    const { ok, item } = parseEnvelope(readFileSync(join(dir, 'ACTION.md'), 'utf8'));
    assert.ok(ok, 'ACTION.md parses as an envelope');
    assert.equal(item.id, 'deploy-thing');
    assert.equal(item.module, 'actions');
    assert.equal(item.kind, 'script');
    assert.equal(item.payload.exec, 'run.mjs');
    assert.ok(readFileSync(join(dir, 'run.mjs'), 'utf8').includes('export async function main'));
  });
});

test('scaffoldAction is no-clobber: existing files survive', () => {
  withHome((home) => {
    const dir = join(home, 'actions', 'keep');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'run.mjs'), 'export async function main(){ return { mine: true }; }');
    const r = scaffoldAction(home, 'keep');
    assert.ok(readFileSync(join(dir, 'run.mjs'), 'utf8').includes('mine: true'), 'user run.mjs untouched');
    assert.ok(r.created.includes('ACTION.md'));
    assert.ok(!r.created.includes('run.mjs'));
  });
});

test('scaffoldAction throws on an unsafe slug (containment at the lib layer)', () => {
  withHome((home) => {
    assert.throws(() => scaffoldAction(home, '../../escaped'), /invalid slug/);
  });
});

test('home act new rejects a path-traversal slug (containment)', () => {
  const root = mkdtempSync(join(tmpdir(), 'zuzuu-trav-'));
  mkdirSync(join(root, '.zuzuu', 'actions'), { recursive: true });
  const bin = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'zuzuu.mjs');
  try {
    const r = spawnSync(process.execPath, [bin, 'act', 'new', '../../escaped'], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match((r.stderr || '') + (r.stdout || ''), /invalid slug/);
    assert.ok(!existsSync(join(root, 'escaped')), 'nothing written outside agent');
    assert.ok(!existsSync(join(root, '..', 'escaped')), 'nothing written above root');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
