import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Drives the REAL gate: `home hook PreToolUse` with a payload on stdin, in a
// temp project scaffolded by the real `home init` (so the seed rules are the
// ones users actually get). Asserts the wire contract Claude Code consumes.
const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'zuzuu.mjs');

function gate(cwd, payload) {
  const r = spawnSync(process.execPath, [BIN, 'hook', 'PreToolUse'], { cwd, input: JSON.stringify(payload), encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout.trim() };
}

function withProject(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'zuzuu-gate-'));
  try {
    spawnSync(process.execPath, [BIN, 'init'], { cwd: dir, encoding: 'utf8' });
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('seed rule denies a root wipe with the verified schema; exit 0', () => {
  withProject((cwd) => {
    const { status, stdout } = gate(cwd, { session_id: 's1', tool_name: 'Bash', tool_input: { command: 'rm -rf / ' } });
    assert.equal(status, 0, 'gate must exit 0 even when denying');
    const d = JSON.parse(stdout);
    assert.equal(d.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.equal(d.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(d.hookSpecificOutput.permissionDecisionReason, /no-root-wipe/);
  });
});

test('seed rule asks on force-push; benign call stays silent (normal flow)', () => {
  withProject((cwd) => {
    const ask = gate(cwd, { session_id: 's1', tool_name: 'Bash', tool_input: { command: 'git push --force origin main' } });
    assert.equal(JSON.parse(ask.stdout).hookSpecificOutput.permissionDecision, 'ask');
    const ok = gate(cwd, { session_id: 's1', tool_name: 'Bash', tool_input: { command: 'ls -la' } });
    assert.equal(ok.stdout, '', 'no match → no output → host default flow');
    assert.equal(ok.status, 0);
  });
});

test('fail-open: garbage stdin, and projects with no rule items, never block', () => {
  withProject((cwd) => {
    rmSync(join(cwd, '.zuzuu', 'guardrails', 'items'), { recursive: true, force: true });
    const noRules = gate(cwd, { session_id: 's1', tool_name: 'Bash', tool_input: { command: 'rm -rf / ' } });
    assert.equal(noRules.stdout, '');
    assert.equal(noRules.status, 0);
  });
  const dir = mkdtempSync(join(tmpdir(), 'zuzuu-gate-raw-'));
  try {
    const r = spawnSync(process.execPath, [BIN, 'hook', 'PreToolUse'], { cwd: dir, input: 'not json at all', encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a malformed rule item is skipped silently — seeds still enforce', () => {
  withProject((cwd) => {
    const items = join(cwd, '.zuzuu', 'guardrails', 'items');
    mkdirSync(items, { recursive: true });
    // a broken envelope next to the seeds must not disarm the gate
    writeFileSync(join(items, 'broken.md'), '{ not an envelope at all');
    const denied = gate(cwd, { session_id: 's1', tool_name: 'Bash', tool_input: { command: 'rm -rf / ' } });
    assert.equal(denied.status, 0);
    assert.equal(JSON.parse(denied.stdout).hookSpecificOutput.permissionDecision, 'deny', 'seed rules survive a malformed sibling');
    const ok = gate(cwd, { session_id: 's1', tool_name: 'Bash', tool_input: { command: 'ls' } });
    assert.equal(ok.stdout, '', 'no spurious decision from the malformed item');
  });
});

test('matched decisions are logged for the trace', () => {
  withProject((cwd) => {
    gate(cwd, { session_id: 'sess-log', tool_name: 'Bash', tool_input: { command: 'rm -rf / ' } });
    const log = spawnSync('cat', [join(cwd, '.zuzuu', '.live', 'guardrails-sess-log.jsonl')], { encoding: 'utf8' }).stdout;
    const entry = JSON.parse(log.trim().split('\n')[0]);
    assert.equal(entry.action, 'deny');
    assert.equal(entry.rule, 'no-root-wipe');
    assert.equal(entry.tool, 'Bash');
  });
});
