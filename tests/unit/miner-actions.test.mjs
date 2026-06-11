// tests/unit/miner-actions.test.mjs
// TDD: Actions miner — recurring Bash 2-gram sequences → runbook proposals.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { miner, aggregate, propose } from '../../zuzuu/miners/actions.mjs';
import * as registry from '../../zuzuu/miners/registry.mjs';

// ---------------------------------------------------------------------------
// Helpers — build the mineTranscript output shape directly (deterministic).
// SEQ_SEP is ' && ' (same constant as distill.mjs uses to join adjacent cmds).
const SEQ_SEP = ' && ';
const seq = (a, b) => a + SEQ_SEP + b;

/** Build a minimal session object as mineTranscript would return. */
function makeSession(id, sequences) {
  return {
    sessionId: id,
    commands: [],
    files: [],
    failures: [],
    sequences,
    correctionTurns: [],
    destructiveFailures: [],
  };
}

// ---------------------------------------------------------------------------
// Test 1: a recurring 2-gram (≥3 total, ≥2 sessions) → exactly one candidate.

test('aggregate: recurring npm ci → npm test across 2 sessions → one candidate', () => {
  const pair = seq('npm ci', 'npm test');
  const sessions = [
    // session A: contains the pair twice (total=2 here)
    makeSession('sess-A', [pair, pair]),
    // session B: contains the pair once (total=3 across 2 sessions → qualifies)
    makeSession('sess-B', [pair]),
  ];
  const cands = aggregate(sessions);
  assert.equal(cands.length, 1, 'exactly one candidate');
  const c = cands[0];
  assert.deepEqual(c.payload.steps, ['npm ci', 'npm test']);
  assert.ok(c.evidence.occurrences >= 3, `occurrences ${c.evidence.occurrences} >= 3`);
  assert.ok(c.evidence.sessions >= 2, `sessions ${c.evidence.sessions} >= 2`);
  assert.ok(typeof c.payload.slug === 'string' && c.payload.slug.length > 0, 'slug present');
  assert.ok(typeof c.payload.title === 'string' && c.payload.title.length > 0, 'title present');
  assert.ok(typeof c.payload.promptSnippet === 'string', 'promptSnippet present');
  assert.deepEqual(c.payload.sequence, pair, 'sequence raw key round-trips');
});

// ---------------------------------------------------------------------------
// Test 2: one-off sequence (1 session, 2 occurrences) → NO candidate.

test('aggregate: one-off sequence (1 session only) → no candidate', () => {
  const pair = seq('git add .', 'git commit -m fix');
  const sessions = [
    // only one session regardless of how many times it appears
    makeSession('sess-solo', [pair, pair, pair]),
  ];
  const cands = aggregate(sessions);
  assert.equal(cands.length, 0, 'no candidate for 1-session sequence');
});

// ---------------------------------------------------------------------------
// Test 3: threshold edge cases.

test('aggregate: minSeqCount / minSeqSessions defaults — below threshold → nothing', () => {
  const pair = seq('npm run lint', 'npm run build');
  const sessions = [
    makeSession('s1', [pair]),        // 1 session, 1 occurrence → below 3 total
    makeSession('s2', [pair]),        // 2 sessions, 2 total — still below minSeqCount=3
  ];
  const cands = aggregate(sessions);
  assert.equal(cands.length, 0);
});

test('aggregate: exactly at threshold → one candidate', () => {
  const pair = seq('npm run lint', 'npm run build');
  const sessions = [
    makeSession('s1', [pair, pair]), // 2 from s1
    makeSession('s2', [pair]),       // 1 from s2 → 3 total, 2 sessions → qualifies
  ];
  const cands = aggregate(sessions);
  assert.equal(cands.length, 1);
});

// ---------------------------------------------------------------------------
// Test 4: propose writes inbox/<slug>/{action.json,SKILL.md}; idempotent.

test('propose: scaffolds actions/inbox/<slug>/ with action.json + SKILL.md', () => {
  const mnsDir = mkdtempSync(join(tmpdir(), 'mns-actions-miner-'));
  const pair = seq('npm ci', 'npm test');
  const sessions = [
    makeSession('sA', [pair, pair]),
    makeSession('sB', [pair]),
  ];
  const cands = aggregate(sessions);
  assert.equal(cands.length, 1);

  const n = propose(mnsDir, cands);
  assert.equal(n, 1, 'propose returns 1');

  const slug = cands[0].payload.slug;
  const inboxSlug = join(mnsDir, 'actions', 'inbox', slug);
  assert.ok(existsSync(inboxSlug), `inbox dir exists: ${inboxSlug}`);

  const actionJson = join(inboxSlug, 'action.json');
  assert.ok(existsSync(actionJson), 'action.json exists');
  const man = JSON.parse(readFileSync(actionJson, 'utf8'));
  assert.equal(man.slug, slug);
  assert.ok(typeof man.title === 'string' && man.title.length > 0);

  const skillMd = join(inboxSlug, 'SKILL.md');
  assert.ok(existsSync(skillMd), 'SKILL.md exists');
  const md = readFileSync(skillMd, 'utf8');
  // numbered steps must be present
  assert.ok(md.includes('1.'), 'SKILL.md has step 1');
  assert.ok(md.includes('npm ci'), 'SKILL.md mentions npm ci');
  assert.ok(md.includes('npm test'), 'SKILL.md mentions npm test');
});

// ---------------------------------------------------------------------------
// Test 5: idempotent — re-running propose does NOT create duplicates.

test('propose: idempotent — second call does not duplicate or throw', () => {
  const mnsDir = mkdtempSync(join(tmpdir(), 'mns-actions-idempotent-'));
  const pair = seq('npm ci', 'npm test');
  const sessions = [
    makeSession('sA', [pair, pair]),
    makeSession('sB', [pair]),
  ];
  const cands = aggregate(sessions);
  propose(mnsDir, cands);         // first run
  assert.doesNotThrow(() => propose(mnsDir, cands)); // second run — must not throw
  const n2 = propose(mnsDir, cands);
  assert.equal(n2, 0, 'second propose returns 0 (already exists)');
});

// ---------------------------------------------------------------------------
// Test 6: actions miner self-registers on import.

test('actions miner self-registers on import', () => {
  assert.ok(registry.get('actions'), 'actions miner in registry');
  assert.equal(registry.get('actions'), miner);
  assert.equal(miner.faculty, 'actions');
  assert.equal(typeof miner.aggregate, 'function');
  assert.equal(typeof miner.propose, 'function');
});
