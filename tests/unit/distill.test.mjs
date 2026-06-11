import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mineTranscript, aggregate } from '../../zuzuu/knowledge/distill.mjs';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'claude-sample.jsonl');

test('mineTranscript extracts commands + failure flags from a real-shape transcript', () => {
  const m = mineTranscript(FIXTURE);
  assert.equal(m.sessionId, 'sess-test');
  assert.deepEqual(m.commands.map((c) => c.cmd), ['npm run build', 'npm test']);
  assert.deepEqual(m.commands.map((c) => c.failed), [false, true]);
  assert.deepEqual(m.failures, ['Bash']);
});

const sess = (id, commands = [], files = [], failures = []) => ({ sessionId: id, commands, files, failures });

test('aggregate: command crosses thresholds only with enough count AND session spread', () => {
  const c = { cmd: 'npm test', failed: false };
  // 3 uses but single session → no candidate
  assert.equal(aggregate([sess('s1', [c, c, c])]).length, 0);
  // 3 uses across 2 sessions → command candidate with evidence
  const out = aggregate([sess('s1', [c, c]), sess('s2', [c])]);
  assert.equal(out.length, 1);
  assert.equal(out[0].candidate.type, 'command');
  assert.equal(out[0].candidate.attributes.command, 'npm test');
  assert.equal(out[0].evidence.occurrences, 3);
  assert.equal(out[0].evidence.sessions, 2);
  assert.ok(out[0].candidate.provenance.length >= 2, 'provenance carries session ids');
});

test('aggregate: hot files at ≥5 touches; failing tools at ≥3 failures', () => {
  const out = aggregate([
    sess('s1', [], ['/p/a.mjs', '/p/a.mjs', '/p/a.mjs'], ['Edit', 'Edit']),
    sess('s2', [], ['/p/a.mjs', '/p/a.mjs', '/p/b.mjs'], ['Edit']),
  ]);
  const file = out.find((c) => c.candidate.type === 'entity');
  assert.ok(file, 'hot-file candidate exists');
  assert.equal(file.candidate.attributes.path, '/p/a.mjs');
  assert.equal(file.evidence.occurrences, 5);
  const fail = out.find((c) => c.candidate.id.startsWith('failing-tool'));
  assert.ok(fail);
  assert.match(fail.candidate.body, /Edit.*3 failures/);
  assert.ok(!out.some((c) => c.candidate.attributes?.path === '/p/b.mjs'), 'below-threshold file excluded');
});

test('aggregate is deterministic (same input → same candidates)', () => {
  const input = [sess('s1', [{ cmd: 'npm test', failed: false }], ['/x.mjs']), sess('s2', [{ cmd: 'npm test', failed: true }, { cmd: 'npm test', failed: false }], [])];
  assert.deepEqual(JSON.stringify(aggregate(input)), JSON.stringify(aggregate(input)));
});
