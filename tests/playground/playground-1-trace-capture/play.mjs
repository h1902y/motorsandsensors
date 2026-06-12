// Playground 1 — trace capture works end-to-end on a real Claude Code session.
//
// Captures this repo's latest Claude session through the full pipeline and
// asserts the result is a sane tree. Skips if no Claude session exists here.

import { claudeCode } from '../../../zuzuu/capture/adapters/claude-code.mjs';
import { eventsToSpans } from '../../../zuzuu/capture/core/spans.mjs';
import { EventKind } from '../../../zuzuu/capture/core/event.mjs';
import { run, check, note, skip } from '../_harness.mjs';

await run('capture a real Claude Code session and verify the tree', async () => {
  if (!claudeCode.detect()) skip('Claude Code not present (~/.claude absent)');
  const sessions = claudeCode.listSessions({ cwd: process.cwd() });
  if (!sessions.length) skip('no Claude session recorded for this repo yet');

  const t = claudeCode.parse(sessions[0].ref);
  const counts = {};
  for (const e of t.events) counts[e.kind] = (counts[e.kind] || 0) + 1;
  const root = t.events.find((e) => e.kind === EventKind.SESSION);
  note(`session ${t.sessionId.slice(0, 8)} — ${t.events.length} events (${Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(', ')})`);
  note(`wall-clock ${((root.endMs - root.startMs) / 60000).toFixed(1)}m`);

  check(counts[EventKind.SESSION] === 1, 'exactly one SESSION root');
  check((counts[EventKind.TOOL_CALL] || 0) >= 1, 'at least one tool_call captured');
  check(t.events.every((e) => e.endMs >= e.startMs), 'no negative-duration events');

  const { traceId, spans } = eventsToSpans(t);
  check(/^[0-9a-f]{32}$/.test(traceId), 'trace_id is valid 32-hex');
  check(spans.length === t.events.length, 'every event became a span');
  const ids = new Set(spans.map((s) => s.spanId));
  check(spans.every((s) => !s.parentSpanId || ids.has(s.parentSpanId)), 'every parent span resolves');
});
