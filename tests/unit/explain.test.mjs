// tests/unit/explain.test.mjs (WS-B)
// `home explain [topic]` — discoverable docs for the 5 modules + graduation.
// Tests drive the pure explainText(topic) helper (no console scraping).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explainText, explain } from '../../zuzuu/commands/explain.mjs';

test('overview (no topic) names the modules, review, and generation', () => {
  const t = explainText();
  assert.ok(t.length > 0);
  assert.match(t, /knowledge/i);
  assert.match(t, /memory/i);
  assert.match(t, /actions/i);
  assert.match(t, /instructions/i);
  assert.match(t, /guardrails/i);
  assert.match(t, /review/i);
  assert.match(t, /generation/i);
});

test('explain modules shows the promotion path inbox→proposals→items', () => {
  const t = explainText('modules');
  assert.ok(t.length > 0);
  assert.match(t, /inbox/i);
  assert.match(t, /proposals/i);
});

test('explain graduation explains the human gate and rollback', () => {
  const t = explainText('graduation');
  assert.ok(t.length > 0);
  assert.match(t, /rollback/i);
  assert.match(t, /approve/i);
});

test('explain <module> returns that module contract', () => {
  for (const f of ['knowledge', 'memory', 'actions', 'instructions', 'guardrails']) {
    const t = explainText(f);
    assert.ok(t.length > 0, `${f} has text`);
    assert.match(t, new RegExp(f, 'i'));
  }
});

test('unknown topic → overview + a topics hint', () => {
  const t = explainText('wat');
  assert.match(t, /knowledge/i); // overview is included
  assert.match(t, /topics:/i);
});

test('explain(args, log) prints via the injected writer', () => {
  const lines = [];
  explain({ _: ['graduation'] }, (s) => lines.push(s));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /rollback/i);
});
