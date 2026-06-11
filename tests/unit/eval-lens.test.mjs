// tests/unit/eval-lens.test.mjs
// Golden deterministic tests for the mechanical eval lens (WS4-T1).
// All expected scores are pre-computed by hand from the weight formula and pinned.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractSignals } from '../../mns/eval/signals.mjs';
import { mechanicalScore, getScorer, SCORERS } from '../../mns/eval/score.mjs';
import { rank } from '../../mns/eval/rank.mjs';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function makeProposal({ id = 'p1', occurrences = 0, sessions = 0, failures = 0, verdict = 'new', provenance = [] } = {}) {
  return {
    id,
    analysis: { er: { verdict } },
    evidence: { occurrences, sessions, failures },
    provenance,
  };
}

// ---------------------------------------------------------------------------
// Case 1: high-occurrence cross-session proposal
// evidence: occurrences=12, sessions=3, failures=0 | er: new | no sessionMtimes
//
// occurrence     = min(12/10, 1)         = 1.0
// corroboration  = min(3/3, 1)           = 1.0
// recency        = 0.5                   (no mtimes → neutral)
// failureRed     = min(0/3, 1)           = 0.0
// erNovelty      = 1.0                   (new)
//
// score = 0.30*1.0 + 0.30*1.0 + 0.15*0.5 + 0.15*0.0 + 0.10*1.0
//       = 0.30 + 0.30 + 0.075 + 0.00 + 0.10 = 0.775
// ---------------------------------------------------------------------------
const HIGH_PROPOSAL = makeProposal({ id: 'high-p', occurrences: 12, sessions: 3, verdict: 'new' });

test('case 1: high-occurrence cross-session proposal scores 0.775, confidence high', () => {
  const result = mechanicalScore(HIGH_PROPOSAL, { now: 1000 });
  assert.equal(result.score, 0.775);
  assert.equal(result.confidence, 'high');
  assert.ok(typeof result.rationale === 'string' && result.rationale.length > 0, 'rationale is a non-empty string');
  assert.ok(result.signals, 'signals are returned');
});

// ---------------------------------------------------------------------------
// Case 2: duplicate-ER, low-occurrence — must score below case 1
// evidence: occurrences=1, sessions=1, failures=0 | er: duplicate | no sessionMtimes
//
// occurrence     = min(1/10, 1)         = 0.1
// corroboration  = min(1/3, 1)          = 0.3333…
// recency        = 0.5                  (neutral)
// failureRed     = 0.0
// erNovelty      = 0.0                  (duplicate)
//
// score = 0.30*0.1 + 0.30*(1/3) + 0.15*0.5 + 0.0 + 0.0
//       = 0.03 + 0.1 + 0.075 = 0.205
// ---------------------------------------------------------------------------
const LOW_PROPOSAL = makeProposal({ id: 'low-p', occurrences: 1, sessions: 1, verdict: 'duplicate' });

test('case 2: duplicate-ER low-occurrence proposal scores 0.205, confidence low, ranks below case 1', () => {
  const result = mechanicalScore(LOW_PROPOSAL, { now: 1000 });
  assert.equal(result.score, 0.205);
  assert.equal(result.confidence, 'low');
  // ranks below the high proposal
  const ranked = rank([LOW_PROPOSAL, HIGH_PROPOSAL]);
  assert.equal(ranked[0].proposal.id, 'high-p');
  assert.equal(ranked[1].proposal.id, 'low-p');
});

// ---------------------------------------------------------------------------
// Case 3: extractSignals clamps to [0,1]; missing evidence → all-low, no NaN
// ---------------------------------------------------------------------------
test('extractSignals clamps to [0,1] and handles missing evidence without NaN', () => {
  // over-threshold → clamps to 1
  const big = { id: 'big', analysis: { er: { verdict: 'new' } }, evidence: { occurrences: 999, sessions: 999, failures: 999 }, provenance: [] };
  const sigs = extractSignals(big, { now: 0 });
  assert.equal(sigs.occurrence, 1);
  assert.equal(sigs.corroboration, 1);
  assert.equal(sigs.failureReduction, 1);
  assert.equal(sigs.erNovelty, 1);

  // empty proposal → no NaN, all values in [0,1]
  const empty = {};
  const sigsEmpty = extractSignals(empty, { now: 0 });
  for (const [k, v] of Object.entries(sigsEmpty)) {
    assert.ok(!isNaN(v), `${k} should not be NaN`);
    assert.ok(v >= 0 && v <= 1, `${k}=${v} should be in [0,1]`);
  }
});

// ---------------------------------------------------------------------------
// Case 4: recency — deterministic injection of now + sessionMtimes
// ---------------------------------------------------------------------------
test('recency: recent session → ≈1; stale → ≈0; unknown → 0.5', () => {
  const WINDOW = 30 * 24 * 60 * 60 * 1000; // 30 days in ms
  const now = 1_000_000_000; // arbitrary fixed epoch ms

  // recent: session mtime = now (age = 0 → recency = 1)
  const recentProposal = {
    id: 'rec',
    analysis: { er: { verdict: 'new' } },
    evidence: { occurrences: 1, sessions: 1 },
    provenance: [{ session: 'sess-recent' }],
  };
  const sigsRecent = extractSignals(recentProposal, {
    now,
    sessionMtimes: { 'sess-recent': now },
  });
  assert.equal(sigsRecent.recency, 1);

  // stale: session mtime = now - WINDOW (age = WINDOW → recency = 0)
  const staleProposal = {
    id: 'stale',
    analysis: { er: { verdict: 'new' } },
    evidence: { occurrences: 1, sessions: 1 },
    provenance: [{ session: 'sess-stale' }],
  };
  const sigsStale = extractSignals(staleProposal, {
    now,
    sessionMtimes: { 'sess-stale': now - WINDOW },
  });
  assert.equal(sigsStale.recency, 0);

  // unknown: no sessionMtimes entry → 0.5
  const unknownProposal = {
    id: 'unk',
    analysis: { er: { verdict: 'new' } },
    evidence: { occurrences: 1, sessions: 1 },
    provenance: [{ session: 'sess-unknown' }],
  };
  const sigsUnknown = extractSignals(unknownProposal, { now, sessionMtimes: {} });
  assert.equal(sigsUnknown.recency, 0.5);
});

// ---------------------------------------------------------------------------
// Case 5: rank orders high→low, stable ties by proposal.id, no mutation
// ---------------------------------------------------------------------------
test('rank: orders proposals high→low, stable on ties, does not mutate input', () => {
  const p1 = makeProposal({ id: 'alpha', occurrences: 12, sessions: 3, verdict: 'new' });
  const p2 = makeProposal({ id: 'beta',  occurrences: 1,  sessions: 1, verdict: 'duplicate' });
  // p3 is identical to p2 by score (same evidence + verdict) but different id
  const p3 = makeProposal({ id: 'gamma', occurrences: 1,  sessions: 1, verdict: 'duplicate' });

  const input = [p2, p1, p3];
  const before = JSON.stringify(input);
  const ranked = rank(input);

  // input array is not mutated
  assert.equal(JSON.stringify(input), before);

  // high scorer first
  assert.equal(ranked[0].proposal.id, 'alpha');
  // p2 and p3 tie; stable sort by id: 'beta' < 'gamma'
  assert.equal(ranked[1].proposal.id, 'beta');
  assert.equal(ranked[2].proposal.id, 'gamma');

  // each entry has both proposal and score fields
  for (const entry of ranked) {
    assert.ok('proposal' in entry);
    assert.ok('score' in entry);
    assert.ok('confidence' in entry);
  }
});

// ---------------------------------------------------------------------------
// Case 6: getScorer fallback and identity
// ---------------------------------------------------------------------------
test('getScorer("nope") falls back to mechanical; getScorer("mechanical") === mechanicalScore', () => {
  assert.equal(getScorer('mechanical'), mechanicalScore);
  assert.equal(getScorer('nope'), mechanicalScore);
  assert.ok('mechanical' in SCORERS);
});
