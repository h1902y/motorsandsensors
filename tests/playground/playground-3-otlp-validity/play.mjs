// Playground 3 — captured output is structurally valid OTLP/JSON.
//
// Formalizes the inline conformance check from Experiment 1: capture a real
// session, wrap it as an ExportTraceServiceRequest, and assert it matches the
// OTLP/JSON shape (hex ids, uint64-nano string timestamps, AnyValue attrs,
// resolvable parents, valid status codes). Skips if no host data is present.

import { detected } from '../../../experiments/experiment-1-trace-capture/adapters/registry.mjs';
import { eventsToSpans } from '../../../experiments/experiment-1-trace-capture/core/spans.mjs';
import { toExportRequest } from '../../../experiments/experiment-1-trace-capture/core/otlp.mjs';
import { run, check, note, skip, otlpProblems } from '../_harness.mjs';

await run('captured trace is structurally valid OTLP/JSON', async () => {
  const withData = detected()
    .map((a) => ({ adapter: a, sessions: a.listSessions({ cwd: process.cwd() }) }))
    .filter((h) => h.sessions.length);

  if (!withData.length) skip('no host data on this machine to capture');

  const { adapter, sessions } = withData[0];
  const t = adapter.parse(sessions[0].ref);
  const { traceId, spans } = eventsToSpans(t);
  const request = toExportRequest({ traceId, spans }, { host: t.host, sessionId: t.sessionId });

  const { problems, spanCount } = otlpProblems(request);
  note(`validated ${spanCount} spans from ${adapter.name} session ${t.sessionId.slice(0, 8)}`);
  if (problems.length) problems.slice(0, 5).forEach((p) => note(`✗ ${p}`));

  check(spanCount >= 1, 'at least one span in the request');
  check(problems.length === 0, `OTLP/JSON structurally conformant (${problems.length} problems)`);
});
