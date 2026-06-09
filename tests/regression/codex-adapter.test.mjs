import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { codex } from '../../experiments/experiment-1-trace-capture/adapters/codex.mjs';
import { eventsToSpans } from '../../experiments/experiment-1-trace-capture/core/spans.mjs';
import { EventKind } from '../../experiments/experiment-1-trace-capture/core/event.mjs';

// Fixture mirrors REAL Codex wire data (a captured `codex exec` rollout):
// {timestamp,type,payload}; turns from event_msg/user_message; tools paired by call_id.
const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'codex-sample.jsonl');
const parsed = codex.parse(FIXTURE);
const byKind = (k) => parsed.events.filter((e) => e.kind === k);
const byRef = (r) => parsed.events.find((e) => e.refId === r);

test('codex fixture normalizes to session=1, turn=1, tool_call=1', () => {
  assert.equal(parsed.host, 'codex');
  assert.equal(parsed.sessionId, 'codex-test');
  assert.equal(byKind(EventKind.SESSION).length, 1);
  assert.equal(byKind(EventKind.TURN).length, 1);
  assert.equal(byKind(EventKind.TOOL_CALL).length, 1);
});

test('turn comes from event_msg/user_message, not the injected developer message', () => {
  const turn = byKind(EventKind.TURN)[0];
  assert.match(turn.name, /list files/);
  assert.ok(!parsed.events.some((e) => /permissions instructions/.test(e.name)), 'developer/permissions msg is not a turn');
});

test('tool span pairs function_call ↔ function_call_output by call_id with real duration', () => {
  const tool = byRef('call_1');
  assert.equal(tool.name, 'exec_command');
  assert.equal(tool.parentRefId, 'codex-test:turn:0');
  assert.equal(tool.endMs - tool.startMs, 2500); // 17:00:02.000 → 17:00:04.500
});

// Golden: locks the Codex adapter's normalization + deterministic ids.
test('deterministic trace_id and span_ids are stable', () => {
  const { traceId, spans } = eventsToSpans(parsed);
  assert.equal(traceId, '597ec8084b23f3b232247e7bf83f8aa1');
  const ids = Object.fromEntries(parsed.events.map((e, i) => [e.refId, spans[i].spanId]));
  assert.deepEqual(ids, {
    'codex-test': '959da102cb352daa',
    'codex-test:turn:0': '698368dc5edd7b9b',
    call_1: '73921dc42fa32957',
  });
});
