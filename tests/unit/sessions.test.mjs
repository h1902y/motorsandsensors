// The sessions observability surface (overhaul Part A, 2026-06-13):
// `zuzuu sessions --json` (state-labelled list) and
// `zuzuu session inspect <id> --json` ({session, trace, signals}) — hermetic,
// against a seeded session index + the claude-sample transcript fixture.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sessionsListData, sessionInspectData } from '../../zuzuu/commands/sessions.mjs';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'claude-sample.jsonl');

const RECORDS = [
  {
    id: 'sess-test', host: 'claude-code', status: 'completed',
    startedAt: '2026-06-13T10:00:00.000Z', endedAt: '2026-06-13T10:05:00.000Z', durationMs: 300000,
    traceId: 'a'.repeat(32), traceRef: '.zuzuu/.traces/claude-code-sess-test.otlp.jsonl',
    git: { commit: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', branch: 'main' },
    counts: { turns: 2, tools: 2, errors: 1 }, generation: 'gen_001',
  },
  {
    id: 'sess-gone', host: 'claude-code', status: 'abandoned',
    startedAt: '2026-06-13T09:00:00.000Z', endedAt: '2026-06-13T09:01:00.000Z', durationMs: 60000,
    traceId: 'b'.repeat(32), traceRef: '.zuzuu/.traces/claude-code-sess-gone.otlp.jsonl',
    git: { commit: null, branch: null }, counts: { turns: 1, tools: 0, errors: 0 }, generation: null,
  },
];

/** One OTLP export request with `n` spans, as a one-line NDJSON blob. */
function otlpBlob(n) {
  const spans = Array.from({ length: n }, (_, i) => ({
    traceId: 'a'.repeat(32), spanId: String(i).padStart(16, '0'), name: `span-${i}`,
    startTimeUnixNano: '0', endTimeUnixNano: '1',
  }));
  return JSON.stringify({ resourceSpans: [{ resource: { attributes: [] }, scopeSpans: [{ scope: { name: 'zuzuu' }, spans }] }] }) + '\n';
}

function withSeededRepo(fn) {
  const cwd = mkdtempSync(join(tmpdir(), 'zuzuu-sessions-'));
  const home = join(cwd, '.zuzuu');
  mkdirSync(join(home, '.traces'), { recursive: true });
  writeFileSync(join(home, 'sessions.json'), JSON.stringify({ version: 1, sessions: RECORDS }, null, 2));
  writeFileSync(join(home, '.traces', 'claude-code-sess-test.otlp.jsonl'), otlpBlob(3));
  // sess-gone's blob is deliberately NOT written (the fail-soft path)
  try { return fn(cwd); } finally { rmSync(cwd, { recursive: true, force: true }); }
}

test('sessions --json: list with state labels, newest first, full record shape', () => {
  withSeededRepo((cwd) => {
    const d = sessionsListData(cwd);
    assert.equal(d.sessions.length, 2);
    const [a, b] = d.sessions;
    assert.equal(a.id, 'sess-test');
    assert.equal(a.state, 'completed');
    assert.equal(b.state, 'abandoned');
    for (const s of d.sessions) {
      assert.equal(typeof s.host, 'string');
      assert.equal(typeof s.durationMs, 'number');
      assert.equal(typeof s.counts.turns, 'number');
      assert.ok('generation' in s);
      assert.ok('git' in s);
    }
  });
});

test('sessions --json: empty index → empty list (never throws)', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'zuzuu-sessions-empty-'));
  try {
    assert.deepEqual(sessionsListData(cwd), { sessions: [] });
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('session inspect: {session, trace:{spans,tools,duration}, signals:{module:counts}}', () => {
  withSeededRepo((cwd) => {
    const d = sessionInspectData(cwd, 'sess-test', {
      transcripts: [{ host: 'claude-code', ref: FIXTURE, sessionId: 'sess-test' }],
    });
    assert.ok(d, 'found');
    // session block
    assert.equal(d.session.id, 'sess-test');
    assert.equal(d.session.state, 'completed');
    assert.equal(d.session.generation, 'gen_001');
    // trace summary: spans from the blob; tools/duration from the record
    assert.equal(d.trace.spans, 3);
    assert.equal(d.trace.tools, 2);
    assert.equal(d.trace.duration, 300000);
    // per-module signals via the modules' sessionSignals hooks
    // (claude-sample: 2 bash commands, 1 failed, 1 adjacent 2-gram, no files,
    //  no corrections, no destructive failures)
    assert.deepEqual(d.signals.knowledge, { commands: 2, files: 0, failures: 1 });
    assert.deepEqual(d.signals.actions, { sequences: 1 });
    assert.deepEqual(d.signals.instructions, { correctionTurns: 0 });
    assert.deepEqual(d.signals.guardrails, { destructiveFailures: 0 });
    assert.ok(!('memory' in d.signals), 'memory consumes no session signals yet');
    assert.deepEqual(d.warnings, []);
  });
});

test('session inspect: unique id prefix resolves (the table shows 8-char ids)', () => {
  withSeededRepo((cwd) => {
    const d = sessionInspectData(cwd, 'sess-t', { transcripts: [] });
    assert.equal(d.session.id, 'sess-test');
  });
});

test('session inspect: fail-soft — blob + transcript gone → warnings, never a throw', () => {
  withSeededRepo((cwd) => {
    const d = sessionInspectData(cwd, 'sess-gone', { transcripts: [] });
    assert.ok(d, 'found');
    assert.equal(d.trace.spans, null, 'span count unknown without the blob');
    assert.equal(d.trace.tools, 0);
    assert.deepEqual(d.signals, {}, 'no transcript → no signals');
    assert.ok(d.warnings.some((w) => w.includes('trace blob unavailable')));
    assert.ok(d.warnings.some((w) => w.includes('transcript unavailable')));
  });
});

test('session inspect: unknown id → null', () => {
  withSeededRepo((cwd) => {
    assert.equal(sessionInspectData(cwd, 'nope', { transcripts: [] }), null);
    assert.equal(sessionInspectData(cwd, undefined, { transcripts: [] }), null);
  });
});
