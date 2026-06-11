// tests/unit/status.test.mjs (WS-C)
// The faculties graduation line in `mns status` — driven through the pure
// facultiesLine(mnsDir) helper (no console scraping).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { facultiesLine } from '../../zuzuu/commands/status.mjs';
import { mintGeneration } from '../../zuzuu/faculty/generation.mjs';

function freshHome() {
  const root = mkdtempSync(join(tmpdir(), 'mns-status-'));
  const mns = join(root, 'agent');
  mkdirSync(join(mns, 'knowledge', 'items'), { recursive: true });
  mkdirSync(join(mns, 'knowledge', 'proposals'), { recursive: true });
  mkdirSync(join(mns, 'knowledge', 'registry'), { recursive: true });
  mkdirSync(join(mns, 'generations', 'snapshots'), { recursive: true });
  writeFileSync(join(mns, 'mns.json'), JSON.stringify({ version: 1 }) + '\n');
  return { root, mns };
}

function addProposal(mns, i) {
  const id = `fact-${i}`;
  writeFileSync(
    join(mns, 'knowledge', 'proposals', `${id}.json`),
    JSON.stringify({ id, faculty: 'knowledge', kind: 'item', status: 'pending', created_at: `2026-01-0${i + 1}T00:00:00.000Z`, candidate: { id, type: 'fact', body: `f${i}` }, er: { verdict: 'new' } }),
  );
}

test('no generation + no pending → "no generation yet · 0 pending review"', () => {
  const { root, mns } = freshHome();
  try {
    const line = facultiesLine(mns);
    assert.match(line, /no generation yet/);
    assert.match(line, /0 pending review/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('active generation + pending count are reflected', () => {
  const { root, mns } = freshHome();
  try {
    writeFileSync(join(mns, 'knowledge', 'items', 'alpha.md'), '---\nid: alpha\ntype: fact\n---\nA.\n');
    mintGeneration(mns);
    addProposal(mns, 0);
    addProposal(mns, 1);
    const line = facultiesLine(mns);
    assert.match(line, /gen_001/);
    assert.match(line, /2 pending review/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
