import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { geminiRef } from '../../zuzuu/commands/hook.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { gateDecision } from '../../zuzuu/commands/hook.mjs';

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

function withRules(rules, fn) {
  const root = mkdtempSync(join(tmpdir(), 'mns-gate-'));
  mkdirSync(join(root, '.mns', 'guardrails'), { recursive: true });
  writeFileSync(join(root, '.mns', 'guardrails', 'rules.json'), JSON.stringify({ version: 1, rules }));
  try { return fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}
const SECRET_RULE = { id: 'no-secret-reads', action: 'deny', tool: '*', pattern: '\\.env', reason: 'secrets' };

test('gateDecision: a path-like session_id (pi) still writes the guardrails log (sanitized filename)', () => {
  withRules([SECRET_RULE], (cwd) => {
    const sessPath = '/Users/x/.pi/agent/sessions/--Users-x--/2026_abc.jsonl';
    const d = gateDecision({ host: 'pi', payload: { session_id: sessPath, tool_name: 'bash', tool_input: { command: 'cat .env' } }, cwd });
    assert.equal(d.decision, 'deny');
    const files = readdirSync(join(cwd, '.mns', '.live'));
    const log = files.find((f) => f.startsWith('guardrails-') && f.endsWith('.jsonl'));
    assert.ok(log, `expected a guardrails log, got: ${files.join(',')}`);
    assert.ok(!log.includes('/'), `filename must have no path separators: ${log}`);
    const line = JSON.parse(readFileSync(join(cwd, '.mns', '.live', log), 'utf8').trim());
    assert.equal(line.host, 'pi');
    assert.equal(line.rule, 'no-secret-reads');
  });
});

test('gateDecision: codex deny → hookSpecificOutput (Claude-shaped)', () => {
  withRules([SECRET_RULE], (cwd) => {
    const d = gateDecision({ host: 'codex', payload: { session_id: 's', tool_name: 'Bash', tool_input: { command: 'cat .env' } }, cwd });
    assert.equal(d.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(d.hookSpecificOutput.permissionDecisionReason, /no-secret-reads/);
  });
});

test('gateDecision: gemini deny → {decision:deny,reason}', () => {
  withRules([SECRET_RULE], (cwd) => {
    const d = gateDecision({ host: 'gemini-cli', payload: { session_id: 's', tool_name: 'read_file', tool_input: { file_path: '.env' } }, cwd });
    assert.equal(d.decision, 'deny');
    assert.match(d.reason, /no-secret-reads/);
  });
});

test('gateDecision: no match → null (fail-open) for both hosts', () => {
  withRules([SECRET_RULE], (cwd) => {
    assert.equal(gateDecision({ host: 'codex', payload: { tool_name: 'Bash', tool_input: { command: 'ls' } }, cwd }), null);
    assert.equal(gateDecision({ host: 'gemini-cli', payload: { tool_name: 'read_file', tool_input: { file_path: 'README.md' } }, cwd }), null);
  });
});

test('gateDecision: opencode deny → {decision:deny,reason} (plugin-parseable)', () => {
  withRules([SECRET_RULE], (cwd) => {
    const d = gateDecision({ host: 'opencode', payload: { session_id: 's', tool_name: 'bash', tool_input: { command: 'cat .env' } }, cwd });
    assert.equal(d.decision, 'deny');
    assert.match(d.reason, /no-secret-reads/);
  });
});

test('gateDecision: pi deny → {decision:deny,reason}', () => {
  withRules([SECRET_RULE], (cwd) => {
    const d = gateDecision({ host: 'pi', payload: { session_id: 's', tool_name: 'bash', tool_input: { command: 'cat .env' } }, cwd });
    assert.equal(d.decision, 'deny');
    assert.match(d.reason, /no-secret-reads/);
  });
});
