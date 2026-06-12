// Render an OTLP/JSON trace file as a span tree. Shared by the experiment's
// inspect-trace CLI and the app-level `mns trace` command.

import { readFileSync } from 'node:fs';

const MARK = { 0: '•', 1: '•', 2: '✗' };

/** Load all spans (+ first resource attrs) from an OTLP/JSON NDJSON file. */
export function loadSpans(file) {
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const spans = [];
  const resources = [];
  for (const line of lines) {
    const req = JSON.parse(line);
    for (const rs of req.resourceSpans || []) {
      resources.push(Object.fromEntries((rs.resource?.attributes || []).map((a) => [a.key, a.value?.stringValue])));
      for (const ss of rs.scopeSpans || []) for (const s of ss.spans || []) spans.push(s);
    }
  }
  return { spans, resource: resources[0] || {} };
}

// nanosecond strings exceed Number.MAX_SAFE_INTEGER — use BigInt for durations.
const durMs = (s) => Number((BigInt(s.endTimeUnixNano) - BigInt(s.startTimeUnixNano)) / 1_000_000n);

function fmtDur(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

/** Build a printable span-tree string from { spans, resource }. */
export function renderTree({ spans, resource = {} }) {
  if (!spans.length) return '(no spans)';

  const byId = new Map(spans.map((s) => [s.spanId, s]));
  const children = new Map();
  const roots = [];
  for (const s of spans) {
    const parent = s.parentSpanId && byId.has(s.parentSpanId) ? s.parentSpanId : null;
    if (parent) {
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(s);
    } else roots.push(s);
  }
  const sortByStart = (a, b) => (BigInt(a.startTimeUnixNano) < BigInt(b.startTimeUnixNano) ? -1 : 1);

  const lines = [];
  lines.push(`host=${resource['host.name'] || '?'}  session=${resource['session.id'] || '?'}  trace=${spans[0].traceId}`);
  lines.push(`spans=${spans.length}\n`);

  function walk(s, depth) {
    const pad = '  '.repeat(depth);
    const err = s.status?.code === 2 ? '  [ERROR]' : '';
    lines.push(`${pad}${MARK[s.status?.code || 0]} ${s.name}  ${fmtDur(durMs(s))}${err}`);
    (children.get(s.spanId) || []).sort(sortByStart).forEach((c) => walk(c, depth + 1));
  }
  roots.sort(sortByStart).forEach((r) => walk(r, 0));

  const errors = spans.filter((s) => s.status?.code === 2).length;
  lines.push(`\n${spans.length} spans, ${errors} error(s)`);
  return lines.join('\n');
}
