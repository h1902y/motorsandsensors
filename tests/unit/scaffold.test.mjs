import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LAYOUT, IGNORE_LINES, planScaffold, applyScaffold, ensureGitignore, homeExists } from '../../mns/scaffold.mjs';

function withTemp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'mns-scaffold-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('applyScaffold creates the full layout + manifest in a fresh dir', () => {
  withTemp((cwd) => {
    assert.equal(homeExists(cwd), false);
    const plan = applyScaffold(cwd, { now: 0 });
    assert.equal(plan.dirs.length, LAYOUT.dirs.length);
    for (const d of LAYOUT.dirs) assert.ok(existsSync(join(cwd, d)), d);
    for (const f of Object.keys(LAYOUT.files)) assert.ok(existsSync(join(cwd, f)), f);
    const m = JSON.parse(readFileSync(join(cwd, '.mns', 'mns.json'), 'utf8'));
    assert.equal(m.version, 1);
    assert.deepEqual(m.layout, ['knowledge', 'memory', 'actions', 'instructions', 'guardrails']);
    assert.equal(homeExists(cwd), true);
  });
});

test('re-apply is a no-op plan (idempotent)', () => {
  withTemp((cwd) => {
    applyScaffold(cwd, { now: 0 });
    const second = planScaffold(cwd);
    assert.deepEqual(second, { dirs: [], files: [], manifestMissing: false });
  });
});

test('no-clobber: user edits to seeded files survive re-apply', () => {
  withTemp((cwd) => {
    applyScaffold(cwd, { now: 0 });
    const target = join(cwd, '.mns', 'instructions', 'project.md');
    writeFileSync(target, 'MY CUSTOM STEERING\n');
    applyScaffold(cwd, { now: 1 });
    assert.equal(readFileSync(target, 'utf8'), 'MY CUSTOM STEERING\n');
  });
});

test('partial home: apply restores only the missing pieces', () => {
  withTemp((cwd) => {
    applyScaffold(cwd, { now: 0 });
    rmSync(join(cwd, '.mns', 'memory'), { recursive: true });
    const plan = applyScaffold(cwd, { now: 1 });
    assert.deepEqual(plan.dirs, ['.mns/memory', '.mns/memory/entries', '.mns/memory/inbox', '.mns/memory/proposals']);
    assert.deepEqual(plan.files, ['.mns/memory/README.md']);
    assert.ok(existsSync(join(cwd, '.mns', 'memory', 'README.md')));
  });
});

test('ensureGitignore creates/appends without duplicating, preserving content', () => {
  withTemp((cwd) => {
    assert.deepEqual(ensureGitignore(cwd), IGNORE_LINES); // created
    assert.deepEqual(ensureGitignore(cwd), []); // already covered
    const gi = join(cwd, '.gitignore');
    writeFileSync(gi, 'node_modules/\n');
    assert.deepEqual(ensureGitignore(cwd), IGNORE_LINES); // re-appended after overwrite
    const text = readFileSync(gi, 'utf8');
    assert.ok(text.startsWith('node_modules/\n'), 'user content preserved first');
    for (const l of IGNORE_LINES) assert.equal(text.split('\n').filter((x) => x.trim() === l).length, 1);
  });
});

test('scaffold includes the actions/inbox dir', () => {
  withTemp((cwd) => {
    applyScaffold(cwd, { now: 0 });
    assert.ok(existsSync(join(cwd, '.mns', 'actions', 'inbox')), 'actions/inbox exists');
  });
});
