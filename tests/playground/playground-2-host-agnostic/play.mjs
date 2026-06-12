// Playground 2 — host-agnosticity, demonstrated on real data.
//
// Runs every host that has data on this machine through the SAME core and checks
// each yields a valid trace. The point is plural: it needs ≥2 hosts to actually
// demonstrate agnosticity, so it skips if fewer than two are present.

import { detected } from '../../../zuzuu/capture/adapters/registry.mjs';
import { eventsToSpans } from '../../../zuzuu/capture/core/spans.mjs';
import { EventKind } from '../../../zuzuu/capture/core/event.mjs';
import { run, check, note, skip } from '../_harness.mjs';

await run('same core, multiple hosts → valid traces (agnosticity)', async () => {
  const hosts = detected();
  const withData = hosts
    .map((a) => ({ adapter: a, sessions: a.listSessions({ cwd: process.cwd() }) }))
    .filter((h) => h.sessions.length);

  if (withData.length < 2) skip(`need ≥2 hosts with data, found ${withData.length} (${withData.map((h) => h.adapter.name).join(', ') || 'none'})`);

  for (const { adapter, sessions } of withData) {
    const t = adapter.parse(sessions[0].ref);
    const counts = {};
    for (const e of t.events) counts[e.kind] = (counts[e.kind] || 0) + 1;
    const depth = (counts[EventKind.TOOL_CALL] || 0) > 0 ? 'rich (session→turn→tool)' : 'thin (session→turn)';
    note(`${adapter.name.padEnd(12)} ${t.events.length} events — ${depth}`);

    const { traceId, spans } = eventsToSpans(t);
    check(/^[0-9a-f]{32}$/.test(traceId), `${adapter.name}: valid trace_id`);
    check(spans.length === t.events.length && spans.length >= 1, `${adapter.name}: spans produced by the shared core`);
    check(spans[0].traceId === traceId, `${adapter.name}: spans carry the trace_id`);
  }

  note('rich-vs-thin difference is the per-host completeness gap — not a core change');
  check(withData.length >= 2, `demonstrated across ${withData.length} hosts`);
});
