// Tiny playground harness. Encodes the three-state contract the runner relies on:
//   exit 0 = pass, exit 2 = skip (host data absent), anything else = fail.
// 2 is a safe skip sentinel — Node uses 1 for uncaught throws and 134+ for
// signals, so a genuine crash still reads as a fail, never a skip.

export const SKIP_CODE = 2;

export function heading(title) {
  console.log(`\n▶ ${title}`);
}

/** Assert; on failure throw so the play.mjs top-level catch maps it to exit≠0. */
export function check(cond, msg) {
  if (!cond) throw new Error(msg);
  console.log(`  ✓ ${msg}`);
}

export function note(msg) {
  console.log(`  · ${msg}`);
}

/** Neutral skip: host data not present on this machine. Not a failure. */
export function skip(msg) {
  console.log(`  ⏭️  skipped: ${msg}`);
  process.exit(SKIP_CODE);
}

/** Wrap a playground body so throws become a clean fail (exit 1) with a message. */
export async function run(title, body) {
  heading(title);
  try {
    await body();
    console.log(`  ✅ pass`);
    process.exit(0);
  } catch (e) {
    console.error(`  ❌ fail: ${e.message}`);
    process.exit(1);
  }
}

/** Structural OTLP/JSON conformance check. Returns an array of problem strings. */
export function otlpProblems(request) {
  const problems = [];
  const spans = [];
  for (const rs of request.resourceSpans || []) {
    if (!Array.isArray(rs.resource?.attributes)) problems.push('resource.attributes not an array');
    for (const ss of rs.scopeSpans || []) {
      if (!ss.scope?.name) problems.push('scope.name missing');
      for (const s of ss.spans || []) spans.push(s);
    }
  }
  const ids = new Set(spans.map((s) => s.spanId));
  for (const s of spans) {
    if (!/^[0-9a-f]{32}$/.test(s.traceId)) problems.push(`traceId not 32-hex: ${s.traceId}`);
    if (!/^[0-9a-f]{16}$/.test(s.spanId)) problems.push(`spanId not 16-hex: ${s.spanId}`);
    if (!/^[0-9]+$/.test(s.startTimeUnixNano) || !/^[0-9]+$/.test(s.endTimeUnixNano))
      problems.push(`timestamps not uint64 strings on ${s.name}`);
    if (s.parentSpanId && !ids.has(s.parentSpanId)) problems.push(`dangling parentSpanId on ${s.name}`);
    if (![0, 1, 2].includes(s.status?.code)) problems.push(`bad status code on ${s.name}`);
    for (const a of s.attributes || []) if (!a.key || typeof a.value !== 'object') problems.push(`bad attr on ${s.name}`);
  }
  return { problems, spanCount: spans.length };
}
