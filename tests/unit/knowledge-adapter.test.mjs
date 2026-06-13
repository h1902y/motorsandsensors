// WS2-T2 — the Knowledge module adapter. Verifies the adapter wraps the existing
// approve pipeline behaviour-preservingly: ingest runs ER, validate uses the
// registry, apply writes + indexes the item, render produces a human card.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SEED_TYPES, SEED_ATTRIBUTES, SEED_RELATIONS } from '../../zuzuu/knowledge/registry.mjs';
import { createProposal, getProposal } from '../../zuzuu/knowledge/proposals.mjs';
import { readItem } from '../../zuzuu/knowledge/items.mjs';
import { search } from '../../zuzuu/knowledge/index.mjs';
import * as registry from '../../zuzuu/module/registry.mjs'; // built-ins always present

function withHome(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'zuzuu-kadapter-'));
  const agentDir = join(dir, '.zuzuu');
  const reg = join(agentDir, 'knowledge', 'registry');
  mkdirSync(reg, { recursive: true });
  writeFileSync(join(reg, 'types.json'), JSON.stringify(SEED_TYPES));
  writeFileSync(join(reg, 'attributes.json'), JSON.stringify(SEED_ATTRIBUTES));
  writeFileSync(join(reg, 'relations.json'), JSON.stringify(SEED_RELATIONS));
  try {
    return fn(agentDir, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('adapter: registered under name "knowledge"', () => {
  const a = registry.get('knowledge');
  assert.ok(a, 'knowledge adapter is registered');
  assert.equal(a.name, 'knowledge');
  for (const fn of ['ingest', 'validate', 'apply', 'render']) {
    assert.equal(typeof a[fn], 'function', `${fn} is a function`);
  }
});

test('adapter.apply: writes the item to knowledge/items/ and indexes it', () => {
  withHome((agentDir) => {
    const p = createProposal(agentDir, { candidate: { type: 'fact', body: 'CI runs Node 22 and 24' }, source: 'test' });
    const a = registry.get('knowledge');
    const r = a.apply(agentDir, p);
    assert.ok(r.ok);
    assert.match(r.action, /^created /);
    assert.ok(Array.isArray(r.itemIds) && r.itemIds.length === 1);
    // item file written
    const item = readItem(agentDir, r.itemIds[0]);
    assert.ok(item, 'item file exists');
    assert.equal(item.type, 'fact');
    // indexed (searchable)
    const hits = search(agentDir, 'Node');
    assert.ok(hits.some((h) => h.id === r.itemIds[0]), 'item present in index');
  });
});

test('adapter.ingest: runs ER and returns payload + dedupeKey', () => {
  withHome((agentDir) => {
    const a = registry.get('knowledge');
    const out = a.ingest(agentDir, { candidate: { type: 'fact', body: 'Releases publish via OIDC trusted publishing' }, source: 'test' });
    assert.ok(out.payload, 'payload present');
    assert.ok(out.analysis && out.analysis.er, 'ER analysis present');
    assert.equal(out.analysis.er.verdict, 'new');
    assert.equal(out.dedupeKey, out.payload.id);
  });
});

test('adapter.validate: rejects an item with an unknown registry type', () => {
  withHome((agentDir) => {
    const a = registry.get('knowledge');
    const ok = a.validate(agentDir, { id: 'x', type: 'fact', body: 'fine', attributes: {}, relations: [] });
    assert.equal(ok.ok, true);
    const bad = a.validate(agentDir, { id: 'y', type: 'nonsense-type', body: 'bad', attributes: {}, relations: [] });
    assert.equal(bad.ok, false);
    assert.ok(bad.errors.some((e) => /nonsense-type/.test(e)));
  });
});

test('adapter.render: returns a non-empty card mentioning the item id', () => {
  withHome((agentDir) => {
    const p = createProposal(agentDir, { candidate: { type: 'fact', body: 'Deploys are gated on the efficiency benchmark' }, source: 'test' });
    const fresh = getProposal(agentDir, p.id);
    const a = registry.get('knowledge');
    const out = a.render(fresh);
    assert.ok(out.card && out.card.length > 0, 'card non-empty');
    assert.ok(out.card.includes(fresh.candidate.id), 'card mentions item id');
    assert.ok(typeof out.line === 'string' && out.line.length > 0, 'line non-empty');
  });
});
