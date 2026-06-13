// tests/unit/miner-instructions.test.mjs
// TDD: Instructions miner — recurring corrective turns → steering-amendment proposals.
// Memory miner stub — registered, no-op.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { miner, aggregate, propose } from '../../zuzuu/modules/instructions/index.mjs';
import * as registry from '../../zuzuu/module/registry.mjs';
import { serializeEnvelope } from '../../zuzuu/module/envelope.mjs';

// Import memory miner so it self-registers (needed for Test 4 + Test 5).

// Import all 5 miners to verify full registry (Test 5 requires them all).

// ---------------------------------------------------------------------------
// Helpers

/** Build a minimal session object as mineTranscript would return. */
function makeSession(id, correctionTurns = []) {
  return {
    sessionId: id,
    commands: [],
    files: [],
    failures: [],
    sequences: [],
    correctionTurns,
    destructiveFailures: [],
  };
}

// ---------------------------------------------------------------------------
// Test 1: same corrective turn in 2 sessions → one candidate, evidence.sessions >= 2.

test('aggregate: same corrective turn in 2 sessions → one candidate with evidence.sessions >= 2', () => {
  const text = 'always run tests before committing';
  const sessions = [
    makeSession('sess-A', [{ text }]),
    makeSession('sess-B', [{ text }]),
  ];
  const cands = aggregate(sessions);
  assert.equal(cands.length, 1, 'exactly one candidate');
  const c = cands[0];

  // payload.text should be a steering amendment phrased as an instruction
  assert.ok(typeof c.payload.text === 'string' && c.payload.text.length > 0, 'payload.text is non-empty string');

  // evidence tracks occurrences and sessions
  assert.ok(c.evidence.occurrences >= 2, `occurrences ${c.evidence.occurrences} >= 2`);
  assert.ok(c.evidence.sessions >= 2, `sessions ${c.evidence.sessions} >= 2`);
});

// ---------------------------------------------------------------------------
// Test 2: correction in only ONE session → no candidate (cross-session gate).

test('aggregate: correction in only one session → no candidate (cross-session gate)', () => {
  const text = 'always run tests before committing';
  const sessions = [
    makeSession('sess-solo', [{ text }, { text }, { text }]),
  ];
  const cands = aggregate(sessions);
  assert.equal(cands.length, 0, 'single-session gate: must produce NO candidate');
});

// ---------------------------------------------------------------------------
// Test 3: propose writes an instructions proposal (kind:'block') to
// .home/instructions/proposals/; idempotent re-run → 0.

test('propose: writes instructions proposal JSON (kind:block) to home/instructions/proposals/', () => {
  const agentDir = mkdtempSync(join(tmpdir(), 'zuzuu-instr-miner-'));
  const text = 'always run tests before committing';
  const sessions = [
    makeSession('sA', [{ text }]),
    makeSession('sB', [{ text }]),
  ];
  const cands = aggregate(sessions);
  assert.equal(cands.length, 1);

  const n = propose(agentDir, cands);
  assert.equal(n, 1, 'propose returns 1');

  // Check the proposal file exists in instructions/proposals/
  const propDir = join(agentDir, 'instructions', 'proposals');
  assert.ok(existsSync(propDir), 'proposals dir created');

  const files = readdirSync(propDir).filter((f) => f.endsWith('.json'));
  assert.equal(files.length, 1, 'exactly one proposal file');

  const proposal = JSON.parse(readFileSync(join(propDir, files[0]), 'utf8'));
  assert.equal(proposal.module, 'instructions', 'module is instructions');
  assert.equal(proposal.kind, 'block', 'kind is block');
  assert.equal(proposal.source, 'distill', 'source is distill');
  assert.ok(typeof proposal.payload.text === 'string' && proposal.payload.text.length > 0, 'payload.text present');
});

test('propose: idempotent — second call returns 0', () => {
  const agentDir = mkdtempSync(join(tmpdir(), 'zuzuu-instr-idempotent-'));
  const text = 'always run tests before committing';
  const sessions = [
    makeSession('sA', [{ text }]),
    makeSession('sB', [{ text }]),
  ];
  const cands = aggregate(sessions);
  propose(agentDir, cands);           // first run
  const n2 = propose(agentDir, cands);
  assert.equal(n2, 0, 'second propose returns 0');
});

test('propose: idempotent — skips if text already present in an instructions item', () => {
  const agentDir = mkdtempSync(join(tmpdir(), 'zuzuu-instr-projmd-'));
  const text = 'always run tests before committing';
  const sessions = [
    makeSession('sA', [{ text }]),
    makeSession('sB', [{ text }]),
  ];
  const cands = aggregate(sessions);

  // Pre-populate the steering item with the text already in it.
  const itemsDir = join(agentDir, 'instructions', 'items');
  mkdirSync(itemsDir, { recursive: true });
  writeFileSync(join(itemsDir, 'steering.md'), serializeEnvelope({
    id: 'steering', module: 'instructions', kind: 'steering', title: 'Project steering',
    status: 'active', created_at: '2026-06-12T00:00:00Z', payload: {}, body: text,
  }));

  const n = propose(agentDir, cands);
  assert.equal(n, 0, 'skips when text is already applied');
});

// ---------------------------------------------------------------------------
// Test 4: memory miner stub is registered, aggregate → [], propose → 0.

test('memory miner: stub registered, aggregate returns [], propose returns 0', () => {
  const m = registry.minerOf('memory');
  assert.ok(m, 'memory miner is registered');
  assert.equal(m.stub, true, 'memory miner has stub:true');
  assert.deepEqual(m.aggregate(), [], 'aggregate returns empty array');
  assert.equal(m.propose(), 0, 'propose returns 0');
});

// ---------------------------------------------------------------------------
// Test 5: registry.all() includes all 5 modules after importing all miners.

test('registry.all() includes all 5 modules: knowledge, actions, guardrails, instructions, memory', () => {
  const modules = registry.miners().map((m) => m.module);
  assert.ok(modules.includes('knowledge'), 'knowledge in registry');
  assert.ok(modules.includes('actions'), 'actions in registry');
  assert.ok(modules.includes('guardrails'), 'guardrails in registry');
  assert.ok(modules.includes('instructions'), 'instructions in registry');
  assert.ok(modules.includes('memory'), 'memory in registry');
  assert.equal(modules.length, 5, 'exactly 5 modules registered');
});

// ---------------------------------------------------------------------------
// Test 6: instructions miner self-registers on import.

test('instructions miner self-registers on import', () => {
  assert.ok(registry.minerOf('instructions'), 'instructions miner in registry');
  assert.equal(registry.minerOf('instructions'), miner);
  assert.equal(miner.module, 'instructions');
  assert.equal(typeof miner.aggregate, 'function');
  assert.equal(typeof miner.propose, 'function');
});
