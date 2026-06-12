// tests/unit/faculty-cli.test.mjs — `zuzuu faculty items|schema` (W24).
// The read surface over the Faculty Standard: --json document shape, --jsonl
// line-per-item streaming, human view, and the schema source resolution.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { facultyItemsData, facultySchemaData } from '../../zuzuu/commands/faculty.mjs';
import { serializeEnvelope, PAYLOAD_SCHEMAS } from '../../zuzuu/faculty/envelope.mjs';

const RULE = (id, action, pattern) => serializeEnvelope({
  id, faculty: 'guardrails', kind: 'rule', title: `${action} ${pattern}`,
  status: 'active', created_at: '2026-06-12T00:00:00Z',
  payload: { action, tool: '*', pattern, reason: `${action} it` }, body: '',
});

function withHome(fn) {
  const root = mkdtempSync(join(tmpdir(), 'zfac-'));
  const dir = join(root, '.zuzuu');
  mkdirSync(dir, { recursive: true });
  try { return fn(dir); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('facultyItemsData: envelope items listed with count; parse errors sit alongside, never thrown', () => {
  withHome((dir) => {
    const items = join(dir, 'guardrails', 'items');
    mkdirSync(items, { recursive: true });
    writeFileSync(join(items, 'a-rule.md'), RULE('a-rule', 'deny', 'rm -rf'));
    writeFileSync(join(items, 'b-rule.md'), RULE('b-rule', 'ask', 'git push'));
    writeFileSync(join(items, 'broken.md'), 'no frontmatter here\n');

    const data = facultyItemsData(dir, 'guardrails');
    assert.equal(data.faculty, 'guardrails');
    assert.equal(data.count, 2);
    assert.deepEqual(data.items.map((i) => i.id), ['a-rule', 'b-rule']);
    assert.equal(data.items[0].payload.action, 'deny');
    assert.equal(data.errors.length, 1);
    assert.equal(data.errors[0].file, 'broken.md');
  });
});

test('facultyItemsData: actions are dir-shaped (ACTION.md); inbox/proposals excluded', () => {
  withHome((dir) => {
    mkdirSync(join(dir, 'actions', 'greet'), { recursive: true });
    writeFileSync(join(dir, 'actions', 'greet', 'ACTION.md'), serializeEnvelope({
      id: 'greet', faculty: 'actions', kind: 'script', title: 'Greet',
      status: 'active', created_at: '2026-06-12T00:00:00Z',
      payload: { exec: 'run.mjs' }, body: 'say hello',
    }));
    mkdirSync(join(dir, 'actions', 'inbox', 'pending'), { recursive: true });
    writeFileSync(join(dir, 'actions', 'inbox', 'pending', 'ACTION.md'), serializeEnvelope({
      id: 'pending', faculty: 'actions', kind: 'runbook', title: 'P',
      status: 'active', created_at: '2026-06-12T00:00:00Z', payload: {}, body: 'x',
    }));

    const data = facultyItemsData(dir, 'actions');
    assert.deepEqual(data.items.map((i) => i.id), ['greet']);
    assert.equal(data.items[0].payload.exec, 'run.mjs');
  });
});

test('facultyItemsData: empty faculty → count 0, no errors (a bare home is fine)', () => {
  withHome((dir) => {
    const data = facultyItemsData(dir, 'memory');
    assert.deepEqual(data, { faculty: 'memory', count: 0, items: [], errors: [] });
  });
});

test('--json and --jsonl shapes: document round-trips; jsonl = one parseable line per item', () => {
  withHome((dir) => {
    const items = join(dir, 'knowledge', 'items');
    mkdirSync(items, { recursive: true });
    for (const id of ['k-one', 'k-two', 'k-three']) {
      writeFileSync(join(items, `${id}.md`), serializeEnvelope({
        id, faculty: 'knowledge', kind: 'fact', title: id,
        status: 'active', created_at: '2026-06-12T00:00:00Z',
        payload: { type: 'fact' }, body: `${id} body`,
      }));
    }
    const data = facultyItemsData(dir, 'knowledge');

    // --json: one document
    const doc = JSON.parse(JSON.stringify(data, null, 2));
    assert.equal(doc.count, 3);
    assert.equal(doc.items[0].payload.type, 'fact');

    // --jsonl: each item serializes to exactly one line, each line parses back
    const lines = data.items.map((i) => JSON.stringify(i));
    assert.equal(lines.length, 3);
    for (const line of lines) {
      assert.ok(!line.includes('\n'));
      const back = JSON.parse(line);
      assert.equal(back.faculty, 'knowledge');
      assert.ok(back.id.startsWith('k-'));
    }
  });
});

test('facultySchemaData: home-seeded schema.json wins; absent/broken → built-in default', () => {
  withHome((dir) => {
    // absent → builtin
    let r = facultySchemaData(dir, 'guardrails');
    assert.equal(r.source, 'builtin');
    assert.deepEqual(r.schema, PAYLOAD_SCHEMAS.guardrails);

    // seeded → home
    mkdirSync(join(dir, 'guardrails'), { recursive: true });
    writeFileSync(join(dir, 'guardrails', 'schema.json'), JSON.stringify({ type: 'object', required: ['action'] }));
    r = facultySchemaData(dir, 'guardrails');
    assert.equal(r.source, 'home');
    assert.deepEqual(r.schema.required, ['action']);

    // broken seed → builtin, never a throw
    writeFileSync(join(dir, 'guardrails', 'schema.json'), '{nope');
    r = facultySchemaData(dir, 'guardrails');
    assert.equal(r.source, 'builtin');
  });
});
