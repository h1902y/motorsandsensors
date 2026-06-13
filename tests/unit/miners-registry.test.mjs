import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { mineTranscript, aggregate } from '../../zuzuu/knowledge/distill.mjs';
import * as registry from '../../zuzuu/module/registry.mjs';
import { propose as knowledgePropose, miner as knowledgeMiner } from '../../zuzuu/modules/knowledge/index.mjs';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'claude-sample.jsonl');

test('mineTranscript: superset keeps original commands/files/failures byte-identical', () => {
  const m = mineTranscript(FIXTURE);
  // original golden expectations (must not drift)
  assert.equal(m.sessionId, 'sess-test');
  assert.deepEqual(m.commands.map((c) => c.cmd), ['npm run build', 'npm test']);
  assert.deepEqual(m.commands.map((c) => c.failed), [false, true]);
  assert.deepEqual(m.failures, ['Bash']);
  assert.deepEqual(m.files, []);
  // new superset keys exist and are arrays
  assert.ok(Array.isArray(m.sequences), 'sequences is an array');
  assert.ok(Array.isArray(m.correctionTurns), 'correctionTurns is an array');
  assert.ok(Array.isArray(m.destructiveFailures), 'destructiveFailures is an array');
});

test('mineTranscript: 2-gram sequences over adjacent Bash commands', () => {
  const m = mineTranscript(FIXTURE);
  // two Bash commands: npm run build, npm test → one adjacent pair
  assert.equal(m.sequences.length, 1);
  assert.ok(m.sequences[0].includes('npm run build'));
  assert.ok(m.sequences[0].includes('npm test'));
});

function writeTranscript(lines) {
  const dir = mkdtempSync(join(tmpdir(), 'zuzuu-mine-'));
  const f = join(dir, 'session.jsonl');
  writeFileSync(f, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return f;
}

test('mineTranscript: sequences + correctionTurns + destructiveFailures on a synthetic transcript', () => {
  const f = writeTranscript([
    { type: 'user', sessionId: 's', message: { role: 'user', content: 'start' } },
    { type: 'assistant', sessionId: 's', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', id: 't1', input: { command: 'git status' } }] } },
    { type: 'user', sessionId: 's', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', is_error: false }] } },
    { type: 'assistant', sessionId: 's', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', id: 't2', input: { command: 'rm -rf node_modules' } }] } },
    { type: 'user', sessionId: 's', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', is_error: true }] } },
    { type: 'user', sessionId: 's', message: { role: 'user', content: "No, don't delete that — always use git status first" } },
  ]);
  const m = mineTranscript(f);
  // two adjacent Bash commands → one 2-gram
  assert.equal(m.sequences.length, 1);
  assert.ok(m.sequences[0].includes('git status') && m.sequences[0].includes('rm -rf node_modules'));
  // corrective user turn after a tool action
  assert.equal(m.correctionTurns.length, 1);
  assert.match(m.correctionTurns[0].text, /No, don't delete/);
  // failed rm -rf is destructive
  assert.equal(m.destructiveFailures.length, 1);
  assert.equal(m.destructiveFailures[0].cmd, 'rm -rf node_modules');
  assert.equal(m.destructiveFailures[0].tool, 'Bash');
});

test('mineTranscript: never throws on garbage shapes', () => {
  const f = writeTranscript([
    { type: 'assistant', message: { content: 'not an array' } },
    { foo: 'bar' },
  ]);
  assert.doesNotThrow(() => mineTranscript(f));
});

test('knowledge miner is a registry built-in (the Module Module contract)', () => {
  // built-in modules are statically wired into the registry — no side-effect
  // import needed; the miner surfaced is the module's own miner object.
  assert.ok(registry.minerOf('knowledge'), 'knowledge miner present');
  assert.equal(registry.minerOf('knowledge'), knowledgeMiner);
});

test('registry: all five built-in miners, legacy distill order, unknown → undefined', () => {
  const modules = registry.miners().map((m) => m.module);
  assert.deepEqual(modules, ['knowledge', 'actions', 'guardrails', 'instructions', 'memory']);
  assert.equal(registry.minerOf('missing'), undefined);
  // every miner speaks the contract shape
  for (const m of registry.miners()) {
    assert.equal(typeof m.aggregate, 'function', `${m.module}.aggregate`);
    assert.equal(typeof m.propose, 'function', `${m.module}.propose`);
  }
});

test('knowledge miner registered: aggregate matches direct aggregate (no drift)', () => {
  const km = registry.minerOf('knowledge');
  assert.ok(km, 'knowledge miner registered');
  const c = { cmd: 'npm test', failed: false };
  const sessions = [
    { sessionId: 's1', commands: [c, c], files: [], failures: [] },
    { sessionId: 's2', commands: [c], files: [], failures: [] },
  ];
  assert.equal(
    JSON.stringify(km.aggregate(sessions, {})),
    JSON.stringify(aggregate(sessions, {})),
  );
});

test('knowledge miner propose: files proposals + returns count', () => {
  const agentDir = mkdtempSync(join(tmpdir(), 'zuzuu-home-'));
  const c = { cmd: 'npm test', failed: false };
  const sessions = [
    { sessionId: 's1', commands: [c, c], files: [], failures: [] },
    { sessionId: 's2', commands: [c], files: [], failures: [] },
  ];
  const cands = aggregate(sessions, {});
  assert.ok(cands.length >= 1);
  const n = knowledgePropose(agentDir, cands);
  assert.equal(n, cands.length);
});
