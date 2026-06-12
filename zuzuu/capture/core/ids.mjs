// W3C TraceContext id generation — host-agnostic.
//
// trace_id = 16 bytes (32 hex), span_id = 8 bytes (16 hex). We derive them
// DETERMINISTICALLY from stable inputs (host+sessionId, and the event's refId)
// so that re-capturing the same host log yields the same trace — captures are
// idempotent, and a span's parent_span_id is just `spanId(parentRefId)` with no
// lookup table. Determinism is a property of static-log parsing; a live tracer
// would use crypto.randomBytes instead.

import { createHash } from 'node:crypto';

/** Lowercase hex of the first `bytes` bytes of sha256(parts.join('\0')). */
function hashHex(bytes, ...parts) {
  return createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, bytes * 2);
}

/** 32-hex-char trace id, stable per (host, sessionId). Never all-zero. */
export function traceId(host, sessionId) {
  const id = hashHex(16, 'trace', host, sessionId);
  return id === '0'.repeat(32) ? '0'.repeat(31) + '1' : id;
}

/** 16-hex-char span id, stable per (traceId, refId). Never all-zero. */
export function spanId(traceIdHex, refId) {
  const id = hashHex(8, 'span', traceIdHex, refId);
  return id === '0'.repeat(16) ? '0'.repeat(15) + '1' : id;
}

/** W3C `traceparent` header value: version-traceid-spanid-flags (sampled). */
export function traceparent(traceIdHex, spanIdHex) {
  return `00-${traceIdHex}-${spanIdHex}-01`;
}
