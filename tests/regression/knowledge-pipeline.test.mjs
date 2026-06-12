import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { resolve as erResolve, merge, tokens, jaccard } from '../../zuzuu/knowledge/er.mjs';
import { createProposal, approveProposal, rejectProposal, listProposals, fileRegistryProposals } from '../../zuzuu/knowledge/proposals.mjs';
import { processInbox } from '../../zuzuu/knowledge/inbox.mjs';
import { writeItem, readItem } from '../../zuzuu/knowledge/items.mjs';
import { SEED_TYPES, SEED_ATTRIBUTES, SEED_RELATIONS, loadRegistry } from '../../zuzuu/knowledge/registry.mjs';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'zuzuu.mjs');

function withHome(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'zuzuu-pipe-'));
  const agentDir = join(dir, '.zuzuu');
  const reg = join(agentDir, 'knowledge', 'registry');
  mkdirSync(reg, { recursive: true });
  mkdirSync(join(agentDir, 'knowledge', 'inbox'), { recursive: true });
  writeFileSync(join(reg, 'types.json'), JSON.stringify(SEED_TYPES));
  writeFileSync(join(reg, 'attributes.json'), JSON.stringify(SEED_ATTRIBUTES));
  writeFileSync(join(reg, 'relations.json'), JSON.stringify(SEED_RELATIONS));
  try {
    return fn(agentDir, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const EXISTING = {
  id: 'test-command', type: 'command', created_at: '2026-06-10T00:00:00Z', status: 'active',
  attributes: { command: 'npm test' }, relations: [], provenance: [{ session: 's1', ref: 'x' }],
  body: 'The test suite runs with npm test',
};

// ── ER goldens ──────────────────────────────────────────────────────────────

test('er: unrelated candidate → new', () => {
  const r = erResolve({ type: 'fact', body: 'Releases publish via OIDC trusted publishing' }, [EXISTING]);
  assert.equal(r.verdict, 'new');
});

test('er: exact id match → duplicate when nothing new, enrich when evidence added', () => {
  const dup = erResolve({ id: 'test-command', type: 'command', body: 'The test suite runs with npm test', attributes: { command: 'npm test' } }, [EXISTING]);
  assert.equal(dup.verdict, 'duplicate');
  assert.equal(dup.match, 'test-command');
  const enr = erResolve({ id: 'test-command', type: 'command', body: 'same', attributes: { domain: 'testing' }, provenance: [{ session: 's2', ref: 'y' }] }, [EXISTING]);
  assert.equal(enr.verdict, 'enrich');
});

test('er: fuzzy same-type match resolves to the item (duplicate when adding nothing, enrich when adding); cross-type stays new', () => {
  // same attribute value + no new info → DUPLICATE (correctly adds nothing)
  const dup = erResolve({ type: 'command', body: 'Project tests run via npm test quickly', attributes: { command: 'npm test' } }, [EXISTING]);
  assert.equal(dup.verdict, 'duplicate', 'token overlap + shared command value crosses threshold');
  assert.equal(dup.match, 'test-command');
  // same fuzzy match but carrying new provenance → ENRICH
  const enr = erResolve({ type: 'command', body: 'Project tests run via npm test quickly', attributes: { command: 'npm test' }, provenance: [{ session: 's9', ref: 'distill' }] }, [EXISTING]);
  assert.equal(enr.verdict, 'enrich');
  const crossType = erResolve({ type: 'fact', body: 'The test suite runs with npm test', attributes: {} }, [EXISTING]);
  assert.equal(crossType.verdict, 'new', 'different type → biased to new (human gate decides)');
});

test('er: merge unions attrs/relations/provenance without overwriting', () => {
  const merged = merge(EXISTING, { attributes: { command: 'IGNORED', domain: 'testing' }, relations: [{ type: 'relates-to', target: 'ci' }], provenance: [{ session: 's2', ref: 'y' }] });
  assert.equal(merged.attributes.command, 'npm test', 'existing value wins');
  assert.equal(merged.attributes.domain, 'testing');
  assert.equal(merged.relations.length, 1);
  assert.equal(merged.provenance.length, 2);
});

test('er: tokens strips stopwords; jaccard sane', () => {
  assert.ok(!tokens('the project is a test').has('the'));
  assert.equal(jaccard(new Set(['a', 'b']), new Set(['a', 'b'])), 1);
  assert.equal(jaccard(new Set(['a']), new Set(['b'])), 0);
});

// ── proposal lifecycle ──────────────────────────────────────────────────────

test('proposal: create → approve(new) writes item + archives; reject archives with reason', () => {
  withHome((agentDir) => {
    const p = createProposal(agentDir, { candidate: { type: 'fact', body: 'CI runs Node 22 and 24' }, source: 'test', evidence: { occurrences: 3 } });
    assert.equal(p.status, 'pending');
    assert.equal(p.er.verdict, 'new');
    const r = approveProposal(agentDir, p.id);
    assert.ok(r.ok);
    assert.match(r.action, /^created /);
    assert.ok(readItem(agentDir, r.item), 'item file exists');
    assert.equal(listProposals(agentDir).length, 0, 'archived out of pending');

    const p2 = createProposal(agentDir, { candidate: { type: 'fact', body: 'Some other unrelated fact about deploys' }, source: 'test' });
    assert.ok(rejectProposal(agentDir, p2.id, 'nope').ok);
    const archived = JSON.parse(readFileSync(join(agentDir, 'knowledge', 'proposals', 'archive', `${p2.id}.json`), 'utf8'));
    assert.equal(archived.status, 'rejected');
    assert.equal(archived.reason, 'nope');
  });
});

test('proposal: approve(enrich) merges into the matched item', () => {
  withHome((agentDir) => {
    writeItem(agentDir, EXISTING);
    const p = createProposal(agentDir, { candidate: { id: 'test-command', type: 'command', body: 'same', attributes: { domain: 'testing' } }, source: 'test' });
    assert.equal(p.er.verdict, 'enrich');
    const r = approveProposal(agentDir, p.id);
    assert.match(r.action, /^enriched test-command/);
    assert.equal(readItem(agentDir, 'test-command').attributes.domain, 'testing');
  });
});

test('proposal: unknown keys are dropped with warnings on approve; ≥3 occurrences file a registry proposal whose approval registers the key', () => {
  withHome((agentDir) => {
    for (const n of [1, 2, 3]) {
      createProposal(agentDir, { candidate: { id: `fact-${n}`, type: 'fact', body: `distinct fact number ${n} about thing-${n}`, attributes: { sentiment: 'positive' } }, source: 'test' });
    }
    const filed = fileRegistryProposals(agentDir);
    assert.equal(filed.length, 1);
    assert.equal(filed[0].key, 'sentiment');
    // approving an item proposal first → unknown key dropped, warned
    const pending = listProposals(agentDir).filter((p) => p.kind === 'item');
    const r1 = approveProposal(agentDir, pending[0].id);
    assert.ok(r1.warnings.some((w) => w.includes('sentiment')));
    assert.equal(readItem(agentDir, r1.item).attributes.sentiment, undefined);
    // approving the registry proposal registers the key
    const r2 = approveProposal(agentDir, filed[0].id);
    assert.ok(r2.ok);
    assert.ok(loadRegistry(agentDir).attributes.has('sentiment'));
  });
});

// ── inbox + review (through the real binary) ───────────────────────────────

test('inbox: plain-text candidates become ER-verdicted proposals; files consumed', () => {
  withHome((agentDir) => {
    writeFileSync(join(agentDir, 'knowledge', 'inbox', 'a.md'), 'Agents drop one fact per file here');
    const r = processInbox(agentDir);
    assert.equal(r.processed, 1);
    assert.equal(r.proposals[0].source, 'agent'); // provenance label (who proposed), not a path
    assert.equal(r.proposals[0].er.verdict, 'new');
    assert.ok(!existsSync(join(agentDir, 'knowledge', 'inbox', 'a.md')));
  });
});

test('home review (piped): approve / reject / EOF-quit through the real binary', () => {
  withHome((agentDir, projectDir) => {
    writeFileSync(join(agentDir, 'knowledge', 'inbox', 'one.md'), 'First durable fact about alpha systems');
    writeFileSync(join(agentDir, 'knowledge', 'inbox', 'two.md'), 'Second durable fact about beta systems');
    const r = spawnSync(process.execPath, [BIN, 'review'], { cwd: projectDir, input: 'y\nn\nweak\n', encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /1 approved · 1 rejected/);
    // EOF with pending proposals → graceful quit
    writeFileSync(join(agentDir, 'knowledge', 'inbox', 'three.md'), 'Third fact arrives later');
    const r2 = spawnSync(process.execPath, [BIN, 'review'], { cwd: projectDir, input: '', encoding: 'utf8' });
    assert.equal(r2.status, 0);
    assert.match(r2.stdout, /left/);
  });
});
