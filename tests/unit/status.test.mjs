// tests/unit/status.test.mjs (WS-C)
// The faculties graduation line in `home status` — driven through the pure
// facultiesLine(agentDir) helper (no console scraping).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { facultiesLine } from '../../zuzuu/commands/status.mjs';
import { mintGeneration } from '../../zuzuu/faculty/generation/write.mjs';

function freshHome() {
  const root = mkdtempSync(join(tmpdir(), 'zuzuu-status-'));
  const home = join(root, '.zuzuu');
  mkdirSync(join(home, 'knowledge', 'items'), { recursive: true });
  mkdirSync(join(home, 'knowledge', 'proposals'), { recursive: true });
  mkdirSync(join(home, 'knowledge', 'registry'), { recursive: true });
  mkdirSync(join(home, 'generations', 'snapshots'), { recursive: true });
  writeFileSync(join(home, 'agent.json'), JSON.stringify({ version: 1 }) + '\n');
  return { root, home };
}

function addProposal(home, i) {
  const id = `fact-${i}`;
  writeFileSync(
    join(home, 'knowledge', 'proposals', `${id}.json`),
    JSON.stringify({ id, faculty: 'knowledge', kind: 'item', status: 'pending', created_at: `2026-01-0${i + 1}T00:00:00.000Z`, candidate: { id, type: 'fact', body: `f${i}` }, er: { verdict: 'new' } }),
  );
}

test('no generation + no pending → "no generation yet · 0 pending review"', () => {
  const { root, home } = freshHome();
  try {
    const line = facultiesLine(home);
    assert.match(line, /no generation yet/);
    assert.match(line, /0 pending review/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('active generation + pending count are reflected', () => {
  const { root, home } = freshHome();
  try {
    writeFileSync(join(home, 'knowledge', 'items', 'alpha.md'), '---\nid: alpha\ntype: fact\n---\nA.\n');
    mintGeneration(home);
    addProposal(home, 0);
    addProposal(home, 1);
    const line = facultiesLine(home);
    assert.match(line, /gen_001/);
    assert.match(line, /2 pending review/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
