import { test } from 'node:test';
import assert from 'node:assert/strict';
import { event, trace, EventKind, Status } from '../../zuzuu/capture/core/event.mjs';
import { eventsToSpans } from '../../zuzuu/capture/core/spans.mjs';
import { traceId, spanId } from '../../zuzuu/capture/core/ids.mjs';

const sample = () =>
  trace({
    host: 'h',
    sessionId: 's',
    events: [
      event({ kind: EventKind.SESSION, refId: 's', parentRefId: null, name: 'session', startMs: 1000, endMs: 5000 }),
      event({
        kind: EventKind.TOOL_CALL,
        refId: 't1',
        parentRefId: 's',
        name: 'Bash',
        startMs: 1500,
        endMs: 2000,
        status: Status.ERROR,
        attributes: { str: 'hi', int: 3, float: 1.5, bool: true },
      }),
    ],
  });

const attrMap = (span) => Object.fromEntries(span.attributes.map((a) => [a.key, a.value]));

test('parentSpanId === spanId(traceId, parentRefId); root has no parentSpanId', () => {
  const { traceId: tid, spans } = eventsToSpans(sample());
  assert.equal(tid, traceId('h', 's'));
  const [root, tool] = spans;
  assert.equal(root.parentSpanId, undefined);
  assert.equal(root.spanId, spanId(tid, 's'));
  assert.equal(tool.parentSpanId, spanId(tid, 's'));
  assert.equal(tool.spanId, spanId(tid, 't1'));
});

test('timestamps are ms*1e6 as uint64 strings', () => {
  const { spans } = eventsToSpans(sample());
  assert.equal(spans[0].startTimeUnixNano, '1000000000');
  assert.equal(spans[0].endTimeUnixNano, '5000000000');
  assert.match(spans[1].startTimeUnixNano, /^[0-9]+$/);
});

test('status codes map UNSET/OK/ERROR -> 0/1/2', () => {
  const { spans } = eventsToSpans(sample());
  assert.equal(spans[0].status.code, 0); // UNSET
  assert.equal(spans[1].status.code, 2); // ERROR
});

test('attributes encode as typed AnyValue', () => {
  const { spans } = eventsToSpans(sample());
  const a = attrMap(spans[1]);
  assert.deepEqual(a.str, { stringValue: 'hi' });
  assert.deepEqual(a.int, { intValue: '3' });
  assert.deepEqual(a.float, { doubleValue: 1.5 });
  assert.deepEqual(a.bool, { boolValue: true });
});
