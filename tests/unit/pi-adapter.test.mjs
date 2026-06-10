// pi adapter — parse a minimal pi-shaped session JSONL → span tree.
// Built against REAL wire data (see experiments/.../adapters/pi.mjs header):
//   header line     { type:"session", version, id, timestamp, cwd }
//   user message    { type:"message", id, parentId, timestamp, message:{role:"user", content:[{type:"text",text}]} }
//   assistant w/    { type:"message", message:{role:"assistant", content:[{type:"toolCall", id, name, arguments}]} }
//   tool result     { type:"message", message:{role:"toolResult", toolCallId, toolName, content:[{type:"text",text}], isError} }

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { pi } from '../../experiments/experiment-1-trace-capture/adapters/pi.mjs';
import { EventKind, Status } from '../../experiments/experiment-1-trace-capture/core/event.mjs';

function writeSession(dir) {
  const lines = [
    { type: 'session', version: 3, id: 'sess-uuid-1234', timestamp: '2026-06-10T17:41:02.018Z', cwd: '/tmp/pi-proj' },
    { type: 'model_change', id: 'm1', parentId: null, timestamp: '2026-06-10T17:41:02.045Z', provider: 'openrouter', modelId: 'google/gemini-2.5-flash' },
    {
      type: 'message', id: 'u1', parentId: 'm1', timestamp: '2026-06-10T17:41:08.000Z',
      message: { role: 'user', content: [{ type: 'text', text: 'use the bash tool to run exactly: ls -la — then say done' }] },
    },
    {
      type: 'message', id: 'a1', parentId: 'u1', timestamp: '2026-06-10T17:41:09.000Z',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'running the command' },
          { type: 'toolCall', id: 'tool_bash_abc', name: 'bash', arguments: { command: 'ls -la' } },
        ],
      },
    },
    {
      type: 'message', id: 'r1', parentId: 'a1', timestamp: '2026-06-10T17:41:14.398Z',
      message: { role: 'toolResult', toolCallId: 'tool_bash_abc', toolName: 'bash', content: [{ type: 'text', text: 'total 16\n' }], isError: false },
    },
    {
      type: 'message', id: 'a2', parentId: 'r1', timestamp: '2026-06-10T17:41:15.000Z',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
    },
  ];
  const file = join(dir, 'session.jsonl');
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return file;
}

test('pi.detect() does not throw', () => {
  assert.doesNotThrow(() => pi.detect());
  assert.equal(typeof pi.detect(), 'boolean');
});

test('pi.parse() builds SESSION root + TURN + TOOL spans', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-adapter-'));
  try {
    const file = writeSession(dir);
    const t = pi.parse(file);

    assert.equal(t.host, 'pi');
    assert.equal(t.sessionId, 'sess-uuid-1234');

    const sessions = t.events.filter((e) => e.kind === EventKind.SESSION);
    assert.equal(sessions.length, 1, 'exactly one SESSION root');
    const root = sessions[0];
    assert.equal(root.refId, 'sess-uuid-1234');
    assert.equal(root.parentRefId, null);
    assert.ok(root.startMs > 0 && root.endMs >= root.startMs, 'root spans entry timestamps');

    const turns = t.events.filter((e) => e.kind === EventKind.TURN);
    assert.equal(turns.length, 1, 'one TURN for the user prompt');
    assert.equal(turns[0].parentRefId, 'sess-uuid-1234');
    assert.match(turns[0].name, /ls -la/);

    const tools = t.events.filter((e) => e.kind === EventKind.TOOL_CALL);
    assert.equal(tools.length, 1, 'one TOOL span for the bash toolCall');
    const tool = tools[0];
    assert.equal(tool.refId, 'tool_bash_abc');
    assert.match(tool.name, /bash/);
    assert.equal(tool.status, Status.OK, 'isError:false → OK');
    // paired tool result gives the tool a real end time after its start
    assert.ok(tool.endMs > tool.startMs, 'tool end paired from toolResult timestamp');
    // tool parented to the turn (matching codex pairing logic)
    assert.equal(tool.parentRefId, turns[0].refId);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pi.parse() marks isError toolResult as ERROR status', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-adapter-err-'));
  try {
    const lines = [
      { type: 'session', version: 3, id: 'sess-err', timestamp: '2026-06-10T17:41:02.018Z', cwd: '/tmp/x' },
      {
        type: 'message', id: 'u1', parentId: null, timestamp: '2026-06-10T17:41:08.000Z',
        message: { role: 'user', content: [{ type: 'text', text: 'do a thing' }] },
      },
      {
        type: 'message', id: 'a1', parentId: 'u1', timestamp: '2026-06-10T17:41:09.000Z',
        message: { role: 'assistant', content: [{ type: 'toolCall', id: 'tc1', name: 'bash', arguments: {} }] },
      },
      {
        type: 'message', id: 'r1', parentId: 'a1', timestamp: '2026-06-10T17:41:10.000Z',
        message: { role: 'toolResult', toolCallId: 'tc1', toolName: 'bash', content: [{ type: 'text', text: 'boom' }], isError: true },
      },
    ];
    const file = join(dir, 'session.jsonl');
    writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');

    const t = pi.parse(file);
    const tool = t.events.find((e) => e.kind === EventKind.TOOL_CALL);
    assert.ok(tool);
    assert.equal(tool.status, Status.ERROR);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pi.parse() tolerates malformed lines', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-adapter-bad-'));
  try {
    const file = join(dir, 'session.jsonl');
    writeFileSync(
      file,
      [
        JSON.stringify({ type: 'session', version: 3, id: 'sess-bad', timestamp: '2026-06-10T17:41:02.018Z', cwd: '/tmp/x' }),
        '{ this is not json',
        '',
        JSON.stringify({ type: 'message', id: 'u1', parentId: null, timestamp: '2026-06-10T17:41:08.000Z', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } }),
      ].join('\n') + '\n',
    );
    const t = pi.parse(file);
    assert.equal(t.events.filter((e) => e.kind === EventKind.SESSION).length, 1);
    assert.equal(t.events.filter((e) => e.kind === EventKind.TURN).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
