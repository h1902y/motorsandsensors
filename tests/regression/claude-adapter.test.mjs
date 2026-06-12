import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { claudeCode } from '../../zuzuu/capture/adapters/claude-code.mjs';
import { eventsToSpans } from '../../zuzuu/capture/core/spans.mjs';
import { EventKind, Status } from '../../zuzuu/capture/core/event.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, '..', 'fixtures', 'claude-sample.jsonl');

const parsed = claudeCode.parse(FIXTURE);
const byKind = (k) => parsed.events.filter((e) => e.kind === k);
const byRef = (r) => parsed.events.find((e) => e.refId === r);

test('claude fixture normalizes to session=1, turn=1, tool_call=2', () => {
  assert.equal(parsed.host, 'claude-code');
  assert.equal(parsed.sessionId, 'sess-test');
  assert.equal(byKind(EventKind.SESSION).length, 1);
  assert.equal(byKind(EventKind.TURN).length, 1);
  assert.equal(byKind(EventKind.TOOL_CALL).length, 2);
});

test('tree is wired session <- turn <- tools', () => {
  assert.equal(byRef('sess-test').parentRefId, null);
  assert.equal(byRef('p1').parentRefId, 'sess-test');
  assert.equal(byRef('tu1').parentRefId, 'p1');
  assert.equal(byRef('tu2').parentRefId, 'p1');
});

test('tool status reflects is_error, durations come from tool_result timestamps', () => {
  assert.equal(byRef('tu1').status, Status.OK);
  assert.equal(byRef('tu2').status, Status.ERROR);
  // tu1: 10:00:01 -> 10:00:03.500 = 2500ms
  assert.equal(byRef('tu1').endMs - byRef('tu1').startMs, 2500);
});

test('session spans the full transcript time range', () => {
  const s = byRef('sess-test');
  assert.equal(s.startMs, Date.parse('2026-06-09T10:00:00.000Z'));
  assert.equal(s.endMs, Date.parse('2026-06-09T10:00:09.000Z'));
});

// Golden: locks the deterministic id algorithm. Regenerate from an actual run if
// the id scheme intentionally changes — never hand-edit these hashes.
test('deterministic trace_id and span_ids are stable', () => {
  const { traceId, spans } = eventsToSpans(parsed);
  assert.equal(traceId, '8da3f1900fbab38f0225467d86d0fefc');
  const ids = Object.fromEntries(parsed.events.map((e, i) => [e.refId, spans[i].spanId]));
  assert.deepEqual(ids, {
    'sess-test': '78d7c8352f057fd7',
    p1: '5867741de9f223b2',
    tu1: '8031811f1fda45da',
    tu2: '5e8c0ea4675b7a24',
  });
});
