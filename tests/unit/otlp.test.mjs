import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toExportRequest, toNdjson } from '../../zuzuu/capture/core/otlp.mjs';

const built = { traceId: 'a'.repeat(32), spans: [{ spanId: 'b'.repeat(16), name: 'x' }] };
const meta = { host: 'claude-code', sessionId: 'sess' };

test('toExportRequest nests resourceSpans -> resource + scopeSpans -> scope + spans', () => {
  const req = toExportRequest(built, meta);
  const rs = req.resourceSpans[0];
  assert.ok(Array.isArray(rs.resource.attributes));
  const ss = rs.scopeSpans[0];
  assert.ok(ss.scope.name);
  assert.equal(ss.spans, built.spans);
});

test('resource attributes carry service.name, host.name, session.id', () => {
  const rs = toExportRequest(built, meta).resourceSpans[0];
  const attrs = Object.fromEntries(rs.resource.attributes.map((a) => [a.key, a.value.stringValue]));
  assert.equal(attrs['service.name'], 'zuzuu');
  assert.equal(attrs['host.name'], 'claude-code');
  assert.equal(attrs['session.id'], 'sess');
});

test('toNdjson writes one request per line with a trailing newline', () => {
  const out = toNdjson([toExportRequest(built, meta), toExportRequest(built, meta)]);
  assert.ok(out.endsWith('\n'));
  const lines = out.trim().split('\n');
  assert.equal(lines.length, 2);
  assert.doesNotThrow(() => lines.forEach((l) => JSON.parse(l)));
});
