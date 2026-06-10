import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { geminiRef } from '../../mns/commands/hook.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fx = (h) => readFileSync(join(here, '..', 'fixtures', 'hooks', `${h}.probe.jsonl`), 'utf8')
  .trim().split('\n').map((l) => JSON.parse(l)).map((r) => JSON.parse(r.stdin));

test('geminiRef derives logs.json + sessionId from a real BeforeTool payload', () => {
  const beforeTool = fx('gemini-cli').find((p) => p.hook_event_name === 'BeforeTool');
  const ref = geminiRef(beforeTool);
  assert.equal(ref.sessionId, beforeTool.session_id);
  assert.ok(ref.file.endsWith('/logs.json'), ref.file);
  assert.ok(ref.file.includes('/.gemini/tmp/'), ref.file);
  assert.ok(!ref.file.includes('/chats/'), 'derived logs.json, not the chats transcript');
});

test('real codex PreToolUse payload carries tool_name + tool_input for the gate', () => {
  const pre = fx('codex').find((p) => p.hook_event_name === 'PreToolUse');
  assert.equal(pre.tool_name, 'Bash');
  assert.equal(pre.tool_input.command, 'ls -la');
  assert.ok(pre.transcript_path.endsWith('.jsonl'), 'codex ref is the rollout jsonl');
});
