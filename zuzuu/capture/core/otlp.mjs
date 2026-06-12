// Spans -> OTLP/JSON ExportTraceServiceRequest, and NDJSON writer.
//
// Output format: one COMPLETE OTLP/JSON request per line
//   { "resourceSpans": [ { "resource": {...}, "scopeSpans": [ { "scope": {...}, "spans": [...] } ] } ] }
// This is exactly what the OpenTelemetry Collector `otlpjsonfilereceiver` ingests
// (newline-delimited ExportTraceServiceRequest objects) — so a trace we write
// locally today is replayable into any OTel backend later, no converter.
//
// NOTE: verify the precise nesting against the receiver spec before claiming
// drop-in interop for an external consumer (tracked in the experiment README’s Conclusions).

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCOPE = { name: 'zuzuu/trace-capture', version: '0.1.0' };

function strAttr(key, value) {
  return { key, value: { stringValue: String(value) } };
}

/**
 * Wrap spans into one ExportTraceServiceRequest.
 * @param {{traceId:string, spans:object[]}} built  from eventsToSpans()
 * @param {{host:string, sessionId:string}} meta
 */
export function toExportRequest(built, meta) {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            strAttr('service.name', 'zuzuu'),
            strAttr('service.version', '0.1.0'),
            strAttr('host.name', meta.host), // which host CLI this trace was observed from
            strAttr('session.id', meta.sessionId),
          ],
        },
        scopeSpans: [{ scope: SCOPE, spans: built.spans }],
      },
    ],
  };
}

/** Serialize one or more export requests as NDJSON (one request per line). */
export function toNdjson(requests) {
  return requests.map((r) => JSON.stringify(r)).join('\n') + '\n';
}

/** Write NDJSON to disk, creating parent dirs. Returns the path. */
export function writeNdjson(path, requests) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, toNdjson(requests));
  return path;
}
