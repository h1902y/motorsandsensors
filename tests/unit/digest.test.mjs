import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdirSync as _mkdirA, writeFileSync as _writeA } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeDigest } from '../../zuzuu/digest.mjs';
import { writeItem } from '../../zuzuu/knowledge/items.mjs';
import { createProposal } from '../../zuzuu/knowledge/proposals.mjs';

// Build a throwaway .mns home; return its path (the mnsDir).
function withHome(fn, seed = {}) {
  const root = mkdtempSync(join(tmpdir(), 'mns-digest-'));
  const mns = join(root, '.mns');
  mkdirSync(join(mns, 'knowledge', 'items'), { recursive: true });
  mkdirSync(join(mns, 'knowledge', 'proposals'), { recursive: true });
  mkdirSync(join(mns, 'instructions'), { recursive: true });
  mkdirSync(join(mns, 'guardrails'), { recursive: true });
  if (seed.project != null) writeFileSync(join(mns, 'instructions', 'project.md'), seed.project);
  if (seed.rules != null) writeFileSync(join(mns, 'guardrails', 'rules.json'), seed.rules);
  try {
    return fn(mns);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('empty instructions → interview directive', () => {
  withHome((mns) => {
    const d = computeDigest(mns);
    assert.match(d.text, /steering is empty/i);
    assert.match(d.text, /interview/i);
    assert.equal(d.sections.instructions.empty, true);
  }, { project: '# Project steering\n\n<!-- Fill in: what this project is -->\n' });
});

test('filled instructions → steering text appears, not the directive', () => {
  withHome((mns) => {
    const d = computeDigest(mns);
    assert.match(d.text, /Ship daily\./);
    assert.doesNotMatch(d.text, /steering is empty/i);
    assert.equal(d.sections.instructions.empty, false);
  }, { project: '# Project steering\n\nShip daily. Tests before merge.\n' });
});

test('missing instructions file → interview directive', () => {
  withHome((mns) => {
    const d = computeDigest(mns);
    assert.match(d.text, /steering is empty/i);
    assert.equal(d.sections.instructions.empty, true);
  }); // no seed.project written
});

const FILLED = '# Project steering\n\nShip daily.\n';
const RULES = JSON.stringify({
  version: 1,
  rules: [{ id: 'no-secret-reads', action: 'deny', tool: '*', pattern: '\\.env', reason: 'secrets' }],
});

test('knowledge section lists items newest-first, capped', () => {
  withHome((mns) => {
    writeItem(mns, { id: 'older', type: 'fact', created_at: '2026-06-01T00:00:00Z', status: 'active', attributes: {}, relations: [], provenance: [], body: 'older fact' });
    writeItem(mns, { id: 'newer', type: 'command', created_at: '2026-06-09T00:00:00Z', status: 'active', attributes: {}, relations: [], provenance: [], body: 'newer fact' });
    const d = computeDigest(mns, { knowledgeLimit: 5 });
    assert.equal(d.sections.knowledge.count, 2);
    assert.ok(d.text.indexOf('newer') < d.text.indexOf('older'));
    assert.match(d.text, /## Knowledge/);
  }, { project: FILLED });
});

test('proposals + guardrails sections reflect state', () => {
  withHome((mns) => {
    createProposal(mns, { candidate: { type: 'fact', body: 'releases must be tagged' }, source: 'test', evidence: {} });
    const d = computeDigest(mns);
    assert.equal(d.sections.proposals.pending, 1);
    assert.match(d.text, /zuzuu review/);
    assert.match(d.text, /await your approval/);
    assert.equal(d.sections.guardrails.count, 1);
    assert.match(d.text, /enforced/i);
  }, { project: FILLED, rules: RULES });
});

test('a broken faculty does not sink the digest (fail-soft)', () => {
  withHome((mns) => {
    const d = computeDigest(mns);
    assert.match(d.text, /## Instructions/);
    assert.match(d.text, /## Knowledge/);
    assert.match(d.text, /## Guardrails/);        // section survives degradation
    assert.match(d.text, /no rules configured/);  // degraded, not absent
    assert.equal(d.sections.guardrails.count, 0);
    assert.equal(d.sections.guardrails.ok, false);
  }, { project: FILLED, rules: '{ not json' });
});

test('budget truncates the knowledge list but keeps instructions + guardrails', () => {
  withHome((mns) => {
    for (let i = 0; i < 30; i++) {
      writeItem(mns, { id: `item-${String(i).padStart(2, '0')}`, type: 'fact', created_at: `2026-06-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`, status: 'active', attributes: {}, relations: [], provenance: [], body: `fact number ${i} with some descriptive text here` });
    }
    const tiny = computeDigest(mns, { budget: 80 }); // ~320-char knowledge budget
    // the variable knowledge list was truncated (not all shown)...
    assert.match(tiny.text, /\(\d+ more/);
    assert.ok(tiny.sections.knowledge.shown.length < 30);
    // ...while the fixed sections survive (never dropped)...
    assert.match(tiny.text, /## Instructions/);
    assert.match(tiny.text, /## Guardrails/);
    // ...and it's a real reduction vs an unbounded digest...
    const full = computeDigest(mns, { budget: 100000, knowledgeLimit: 30 });
    assert.ok(tiny.text.length < full.text.length);
    // ...and deterministic.
    const again = computeDigest(mns, { budget: 80 });
    assert.equal(tiny.text, again.text);
    // renderedCount reflects what actually appeared in the text
    assert.equal(typeof tiny.sections.knowledge.renderedCount, 'number');
    assert.ok(tiny.sections.knowledge.renderedCount >= 1);
    assert.ok(tiny.sections.knowledge.renderedCount <= tiny.sections.knowledge.shown.length);
  }, { project: '# Project steering\n\nShip daily.\n', rules: RULES });
});

test('digest Actions section lists slug · snippet (progressive disclosure)', () => {
  withHome((mns) => {
    const a = join(mns, 'actions', 'run-tests');
    _mkdirA(a, { recursive: true });
    _writeA(join(a, 'action.json'), JSON.stringify({ slug: 'run-tests', promptSnippet: 'run the suite', inputs: { type: 'object' }, outputs: { type: 'object' } }));
    _writeA(join(a, 'run.mjs'), 'export async function main(){ return {}; }');
    const d = computeDigest(mns);
    assert.match(d.text, /## Actions/);
    assert.match(d.text, /run-tests · run the suite/);
    assert.equal(d.sections.actions.count, 1);
    assert.equal(d.sections.actions.renderedCount, 1);
  }, { project: '# Project steering\n\nShip daily.\n' });
});

test('digest omits the Actions section when there are none', () => {
  withHome((mns) => {
    const d = computeDigest(mns);
    assert.doesNotMatch(d.text, /## Actions/);
  }, { project: '# Project steering\n\nShip daily.\n' });
});
