import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { geminiCli } from '../../zuzuu/capture/adapters/gemini-cli.mjs';
import { eventsToSpans } from '../../zuzuu/capture/core/spans.mjs';
import { EventKind } from '../../zuzuu/capture/core/event.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, '..', 'fixtures', 'gemini-sample.logs.json');

const parsed = geminiCli.parse({ file: FIXTURE, sessionId: 'gsess-1' });
const byKind = (k) => parsed.events.filter((e) => e.kind === k);

test('gemini fixture normalizes to session=1, turn=3, and NO tool_call (thin host)', () => {
  assert.equal(parsed.host, 'gemini-cli');
  assert.equal(parsed.sessionId, 'gsess-1');
  assert.equal(byKind(EventKind.SESSION).length, 1);
  assert.equal(byKind(EventKind.TURN).length, 3);
  assert.equal(byKind(EventKind.TOOL_CALL).length, 0);
});

test('rows from other sessions are filtered out', () => {
  assert.ok(!parsed.events.some((e) => String(e.refId).startsWith('gsess-OTHER')));
});

test('all turns parent to the session root', () => {
  for (const e of byKind(EventKind.TURN)) assert.equal(e.parentRefId, 'gsess-1');
});

// Golden: locks the deterministic id algorithm for the thin-host path too.
test('deterministic trace_id and span_ids are stable', () => {
  const { traceId, spans } = eventsToSpans(parsed);
  assert.equal(traceId, '8df71140c902a0a294527555546d02a5');
  const ids = Object.fromEntries(parsed.events.map((e, i) => [e.refId, spans[i].spanId]));
  assert.deepEqual(ids, {
    'gsess-1': '3347ba0949657c6f',
    'gsess-1:0': 'd8ebcf2f1636e558',
    'gsess-1:1': '6a9535399d5e0d77',
    'gsess-1:2': '0e8639784e3d1991',
  });
});
