import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LAYOUT, IGNORE_LINES, planScaffold, applyScaffold, ensureGitignore, homeExists } from '../../zuzuu/scaffold.mjs';
import { parseEnvelope, validateEnvelope, PAYLOAD_SCHEMAS } from '../../zuzuu/faculty/envelope.mjs';

function withTemp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'zuzuu-scaffold-'));
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
    assert.ok(existsSync(join(cwd, '.zuzuu', 'README.md')), '.zuzuu/README.md scaffolded');
    const m = JSON.parse(readFileSync(join(cwd, '.zuzuu', 'agent.json'), 'utf8'));
    assert.equal(m.version, 4);
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
    const target = join(cwd, '.zuzuu', 'instructions', 'items', 'steering.md');
    writeFileSync(target, 'MY CUSTOM STEERING\n');
    applyScaffold(cwd, { now: 1 });
    assert.equal(readFileSync(target, 'utf8'), 'MY CUSTOM STEERING\n');
  });
});

test('seeded envelopes + schemas are valid against their own standard', () => {
  withTemp((cwd) => {
    applyScaffold(cwd, { now: 0 });
    const home = join(cwd, '.zuzuu');
    JSON.parse(readFileSync(join(home, 'schema.json'), 'utf8')); // envelope spec parses
    for (const f of ['knowledge', 'memory', 'actions', 'instructions', 'guardrails']) {
      JSON.parse(readFileSync(join(home, f, 'schema.json'), 'utf8'));
    }
    for (const id of ['no-root-wipe', 'no-secret-reads', 'confirm-force-push']) {
      const { ok, item } = parseEnvelope(readFileSync(join(home, 'guardrails', 'items', `${id}.md`), 'utf8'));
      assert.ok(ok, `${id} parses`);
      const v = validateEnvelope(item, PAYLOAD_SCHEMAS.guardrails);
      assert.ok(v.ok, `${id} valid: ${v.errors}`);
    }
    const steering = parseEnvelope(readFileSync(join(home, 'instructions', 'items', 'steering.md'), 'utf8'));
    assert.ok(steering.ok);
    assert.ok(validateEnvelope(steering.item, PAYLOAD_SCHEMAS.instructions).ok);
  });
});

test('partial home: apply restores only the missing pieces', () => {
  withTemp((cwd) => {
    applyScaffold(cwd, { now: 0 });
    rmSync(join(cwd, '.zuzuu', 'memory'), { recursive: true });
    const plan = applyScaffold(cwd, { now: 1 });
    assert.deepEqual(plan.dirs, ['.zuzuu/memory', '.zuzuu/memory/entries', '.zuzuu/memory/inbox', '.zuzuu/memory/proposals']);
    assert.deepEqual(plan.files, ['.zuzuu/memory/README.md', '.zuzuu/memory/schema.json']);
    assert.ok(existsSync(join(cwd, '.zuzuu', 'memory', 'README.md')));
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
    assert.ok(existsSync(join(cwd, '.zuzuu', 'actions', 'inbox')), 'actions/inbox exists');
  });
});
