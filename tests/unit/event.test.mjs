import { test } from 'node:test';
import assert from 'node:assert/strict';
import { event, trace, EventKind, Status } from '../../zuzuu/capture/core/event.mjs';

test('event requires a refId', () => {
  assert.throws(() => event({ kind: EventKind.TOOL_CALL, name: 'x', startMs: 0 }), /refId required/);
});

test('event defaults: endMs<-startMs, status UNSET, name<-kind, parentRefId null', () => {
  const e = event({ kind: EventKind.SESSION, refId: 's', startMs: 100 });
  assert.equal(e.endMs, 100);
  assert.equal(e.status, Status.UNSET);
  assert.equal(e.name, 'session');
  assert.equal(e.parentRefId, null);
});

test('event coerces numeric strings and stringifies ids', () => {
  const e = event({ kind: EventKind.TURN, refId: 42, parentRefId: 7, name: 't', startMs: '100', endMs: '250' });
  assert.equal(e.startMs, 100);
  assert.equal(e.endMs, 250);
  assert.equal(e.refId, '42');
  assert.equal(e.parentRefId, '7');
});

test('trace() carries host/sessionId/title/events with sessionId stringified', () => {
  const t = trace({ host: 'h', sessionId: 9, events: [] });
  assert.deepEqual(t, { host: 'h', sessionId: '9', title: '', events: [] });
});
