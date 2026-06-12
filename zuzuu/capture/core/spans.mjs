// Event[] -> OpenTelemetry spans (data model). Host-agnostic: pure id-wiring.

import { traceId, spanId } from './ids.mjs';
import { Status } from './event.mjs';

// OTLP status codes: 0 UNSET, 1 OK, 2 ERROR.
const STATUS_CODE = { [Status.UNSET]: 0, [Status.OK]: 1, [Status.ERROR]: 2 };
// SpanKind 1 = INTERNAL (we observe, we don't classify client/server here).
const SPAN_KIND_INTERNAL = 1;

const msToUnixNano = (ms) => String(Math.round(ms) * 1_000_000);

/** Encode a JS value as an OTLP/JSON AnyValue-wrapped attribute. */
function attr(key, value) {
  let v;
  if (typeof value === 'boolean') v = { boolValue: value };
  else if (typeof value === 'number') v = Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value };
  else v = { stringValue: String(value) };
  return { key, value: v };
}

/**
 * @param {import('./event.mjs').trace} t  normalized trace from an adapter
 * @returns {{ traceId: string, spans: object[] }} OTLP/JSON span objects
 */
export function eventsToSpans(t) {
  const tid = traceId(t.host, t.sessionId);
  const spans = t.events.map((e) => {
    const span = {
      traceId: tid,
      spanId: spanId(tid, e.refId),
      name: e.name,
      kind: SPAN_KIND_INTERNAL,
      startTimeUnixNano: msToUnixNano(e.startMs),
      endTimeUnixNano: msToUnixNano(e.endMs),
      attributes: Object.entries(e.attributes).map(([k, v]) => attr(k, v)),
      status: { code: STATUS_CODE[e.status] ?? 0 },
    };
    if (e.parentRefId != null) span.parentSpanId = spanId(tid, e.parentRefId);
    return span;
  });
  return { traceId: tid, spans };
}
