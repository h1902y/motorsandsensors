import { test } from 'node:test';
import assert from 'node:assert/strict';
import { traceId, spanId, traceparent } from '../../zuzuu/capture/core/ids.mjs';

test('traceId is deterministic for the same inputs', () => {
  assert.equal(traceId('claude-code', 's1'), traceId('claude-code', 's1'));
});

test('traceId varies with host and session', () => {
  assert.notEqual(traceId('claude-code', 's1'), traceId('gemini-cli', 's1'));
  assert.notEqual(traceId('claude-code', 's1'), traceId('claude-code', 's2'));
});

test('traceId is 32 lowercase hex chars and never all-zero', () => {
  const id = traceId('h', 's');
  assert.match(id, /^[0-9a-f]{32}$/);
  assert.notEqual(id, '0'.repeat(32));
});

test('spanId is deterministic, 16 hex chars, varies with refId', () => {
  const t = traceId('h', 's');
  assert.equal(spanId(t, 'r1'), spanId(t, 'r1'));
  assert.match(spanId(t, 'r1'), /^[0-9a-f]{16}$/);
  assert.notEqual(spanId(t, 'r1'), spanId(t, 'r2'));
});

test('traceparent has the W3C version-trace-span-flags shape', () => {
  const t = traceId('h', 's');
  const s = spanId(t, 'r');
  assert.equal(traceparent(t, s), `00-${t}-${s}-01`);
  assert.match(traceparent(t, s), /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
});
