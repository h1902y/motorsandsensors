// tests/unit/eval-wire.test.mjs
// WS4-T2: wire the eval lens into review + add `home eval`
// TDD — written before implementation (red → green).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'zuzuu.mjs');

// ---------------------------------------------------------------------------
// Helper: evalLine — the small extracted helper that formats one eval annotation.
// ---------------------------------------------------------------------------
test('evalLine formats score/confidence/rationale correctly', async () => {
  const { evalLine } = await import('../../zuzuu/commands/eval.mjs');
  const result = evalLine({ score: 0.775, confidence: 'high', rationale: 'recurring + cross-session' });
  assert.ok(result.startsWith('eval:'), `expected to start with 'eval:', got: ${result}`);
  assert.ok(result.includes('0.775'), 'score in output');
  assert.ok(result.includes('[high]'), 'confidence in output');
  assert.ok(result.includes('recurring + cross-session'), 'rationale in output');
  assert.ok(!result.includes('low-signal'), 'no warning for high confidence');
});

test('evalLine appends low-signal warning when confidence is low', async () => {
  const { evalLine } = await import('../../zuzuu/commands/eval.mjs');
  const result = evalLine({ score: 0.205, confidence: 'low', rationale: 'weak evidence' });
  assert.ok(result.includes('low-signal'), 'low confidence shows warning');
});

// ---------------------------------------------------------------------------
// Test: home eval prints proposals highest-score-first.
// ---------------------------------------------------------------------------
test('home eval prints proposals highest-score-first', () => {
  const root = mkdtempSync(join(tmpdir(), 'zuzuu-eval-'));
  const home = join(root, '.zuzuu');
  for (const d of ['knowledge/items', 'knowledge/inbox', 'knowledge/proposals', 'knowledge/registry', 'actions/inbox']) {
    mkdirSync(join(home, d), { recursive: true });
  }
  // Write two proposals with distinct evidence:
  //   p-high: occurrences=12, sessions=3, verdict=new → score 0.775 (high)
  //   p-low:  occurrences=1,  sessions=1, verdict=duplicate → score 0.205 (low)
  const highProposal = {
    id: 'p-high',
    kind: 'item',
    status: 'pending',
    source: 'distill',
    created_at: '2026-01-01T00:00:00Z',
    candidate: { id: 'p-high', type: 'command', body: 'high-score command', attributes: {}, relations: [] },
    evidence: { occurrences: 12, sessions: 3, failures: 0 },
    analysis: { er: { verdict: 'new' } },
    provenance: [],
    er: { verdict: 'new', confidence: 0.9, reason: 'new' },
  };
  const lowProposal = {
    id: 'p-low',
    kind: 'item',
    status: 'pending',
    source: 'distill',
    created_at: '2026-01-01T00:01:00Z',
    candidate: { id: 'p-low', type: 'fact', body: 'low-score fact', attributes: {}, relations: [] },
    evidence: { occurrences: 1, sessions: 1, failures: 0 },
    analysis: { er: { verdict: 'duplicate' } },
    provenance: [],
    er: { verdict: 'duplicate', confidence: 0.5, reason: 'dup' },
  };
  writeFileSync(join(home, 'knowledge', 'proposals', 'p-high.json'), JSON.stringify(highProposal, null, 2));
  writeFileSync(join(home, 'knowledge', 'proposals', 'p-low.json'), JSON.stringify(lowProposal, null, 2));

  try {
    const r = spawnSync(process.execPath, [BIN, 'eval'], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, `home eval failed: ${r.stderr}`);
    const lines = r.stdout.split('\n').filter((l) => l.trim());
    // p-high must appear before p-low
    const idxHigh = lines.findIndex((l) => l.includes('p-high'));
    const idxLow = lines.findIndex((l) => l.includes('p-low'));
    assert.ok(idxHigh !== -1, 'p-high found in output');
    assert.ok(idxLow !== -1, 'p-low found in output');
    assert.ok(idxHigh < idxLow, `p-high (idx ${idxHigh}) should appear before p-low (idx ${idxLow})`);
    // each line should have score, module, id
    const highLine = lines[idxHigh];
    assert.ok(highLine.includes('0.775') || highLine.includes('high'), 'high score line has score/confidence');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test: home eval --module filters to one module.
// ---------------------------------------------------------------------------
test('home eval --module knowledge shows only knowledge proposals', () => {
  const root = mkdtempSync(join(tmpdir(), 'zuzuu-eval-fac-'));
  const home = join(root, '.zuzuu');
  for (const d of ['knowledge/items', 'knowledge/inbox', 'knowledge/proposals', 'knowledge/registry', 'actions/inbox']) {
    mkdirSync(join(home, d), { recursive: true });
  }
  const proposal = {
    id: 'kp1',
    kind: 'item',
    status: 'pending',
    source: 'distill',
    created_at: '2026-01-01T00:00:00Z',
    candidate: { id: 'kp1', type: 'fact', body: 'a knowledge fact', attributes: {}, relations: [] },
    evidence: { occurrences: 5, sessions: 2 },
    analysis: { er: { verdict: 'new' } },
    provenance: [],
    er: { verdict: 'new', confidence: 0.8, reason: 'new' },
  };
  writeFileSync(join(home, 'knowledge', 'proposals', 'kp1.json'), JSON.stringify(proposal, null, 2));
  try {
    const r = spawnSync(process.execPath, [BIN, 'eval', '--module', 'knowledge'], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, `home eval --module failed: ${r.stderr}`);
    assert.ok(r.stdout.includes('kp1'), 'kp1 in output');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test: evalEvidence distils the raw evidence the UI renders to plain language.
// ---------------------------------------------------------------------------
test('evalEvidence carries occurrences/sessions/failures + erVerdict', async () => {
  const { evalEvidence } = await import('../../zuzuu/commands/eval.mjs');
  const full = evalEvidence({
    evidence: { occurrences: 12, sessions: 3, failures: 2 },
    analysis: { er: { verdict: 'new' } },
  });
  assert.deepEqual(full, { occurrences: 12, sessions: 3, failures: 2, erVerdict: 'new' });
});

test('evalEvidence never invents absent counts (inbox-sourced proposal)', async () => {
  const { evalEvidence } = await import('../../zuzuu/commands/eval.mjs');
  // inbox-sourced proposals carry only an inboxFile + er verdict
  const partial = evalEvidence({
    evidence: { inboxFile: 'note.txt' },
    analysis: { er: { verdict: 'new' } },
  });
  assert.deepEqual(partial, { erVerdict: 'new' });
  // a totally bare proposal yields an empty object, never undefined
  assert.deepEqual(evalEvidence({}), {});
  assert.deepEqual(evalEvidence(null), {});
});

// ---------------------------------------------------------------------------
// Test: `eval --json` carries the signals vector + raw evidence (the UI's
// source for plain-language "why" — the score's components, not just the float).
// ---------------------------------------------------------------------------
test('eval --json carries signals + evidence behind each score', () => {
  const root = mkdtempSync(join(tmpdir(), 'zuzuu-eval-json-'));
  const home = join(root, '.zuzuu');
  for (const d of ['knowledge/items', 'knowledge/inbox', 'knowledge/proposals', 'knowledge/registry', 'actions/inbox']) {
    mkdirSync(join(home, d), { recursive: true });
  }
  const proposal = {
    id: 'p-evidence',
    kind: 'item',
    status: 'pending',
    source: 'distill',
    created_at: '2026-01-01T00:00:00Z',
    candidate: { id: 'p-evidence', type: 'command', body: 'recurring command', attributes: {}, relations: [] },
    evidence: { occurrences: 12, sessions: 3, failures: 2 },
    analysis: { er: { verdict: 'new' } },
    provenance: [],
    er: { verdict: 'new', confidence: 0.9, reason: 'new' },
  };
  writeFileSync(join(home, 'knowledge', 'proposals', 'p-evidence.json'), JSON.stringify(proposal, null, 2));
  try {
    const r = spawnSync(process.execPath, [BIN, 'eval', '--json'], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, `eval --json failed: ${r.stderr}`);
    const data = JSON.parse(r.stdout);
    assert.ok(Array.isArray(data.ranked) && data.ranked.length === 1, 'one ranked entry');
    const e = data.ranked[0];
    // the existing shape still holds
    assert.equal(e.id, 'p-evidence');
    assert.equal(typeof e.score, 'number');
    assert.equal(typeof e.rationale, 'string');
    // NEW: the 5 normalized signal components
    assert.ok(e.signals && typeof e.signals === 'object', 'signals present');
    for (const k of ['occurrence', 'corroboration', 'recency', 'failureReduction', 'erNovelty']) {
      assert.equal(typeof e.signals[k], 'number', `signals.${k} is a number`);
      assert.ok(e.signals[k] >= 0 && e.signals[k] <= 1, `signals.${k} in [0,1]`);
    }
    // NEW: the raw evidence the UI renders to plain language
    assert.deepEqual(e.evidence, { occurrences: 12, sessions: 3, failures: 2, erVerdict: 'new' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test: distill persists `score` on created proposals.
// ---------------------------------------------------------------------------
test('distill persists score on created proposal', async () => {
  const root = mkdtempSync(join(tmpdir(), 'zuzuu-distill-score-'));
  const home = join(root, '.zuzuu');
  for (const d of ['knowledge/items', 'knowledge/inbox', 'knowledge/proposals', 'knowledge/registry']) {
    mkdirSync(join(home, d), { recursive: true });
  }
  // Write a minimal type registry
  writeFileSync(join(home, 'knowledge', 'registry', 'types.json'), JSON.stringify([{ name: 'command', description: 'a command' }]));

  const { createProposal } = await import('../../zuzuu/knowledge/proposals.mjs');
  const p = createProposal(home, {
    candidate: {
      id: 'cmd-npm-test',
      type: 'command',
      body: 'Recurring project command: `npm test`',
      attributes: { command: 'npm test' },
      relations: [],
      provenance: [],
    },
    source: 'distill',
    evidence: { occurrences: 5, sessions: 2, failures: 0 },
  });

  assert.ok(p.score, 'score field present on created proposal');
  assert.ok(typeof p.score.score === 'number', 'score.score is a number');
  assert.ok(typeof p.score.confidence === 'string', 'score.confidence is a string');
  assert.ok(typeof p.score.rationale === 'string', 'score.rationale is a string');

  // Verify it was persisted to disk too
  const onDisk = JSON.parse(readFileSync(join(home, 'knowledge', 'proposals', `${p.id}.json`), 'utf8'));
  assert.ok(onDisk.score, 'score written to disk');
  assert.equal(onDisk.score.score, p.score.score, 'disk score matches returned score');

  rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Test: review card includes eval: line (test via home review output).
// ---------------------------------------------------------------------------
test('review displays eval: line for knowledge proposals', () => {
  const root = mkdtempSync(join(tmpdir(), 'zuzuu-rev-eval-'));
  const home = join(root, '.zuzuu');
  for (const d of ['knowledge/items', 'knowledge/inbox', 'knowledge/proposals', 'knowledge/registry', 'actions/inbox']) {
    mkdirSync(join(home, d), { recursive: true });
  }
  writeFileSync(join(home, 'knowledge', 'registry', 'types.json'), JSON.stringify([{ name: 'fact', description: 'A fact' }]));
  // Drop a fact into inbox; processInbox will turn it into a proposal on review start
  writeFileSync(join(home, 'knowledge', 'inbox', 'myfact.md'), 'zero deps is a hard policy');

  const r = spawnSync(process.execPath, [BIN, 'review'], { cwd: root, input: 's\n', encoding: 'utf8' });
  assert.equal(r.status, 0, `review failed: ${r.stderr}`);
  // The card printed during review should contain an eval: line
  assert.ok(r.stdout.includes('eval:'), `stdout should contain 'eval:' line, got:\n${r.stdout}`);
});
