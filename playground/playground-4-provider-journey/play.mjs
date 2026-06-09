// Playground 4 — the provider journey matrix.
//
// For each of the four major hosts, exercise the journey against whatever is real
// on THIS machine and print an honest verdict. No fabricated green: a provider
// with no adapter, or an adapter but no data here, is reported as such — not as a
// pass. Fails only if a provider that HAS data produces an invalid trace.

import { byName } from '../../experiments/experiment-1-trace-capture/adapters/registry.mjs';
import { eventsToSpans } from '../../experiments/experiment-1-trace-capture/core/spans.mjs';
import { toExportRequest } from '../../experiments/experiment-1-trace-capture/core/otlp.mjs';
import { EventKind } from '../../experiments/experiment-1-trace-capture/core/event.mjs';
import { run, check, note, skip, otlpProblems } from '../_harness.mjs';

const PROVIDERS = ['claude-code', 'gemini-cli', 'codex', 'opencode'];

await run('provider journey: capture → OTLP across the four major hosts', async () => {
  let exercised = 0;
  const rows = [];

  for (const name of PROVIDERS) {
    const adapter = byName(name);
    if (!adapter) {
      rows.push(`  ✗ ${name.padEnd(12)} no adapter (planned)`);
      continue;
    }
    const sessions = adapter.listSessions({ cwd: process.cwd() });
    if (!sessions.length) {
      rows.push(`  ⏭ ${name.padEnd(12)} adapter present, no data on this machine`);
      continue;
    }

    // Real data → run the full capture journey and validate the OTLP.
    const trace = adapter.parse(sessions[0].ref);
    const { traceId, spans } = eventsToSpans(trace);
    const request = toExportRequest({ traceId, spans }, { host: trace.host, sessionId: trace.sessionId });
    const { problems } = otlpProblems(request);
    check(problems.length === 0, `${name}: valid OTLP (${spans.length} spans, ${problems.length} problems)`);
    const tools = trace.events.filter((e) => e.kind === EventKind.TOOL_CALL).length;
    rows.push(`  ✓ ${name.padEnd(12)} ${String(spans.length).padStart(4)} spans  ${tools ? 'rich (→tool)' : 'thin (→turn)'}  [REAL]`);
    exercised++;
  }

  note('matrix:');
  for (const r of rows) console.log(r);

  if (!exercised) skip('no provider has data on this machine (fresh checkout) — nothing to exercise');
  check(exercised >= 1, `${exercised} provider(s) exercised against real data`);
});
