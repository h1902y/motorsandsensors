import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeDigest } from '../../mns/digest.mjs';

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
