import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdirSync as _mkdirA, writeFileSync as _writeA } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeDigest } from '../../zuzuu/digest/compose.mjs';
import { writeItem } from '../../zuzuu/knowledge/items.mjs';
import { createProposal } from '../../zuzuu/knowledge/proposals.mjs';
import { serializeEnvelope } from '../../zuzuu/module/envelope.mjs';

// Steering item envelope with the given prose body.
const steering = (body) => serializeEnvelope({
  id: 'steering', module: 'instructions', kind: 'steering', title: 'Project steering',
  status: 'active', created_at: '2026-06-12T00:00:00Z', payload: { scope: 'project' }, body,
});

// Build a throwaway .zuzuu home; return its path (the agentDir).
// seed.project = steering body text · seed.rules = {name: envelope text} rule items
function withHome(fn, seed = {}) {
  const root = mkdtempSync(join(tmpdir(), 'zuzuu-digest-'));
  const home = join(root, '.zuzuu');
  mkdirSync(join(home, 'knowledge', 'items'), { recursive: true });
  mkdirSync(join(home, 'knowledge', 'proposals'), { recursive: true });
  mkdirSync(join(home, 'instructions', 'items'), { recursive: true });
  mkdirSync(join(home, 'guardrails', 'items'), { recursive: true });
  if (seed.project != null) writeFileSync(join(home, 'instructions', 'items', 'steering.md'), steering(seed.project));
  for (const [name, text] of Object.entries(seed.rules ?? {})) {
    writeFileSync(join(home, 'guardrails', 'items', name), text);
  }
  try {
    return fn(home);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('empty instructions → interview directive', () => {
  withHome((home) => {
    const d = computeDigest(home);
    assert.match(d.text, /steering is empty/i);
    assert.match(d.text, /interview/i);
    assert.equal(d.sections.instructions.empty, true);
  }, { project: '<!-- Fill in: what this project is -->' });
});

test('filled instructions → steering text appears, not the directive', () => {
  withHome((home) => {
    const d = computeDigest(home);
    assert.match(d.text, /Ship daily\./);
    assert.doesNotMatch(d.text, /steering is empty/i);
    assert.equal(d.sections.instructions.empty, false);
  }, { project: 'Ship daily. Tests before merge.' });
});

test('missing steering item → interview directive', () => {
  withHome((home) => {
    const d = computeDigest(home);
    assert.match(d.text, /steering is empty/i);
    assert.equal(d.sections.instructions.empty, true);
  }); // no seed.project written
});

test('amendment items ride along after the steering body', () => {
  withHome((home) => {
    writeFileSync(join(home, 'instructions', 'items', 'always-test.md'), serializeEnvelope({
      id: 'always-test', module: 'instructions', kind: 'amendment', title: 'Always test',
      status: 'active', created_at: '2026-06-12T00:00:00Z', payload: {}, body: 'Always run the suite before merging.',
    }));
    const d = computeDigest(home);
    assert.match(d.text, /Ship daily\./);
    assert.match(d.text, /Always run the suite/);
    assert.ok(d.text.indexOf('Ship daily.') < d.text.indexOf('Always run the suite'), 'steering pins the top');
  }, { project: 'Ship daily.' });
});

const FILLED = 'Ship daily.';
const RULES = {
  'no-secret-reads.md': serializeEnvelope({
    id: 'no-secret-reads', module: 'guardrails', kind: 'rule', title: 'secrets', status: 'active',
    created_at: '2026-06-12T00:00:00Z', payload: { action: 'deny', tool: '*', pattern: '\\.env', reason: 'secrets' }, body: '',
  }),
};

test('knowledge section lists items newest-first, capped', () => {
  withHome((home) => {
    writeItem(home, { id: 'older', type: 'fact', created_at: '2026-06-01T00:00:00Z', status: 'active', attributes: {}, relations: [], provenance: [], body: 'older fact' });
    writeItem(home, { id: 'newer', type: 'command', created_at: '2026-06-09T00:00:00Z', status: 'active', attributes: {}, relations: [], provenance: [], body: 'newer fact' });
    const d = computeDigest(home, { knowledgeLimit: 5 });
    assert.equal(d.sections.knowledge.count, 2);
    assert.ok(d.text.indexOf('newer') < d.text.indexOf('older'));
    assert.match(d.text, /## Knowledge/);
  }, { project: FILLED });
});

test('proposals + guardrails sections reflect state', () => {
  withHome((home) => {
    createProposal(home, { candidate: { type: 'fact', body: 'releases must be tagged' }, source: 'test', evidence: {} });
    const d = computeDigest(home);
    assert.equal(d.sections.proposals.pending, 1);
    assert.match(d.text, /zuzuu review/);
    assert.match(d.text, /await your approval/);
    assert.equal(d.sections.guardrails.count, 1);
    assert.match(d.text, /enforced/i);
  }, { project: FILLED, rules: RULES });
});

test('a broken module does not sink the digest (fail-soft)', () => {
  withHome((home) => {
    const d = computeDigest(home);
    assert.match(d.text, /## Instructions/);
    assert.match(d.text, /## Knowledge/);
    assert.match(d.text, /## Guardrails/);        // section survives degradation
    assert.match(d.text, /no rules configured/);  // degraded, not absent
    assert.equal(d.sections.guardrails.count, 0);
    assert.equal(d.sections.guardrails.skipped, 1, 'the malformed item is counted, not fatal');
  }, { project: FILLED, rules: { 'broken.md': '{ not an envelope at all' } });
});

test('budget truncates the knowledge list but keeps instructions + guardrails', () => {
  withHome((home) => {
    for (let i = 0; i < 30; i++) {
      writeItem(home, { id: `item-${String(i).padStart(2, '0')}`, type: 'fact', created_at: `2026-06-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`, status: 'active', attributes: {}, relations: [], provenance: [], body: `fact number ${i} with some descriptive text here` });
    }
    const tiny = computeDigest(home, { budget: 80 }); // ~320-char knowledge budget
    // the variable knowledge list was truncated (not all shown)...
    assert.match(tiny.text, /\(\d+ more/);
    assert.ok(tiny.sections.knowledge.shown.length < 30);
    // ...while the fixed sections survive (never dropped)...
    assert.match(tiny.text, /## Instructions/);
    assert.match(tiny.text, /## Guardrails/);
    // ...and it's a real reduction vs an unbounded digest...
    const full = computeDigest(home, { budget: 100000, knowledgeLimit: 30 });
    assert.ok(tiny.text.length < full.text.length);
    // ...and deterministic.
    const again = computeDigest(home, { budget: 80 });
    assert.equal(tiny.text, again.text);
    // renderedCount reflects what actually appeared in the text
    assert.equal(typeof tiny.sections.knowledge.renderedCount, 'number');
    assert.ok(tiny.sections.knowledge.renderedCount >= 1);
    assert.ok(tiny.sections.knowledge.renderedCount <= tiny.sections.knowledge.shown.length);
  }, { project: '# Project steering\n\nShip daily.\n', rules: RULES });
});

test('digest Actions section lists slug · snippet (progressive disclosure)', () => {
  withHome((home) => {
    const a = join(home, 'actions', 'run-tests');
    _mkdirA(a, { recursive: true });
    _writeA(join(a, 'ACTION.md'), serializeEnvelope({
      id: 'run-tests', module: 'actions', kind: 'script', title: 'Run tests', status: 'active',
      created_at: '2026-06-12T00:00:00Z', payload: { exec: 'run.mjs' }, body: 'run the suite',
    }));
    _writeA(join(a, 'run.mjs'), 'export async function main(){ return {}; }');
    const d = computeDigest(home);
    assert.match(d.text, /## Actions/);
    assert.match(d.text, /run-tests · run the suite/);
    assert.equal(d.sections.actions.count, 1);
    assert.equal(d.sections.actions.renderedCount, 1);
  }, { project: '# Project steering\n\nShip daily.\n' });
});

test('digest omits the Actions section when there are none', () => {
  withHome((home) => {
    const d = computeDigest(home);
    assert.doesNotMatch(d.text, /## Actions/);
  }, { project: '# Project steering\n\nShip daily.\n' });
});
