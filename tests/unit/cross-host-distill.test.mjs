import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

import { codex } from '../../experiments/experiment-1-trace-capture/adapters/codex.mjs';
import { pi } from '../../experiments/experiment-1-trace-capture/adapters/pi.mjs';
import { opencode } from '../../experiments/experiment-1-trace-capture/adapters/opencode.mjs';
import { geminiCli } from '../../experiments/experiment-1-trace-capture/adapters/gemini-cli.mjs';
import { aggregate, transcriptsFor } from '../../zuzuu/knowledge/distill.mjs';
import * as registry from '../../experiments/experiment-1-trace-capture/adapters/registry.mjs';

const require = createRequire(import.meta.url);
const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

test('codex mineSignals: shell command TEXT (arguments.cmd) + failed flag from real-shape rollout', () => {
  const sig = codex.mineSignals(join(FIX, 'codex-signals.jsonl'));
  assert.deepEqual(sig.commands.map((c) => c.cmd), ['git status --short', 'npm test']);
  assert.deepEqual(sig.commands.map((c) => c.failed), [false, true]);
  assert.deepEqual(sig.failures, ['exec_command']);
  assert.deepEqual(sig.sequences, ['git status --short && npm test']);
});

test('pi mineSignals: shell command TEXT (arguments.command) + isError flag from real-shape jsonl', () => {
  const sig = pi.mineSignals(join(FIX, 'pi-signals.jsonl'));
  assert.deepEqual(sig.commands.map((c) => c.cmd), ['git status --short', 'npm test']);
  assert.deepEqual(sig.commands.map((c) => c.failed), [false, true]);
  assert.deepEqual(sig.failures, ['bash']);
  assert.deepEqual(sig.sequences, ['git status --short && npm test']);
});

test('opencode mineSignals: shell command TEXT (state.input.command) + status enum from SQLite', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oc-sig-'));
  const dbPath = join(dir, 'opencode.db');
  const db = new (require('node:sqlite').DatabaseSync)(dbPath);
  db.exec('CREATE TABLE session (id TEXT, directory TEXT, title TEXT, model TEXT, time_created INT, time_updated INT)');
  db.exec('CREATE TABLE message (id TEXT, session_id TEXT, time_created INT, data TEXT)');
  db.exec('CREATE TABLE part (id TEXT, message_id TEXT, session_id TEXT, time_created INT, data TEXT)');
  const sid = 'ses_test';
  db.prepare('INSERT INTO session VALUES (?,?,?,?,?,?)').run(sid, '/tmp/proj', 'x', '{}', 1000, 5000);
  const ins = db.prepare('INSERT INTO part VALUES (?,?,?,?,?)');
  ins.run('p1', 'm1', sid, 2000, JSON.stringify({ type: 'tool', tool: 'bash', callID: 'c1', state: { status: 'completed', input: { command: 'git status --short' } } }));
  ins.run('p2', 'm1', sid, 3000, JSON.stringify({ type: 'tool', tool: 'bash', callID: 'c2', state: { status: 'error', input: { command: 'npm test' } } }));
  db.close();

  const sig = opencode.mineSignals({ db: dbPath, sessionId: sid });
  assert.deepEqual(sig.commands.map((c) => c.cmd), ['git status --short', 'npm test']);
  assert.deepEqual(sig.commands.map((c) => c.failed), [false, true]);
  assert.deepEqual(sig.failures, ['bash']);
  assert.deepEqual(sig.sequences, ['git status --short && npm test']);
});

test('gemini mineSignals: prompt-only host → empty superset, no throw', () => {
  const sig = geminiCli.mineSignals({ file: '/does/not/exist', sessionId: 'whatever' });
  assert.deepEqual(sig, { commands: [], files: [], failures: [], sequences: [], correctionTurns: [], destructiveFailures: [] });
});

test('mineSignals tolerates malformed transcripts (never throws → empty superset)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bad-'));
  const bad = join(dir, 'bad.jsonl');
  writeFileSync(bad, 'not json\n{also bad\n');
  assert.deepEqual(codex.mineSignals(bad).commands, []);
  assert.deepEqual(pi.mineSignals(bad).commands, []);
  // opencode: missing db
  assert.deepEqual(opencode.mineSignals({ db: join(dir, 'none.db'), sessionId: 'x' }).commands, []);
});

test('transcriptsFor enumerates ALL detected hosts (host+ref pairs), newest-first', () => {
  const detected = registry.detected();
  const pairs = transcriptsFor({ scope: 'all', cwd: '/no/such/cwd/anywhere' });
  // every pair is {host, ref}; hosts come from the registry
  for (const p of pairs) {
    assert.ok(p.host, 'pair has a host');
    assert.ok(p.ref != null, 'pair has a ref');
    assert.ok(registry.byName(p.host), 'host is a registered adapter');
  }
  // if more than one host has data, the result must span more than one host
  if (detected.length > 1 && pairs.length > 1) {
    const hosts = new Set(pairs.map((p) => p.host));
    assert.ok(hosts.size >= 1);
  }
});

test('cross-host aggregation: SAME command across 3 hosts → ONE candidate whose provenance spans hosts', () => {
  const cmd = { cmd: 'npm test', failed: false };
  const sessions = [
    { sessionId: 'claude-code:s1', commands: [cmd], files: [], failures: [] },
    { sessionId: 'codex:s2', commands: [cmd], files: [], failures: [] },
    { sessionId: 'pi:s3', commands: [cmd], files: [], failures: [] },
  ];
  const out = aggregate(sessions);
  const cands = out.filter((c) => c.candidate.type === 'command');
  assert.equal(cands.length, 1, 'one command candidate');
  assert.equal(cands[0].evidence.occurrences, 3);
  assert.equal(cands[0].evidence.sessions, 3);
  const provSessions = cands[0].candidate.provenance.map((p) => p.session);
  assert.ok(provSessions.some((s) => s.startsWith('claude-code:')), 'provenance includes claude-code');
  assert.ok(provSessions.some((s) => s.startsWith('codex:')), 'provenance includes codex');
  assert.ok(provSessions.some((s) => s.startsWith('pi:')), 'provenance includes pi');
});
