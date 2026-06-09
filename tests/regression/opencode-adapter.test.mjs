import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildTrace } from '../../experiments/experiment-1-trace-capture/adapters/opencode.mjs';
import { eventsToSpans } from '../../experiments/experiment-1-trace-capture/core/spans.mjs';
import { EventKind, Status } from '../../experiments/experiment-1-trace-capture/core/event.mjs';

// Fixture is parsed-row shape (the pure buildTrace input), mirroring REAL
// opencode.db rows: session(model JSON) + message(role) + part(text|tool|reasoning).
// Tests the normalization hermetically — no SQLite needed (the real DB read is
// validated by `mns capture --host opencode`).
const FIXTURE = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'opencode-sample.json'), 'utf8'));
const parsed = buildTrace(FIXTURE);
const byKind = (k) => parsed.events.filter((e) => e.kind === k);
const byRef = (r) => parsed.events.find((e) => e.refId === r);

test('opencode fixture normalizes to session=1, turn=1, tool_call=1 (reasoning/step ignored)', () => {
  assert.equal(parsed.host, 'opencode');
  assert.equal(parsed.sessionId, 'ses_test');
  assert.equal(byKind(EventKind.SESSION).length, 1);
  assert.equal(byKind(EventKind.TURN).length, 1);
  assert.equal(byKind(EventKind.TOOL_CALL).length, 1);
});

test('turn text comes from the user message text part; tool parents to the turn', () => {
  assert.match(byRef('msg_u').name, /list files/);
  assert.equal(byRef('call_1').parentRefId, 'msg_u');
  assert.equal(byRef('call_1').name, 'bash');
});

test('tool duration comes from state.time.{start,end}; status maps from state.status', () => {
  assert.equal(byRef('call_1').endMs - byRef('call_1').startMs, 2500);
  assert.equal(byRef('call_1').status, Status.OK); // 'completed' → OK ('error' → ERROR)
});

// Golden: locks the OpenCode normalization + deterministic ids.
test('deterministic trace_id and span_ids are stable', () => {
  const { traceId, spans } = eventsToSpans(parsed);
  assert.equal(traceId, '04581d913ffbfb131c76ba6247cd9cbf');
  const ids = Object.fromEntries(parsed.events.map((e, i) => [e.refId, spans[i].spanId]));
  assert.deepEqual(ids, {
    ses_test: 'a0f6c9c112b392cf',
    msg_u: 'eb9ef5946a72e2f6',
    call_1: 'c0291e664d50f728',
  });
});
