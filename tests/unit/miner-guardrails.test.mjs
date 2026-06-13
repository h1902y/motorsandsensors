// tests/unit/miner-guardrails.test.mjs
// TDD: Guardrails miner — repeated destructive failures → ask-only rules,
// cross-session-gated. Safety tests are NON-NEGOTIABLE.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { miner, aggregate, propose, escapeRegex } from '../../zuzuu/modules/guardrails/index.mjs';
import * as registry from '../../zuzuu/module/registry.mjs';
import { serializeEnvelope } from '../../zuzuu/module/envelope.mjs';

// ---------------------------------------------------------------------------
// Helpers

/** Build a minimal session object as mineTranscript would return. */
function makeSession(id, destructiveFailures = []) {
  return {
    sessionId: id,
    commands: [],
    files: [],
    failures: [],
    sequences: [],
    correctionTurns: [],
    destructiveFailures,
  };
}

/** Build a { cmd, tool } destructive failure entry. */
const df = (cmd, tool = 'Bash') => ({ cmd, tool });

// ---------------------------------------------------------------------------
// Test 1: destructive cmd failing ≥3× across 2 sessions → exactly ONE proposal,
// action:'ask', pattern is literal-escaped, reason mentions repeated failure.

test('aggregate: rm -rf failing ≥3× across 2 sessions → one proposal, action ask, escaped pattern', () => {
  const cmd = 'rm -rf /important';
  const sessions = [
    // session A: 2 failures
    makeSession('sess-A', [df(cmd), df(cmd)]),
    // session B: 1 failure → total=3, distinct sessions=2 → qualifies
    makeSession('sess-B', [df(cmd)]),
  ];
  const cands = aggregate(sessions);
  assert.equal(cands.length, 1, 'exactly one candidate');
  const c = cands[0];

  // SAFETY: action must always be 'ask', never 'deny'
  assert.equal(c.payload.action, 'ask', 'action must be ask');
  assert.notEqual(c.payload.action, 'deny', 'action must never be deny');

  // Pattern must be the literal-escaped command
  const pattern = c.payload.pattern;
  assert.ok(typeof pattern === 'string' && pattern.length > 0, 'pattern is non-empty string');

  // The escaped pattern must match the original command via RegExp
  assert.ok(new RegExp(pattern).test(cmd), `pattern '${pattern}' must match original command '${cmd}'`);

  // rm -rf /important contains metacharacters: - and /
  // Escaped version must contain \\- or \- (depending on representation)
  // We verify that escaping happened by ensuring the raw chars are escaped
  assert.ok(
    pattern.includes('\\-') || pattern.includes('\\\/') || !pattern.includes('.*'),
    'pattern must be literal-escaped (not a broad wildcard)'
  );

  // Verify specific metachar escaping for '-' and '/' in rm -rf /important
  assert.ok(pattern.includes('\\-'), "pattern escapes '-' to '\\-'");

  // reason mentions repeated failure
  assert.ok(
    typeof c.payload.reason === 'string' && c.payload.reason.includes('failed'),
    'reason mentions failed'
  );

  // id follows the guard- prefix
  assert.ok(c.payload.id.startsWith('guard-'), 'id has guard- prefix');

  // evidence
  assert.ok(c.evidence.occurrences >= 3, `occurrences ${c.evidence.occurrences} >= 3`);
  assert.ok(c.evidence.sessions >= 2, `sessions ${c.evidence.sessions} >= 2`);
});

// ---------------------------------------------------------------------------
// SAFETY TEST 2: SAME CMD failing 5× in ONE session → NO proposal
// (cross-session gate — single session must produce nothing regardless of count)

test('SAFETY: same cmd failing 5× in ONE session → NO proposal (cross-session gate)', () => {
  const cmd = 'rm -rf /important';
  const sessions = [
    // Only ONE session, but 5 failures — must not pass the cross-session gate
    makeSession('sess-single', [df(cmd), df(cmd), df(cmd), df(cmd), df(cmd)]),
  ];
  const cands = aggregate(sessions);
  assert.equal(cands.length, 0, 'single-session gate: must produce NO proposal even with 5 failures');
});

// ---------------------------------------------------------------------------
// SAFETY TEST 3: no proposal ever has action:'deny'

test('SAFETY: no aggregate output ever has action deny', () => {
  const cmd = 'git push --force origin main';
  const sessions = [
    makeSession('s1', [df(cmd), df(cmd)]),
    makeSession('s2', [df(cmd)]),
  ];
  const cands = aggregate(sessions);
  for (const c of cands) {
    assert.notEqual(c.payload.action, 'deny', `proposal for '${c.payload.id}' must not have action deny`);
  }
  // Also check with deny-worthy sounding command
  const cmd2 = 'DROP TABLE users';
  const sessions2 = [
    makeSession('s3', [df(cmd2), df(cmd2)]),
    makeSession('s4', [df(cmd2), df(cmd2)]),
  ];
  const cands2 = aggregate(sessions2);
  for (const c of cands2) {
    assert.notEqual(c.payload.action, 'deny', `no proposal should ever have action deny`);
    assert.equal(c.payload.action, 'ask', `action must be ask`);
  }
});

// ---------------------------------------------------------------------------
// Test 4: escapeRegex turns metacharacters into literal matches

test('escapeRegex: metacharacters are escaped for literal matching', () => {
  const cmd = 'rm -rf /tmp/test.dir';
  const pattern = escapeRegex(cmd);

  // Must match the exact command
  assert.ok(new RegExp(pattern).test(cmd), 'pattern matches the original command');

  // Must not match a broad wildcard version
  assert.ok(!pattern.includes('.*'), 'no .* in escaped pattern');

  // Specific chars that appear in rm -rf /tmp/test.dir must be escaped
  // '-' → \-
  assert.ok(pattern.includes('\\-'), 'hyphen is escaped');
  // '/' → \/
  assert.ok(pattern.includes('\\/'), 'slash is escaped');
  // '.' → \.
  assert.ok(pattern.includes('\\.'), 'dot is escaped');

  // Broader safety: a command with many metachars
  const tricky = 'chmod -R 755 /path/to/dir (confirm?)';
  const trickyPattern = escapeRegex(tricky);
  assert.ok(new RegExp(trickyPattern).test(tricky), 'tricky pattern matches original');
  // '(' and ')' and '?' should be escaped
  assert.ok(trickyPattern.includes('\\('), 'open paren is escaped');
  assert.ok(trickyPattern.includes('\\)'), 'close paren is escaped');
  assert.ok(trickyPattern.includes('\\?'), 'question mark is escaped');
});

// ---------------------------------------------------------------------------
// Test 5: multiple distinct cmds — each qualifies independently

test('aggregate: two distinct destructive cmds each qualifying → two proposals', () => {
  const cmd1 = 'rm -rf /tmp/build';
  const cmd2 = 'git push --force origin main';
  const sessions = [
    makeSession('s1', [df(cmd1), df(cmd1), df(cmd2)]),
    makeSession('s2', [df(cmd1), df(cmd2), df(cmd2)]),
  ];
  const cands = aggregate(sessions);
  assert.equal(cands.length, 2, 'two distinct qualifying commands → two candidates');
  const actions = cands.map((c) => c.payload.action);
  assert.ok(actions.every((a) => a === 'ask'), 'all proposals must have action ask');
});

// ---------------------------------------------------------------------------
// Test 6: below threshold — cmd across 2 sessions but only 2 total → no proposal

test('aggregate: 2 occurrences across 2 sessions (below minFailures=3) → no proposal', () => {
  const cmd = 'rm -rf /tmp/test';
  const sessions = [
    makeSession('sA', [df(cmd)]),
    makeSession('sB', [df(cmd)]),
  ];
  const cands = aggregate(sessions);
  assert.equal(cands.length, 0, 'below minFailures threshold → no proposal');
});

// ---------------------------------------------------------------------------
// Test 7: propose writes a guardrails proposal JSON and is idempotent

test('propose: writes guardrails proposal JSON to home/guardrails/proposals/', () => {
  const agentDir = mkdtempSync(join(tmpdir(), 'zuzuu-guard-miner-'));
  const cmd = 'rm -rf /data';
  const sessions = [
    makeSession('sA', [df(cmd), df(cmd)]),
    makeSession('sB', [df(cmd)]),
  ];
  const cands = aggregate(sessions);
  assert.equal(cands.length, 1);

  const n = propose(agentDir, cands);
  assert.equal(n, 1, 'propose returns 1');

  // Check proposal file exists
  const propDir = join(agentDir, 'guardrails', 'proposals');
  assert.ok(existsSync(propDir), 'proposals dir created');

  const files = readdirSync(propDir).filter((f) => f.endsWith('.json'));
  assert.equal(files.length, 1, 'exactly one proposal file');

  const proposal = JSON.parse(readFileSync(join(propDir, files[0]), 'utf8'));
  assert.equal(proposal.module, 'guardrails');
  assert.equal(proposal.kind, 'rule');
  assert.equal(proposal.payload.action, 'ask');
  assert.equal(proposal.payload.tool, 'Bash');
  assert.ok(typeof proposal.payload.pattern === 'string');
  assert.ok(new RegExp(proposal.payload.pattern).test(cmd), 'proposal pattern matches cmd');
});

// ---------------------------------------------------------------------------
// Test 8: propose is idempotent — re-run returns 0

test('propose: idempotent — second call returns 0', () => {
  const agentDir = mkdtempSync(join(tmpdir(), 'zuzuu-guard-idempotent-'));
  const cmd = 'rm -rf /data';
  const sessions = [
    makeSession('sA', [df(cmd), df(cmd)]),
    makeSession('sB', [df(cmd)]),
  ];
  const cands = aggregate(sessions);
  propose(agentDir, cands);           // first run
  const n2 = propose(agentDir, cands);
  assert.equal(n2, 0, 'second propose returns 0');
});

// ---------------------------------------------------------------------------
// Test 9: propose skips id already live as a rule item

test('propose: skips if the rule id already exists as a live rule item', () => {
  const agentDir = mkdtempSync(join(tmpdir(), 'zuzuu-guard-rules-skip-'));
  const cmd = 'rm -rf /data';
  const sessions = [
    makeSession('sA', [df(cmd), df(cmd)]),
    makeSession('sB', [df(cmd)]),
  ];
  const cands = aggregate(sessions);
  assert.equal(cands.length, 1);

  // Pre-populate guardrails/items/ with the same rule id
  const itemsDir = join(agentDir, 'guardrails', 'items');
  mkdirSync(itemsDir, { recursive: true });
  writeFileSync(join(itemsDir, `${cands[0].payload.id}.md`), serializeEnvelope({
    id: cands[0].payload.id, module: 'guardrails', kind: 'rule', title: 'pre-existing',
    status: 'active', created_at: '2026-06-12T00:00:00Z',
    payload: { action: 'ask', tool: 'Bash', pattern: 'something', reason: 'pre-existing' }, body: '',
  }));

  const n = propose(agentDir, cands);
  assert.equal(n, 0, 'skipped because rule id already live as an item');
});

// ---------------------------------------------------------------------------
// Test 10: guardrails miner self-registers on import

test('guardrails miner self-registers on import', () => {
  assert.ok(registry.minerOf('guardrails'), 'guardrails miner in registry');
  assert.equal(registry.minerOf('guardrails'), miner);
  assert.equal(miner.module, 'guardrails');
  assert.equal(typeof miner.aggregate, 'function');
  assert.equal(typeof miner.propose, 'function');
});
