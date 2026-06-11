// tests/unit/json-outputs.test.mjs
// The --json outputs the zuzuu-web daemon consumes (status/inbox/generation/digest).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { statusData } from '../../zuzuu/commands/status.mjs';
import { inboxData } from '../../zuzuu/commands/inbox.mjs';
import { generationListData, generationShowData } from '../../zuzuu/commands/generation.mjs';
import { mintGeneration } from '../../zuzuu/faculty/generation.mjs';
import { digestData } from '../../zuzuu/commands/digest.mjs';

function withHome(fn) {
  const root = mkdtempSync(join(tmpdir(), 'zjson-'));
  const dir = join(root, 'agent');
  mkdirSync(join(dir, 'knowledge', 'proposals'), { recursive: true });
  try { return fn(dir); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('statusData reports home, generation, pending map, drift', () => {
  withHome((dir) => {
    const d = statusData(dir);
    assert.equal(d.home, true);
    assert.equal(d.activeGeneration, null);          // none minted
    assert.equal(typeof d.pending, 'object');
    assert.equal(d.pending.knowledge, 0);
    assert.equal(d.drift.dirty, false);
  });
});

test('inboxData lists pending proposals with faculty + title + total', () => {
  withHome((dir) => {
    writeFileSync(join(dir, 'knowledge', 'proposals', 'p1.json'),
      JSON.stringify({ id: 'p1', kind: 'item', status: 'pending',
        candidate: { id: 'p1', type: 'fact', body: 'use node:sqlite', attributes: {}, relations: [], provenance: [] } }));
    const d = inboxData(dir);
    assert.equal(d.total, 1);
    assert.equal(d.pending[0].faculty, 'knowledge');
    assert.equal(d.pending[0].id, 'p1');
    assert.match(d.pending[0].title, /node:sqlite/);
  });
});

test('generationListData returns active + list; showData returns the diff', () => {
  withHome((dir) => {
    const lf = mintGeneration(dir, { forkedFrom: null });
    const list = generationListData(dir);
    assert.equal(list.active, lf.id);
    assert.equal(list.generations[0].id, lf.id);
    const show = generationShowData(dir, lf.id);
    assert.equal(show.id, lf.id);
    assert.ok(show.faculties && typeof show.faculties === 'object');
    assert.equal(generationShowData(dir, 'gen_999'), null);   // unknown id
  });
});

test('digestData returns { text }', () => {
  withHome((dir) => {
    const d = digestData(dir);
    assert.equal(typeof d.text, 'string');
  });
});
