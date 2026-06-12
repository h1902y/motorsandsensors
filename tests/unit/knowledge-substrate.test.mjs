import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRegistry, validateItem, validateAttribute, SEED_TYPES, SEED_ATTRIBUTES, SEED_RELATIONS } from '../../zuzuu/knowledge/registry.mjs';
import { parseItem, serializeItem, writeItem, readItem, slugify } from '../../zuzuu/knowledge/items.mjs';
import { reindex, search, neighbors, upsertItem, putVector, allVectors } from '../../zuzuu/knowledge/index.mjs';
import { cosine } from '../../zuzuu/knowledge/embed.mjs';

function withHome(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'zuzuu-know-'));
  const agentDir = join(dir, '.zuzuu');
  const reg = join(agentDir, 'knowledge', 'registry');
  mkdirSync(reg, { recursive: true });
  writeFileSync(join(reg, 'types.json'), JSON.stringify(SEED_TYPES));
  writeFileSync(join(reg, 'attributes.json'), JSON.stringify(SEED_ATTRIBUTES));
  writeFileSync(join(reg, 'relations.json'), JSON.stringify(SEED_RELATIONS));
  try {
    return fn(agentDir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const ITEM = {
  id: 'test-command',
  type: 'command',
  created_at: '2026-06-10T12:00:00Z',
  status: 'active',
  attributes: { command: 'npm test', domain: 'testing' },
  relations: [{ type: 'relates-to', target: 'ci-pipeline', commentary: 'runs there' }],
  provenance: [{ session: 'ses_1', ref: 'occurrences=3' }],
  body: 'The test suite runs with npm test.',
};

test('item round-trip: parse(serialize(x)) preserves everything', () => {
  const round = parseItem(serializeItem(ITEM));
  assert.deepEqual(round, ITEM);
});

test('parseItem rejects grammar violations', () => {
  assert.throws(() => parseItem('no frontmatter'), /no frontmatter/);
  assert.throws(() => parseItem('---\ntype: fact\n---\n'), /missing id/);
  assert.throws(() => parseItem('---\nid: x\ntype: fact\n  rogue: indent\n---\n'), /unexpected indented/);
});

test('slugify produces stable kebab ids', () => {
  assert.equal(slugify("This project's test suite!"), 'this-project-s-test-suite');
  assert.equal(slugify('   '), 'item');
});

test('registry validation: types, attribute value kinds, unknown keys surfaced separately', () => {
  withHome((agentDir) => {
    const reg = loadRegistry(agentDir);
    assert.ok(reg.ok);
    const good = validateItem(reg, ITEM);
    assert.ok(good.ok);
    assert.deepEqual(good.unknownKeys, { attributes: [], relations: [] });

    const bad = validateItem(reg, { ...ITEM, type: 'vibe', attributes: { decided_on: 'not-a-date', mystery: 'x' } });
    assert.ok(!bad.ok);
    assert.ok(bad.errors.some((e) => e.includes('unregistered type')));
    assert.ok(bad.errors.some((e) => e.includes('not an ISO date')));
    assert.deepEqual(bad.unknownKeys.attributes, ['mystery']);

    assert.ok(validateAttribute({ key: 's', value: { enum: ['a', 'b'] } }, 'b').ok);
    assert.ok(!validateAttribute({ key: 's', value: { enum: ['a', 'b'] } }, 'c').ok);
    assert.ok(validateAttribute({ key: 'u', value: 'url' }, 'https://x.dev').ok);
    assert.ok(!validateAttribute({ key: 'n', value: 'number' }, 'NaNish').ok);
  });
});

test('index: reindex is deterministic; lexical scoring ranks id > attr > body', () => {
  withHome((agentDir) => {
    writeItem(agentDir, ITEM);
    writeItem(agentDir, { id: 'ci-pipeline', type: 'fact', created_at: ITEM.created_at, status: 'active', attributes: {}, relations: [], provenance: [], body: 'CI runs the test matrix on Node 22 and 24.' });
    const r1 = reindex(agentDir);
    assert.equal(r1.indexed, 2);
    assert.equal(r1.parseErrors.length, 0);
    const hits = search(agentDir, 'test');
    assert.equal(hits[0].id, 'test-command', 'id match outranks body match');
    assert.ok(hits[0].score > hits[1].score);
    // type + attribute filters (relational search)
    assert.equal(search(agentDir, 'test', { type: 'fact' })[0].id, 'ci-pipeline');
    assert.equal(search(agentDir, '', { attr: ['command', 'npm test'] })[0].id, 'test-command');
    // reindex twice → same results
    reindex(agentDir);
    assert.deepEqual(search(agentDir, 'test').map((h) => h.id), hits.map((h) => h.id));
  });
});

test('graph: neighbors walks both directions, honors relType and depth', () => {
  withHome((agentDir) => {
    writeItem(agentDir, ITEM); // test-command -relates-to-> ci-pipeline
    writeItem(agentDir, { id: 'ci-pipeline', type: 'fact', created_at: ITEM.created_at, status: 'active', attributes: {}, relations: [{ type: 'depends-on', target: 'node-22' }], provenance: [], body: 'ci' });
    writeItem(agentDir, { id: 'node-22', type: 'entity', created_at: ITEM.created_at, status: 'active', attributes: {}, relations: [], provenance: [], body: 'node 22' });
    reindex(agentDir);
    const one = neighbors(agentDir, 'test-command', { depth: 1 });
    assert.deepEqual(one.map((n) => n.node), ['ci-pipeline']);
    const two = neighbors(agentDir, 'test-command', { depth: 2 }).map((n) => n.node).sort();
    assert.deepEqual(two, ['ci-pipeline', 'node-22']);
    // reverse direction: node-22's neighborhood reaches back
    const rev = neighbors(agentDir, 'node-22', { depth: 2 }).map((n) => n.node).sort();
    assert.deepEqual(rev, ['ci-pipeline', 'test-command']);
    // relType filter
    const dep = neighbors(agentDir, 'ci-pipeline', { relType: 'depends-on', depth: 1 }).map((n) => n.node);
    assert.deepEqual(dep, ['node-22']);
  });
});

test('vectors: put/get round-trip; cosine sane; reindex prunes orphans but keeps live vectors', () => {
  withHome((agentDir) => {
    writeItem(agentDir, ITEM);
    reindex(agentDir);
    putVector(agentDir, 'test-command', 'test-model', [1, 0, 0]);
    const vecs = allVectors(agentDir);
    assert.equal(vecs.length, 1);
    assert.equal(cosine(vecs[0].vec, new Float32Array([1, 0, 0])), 1);
    assert.ok(cosine([1, 0], [0, 1]) === 0);
    reindex(agentDir); // item still exists → vector survives
    assert.equal(allVectors(agentDir).length, 1);
    rmSync(join(agentDir, 'knowledge', 'items', 'test-command.md'));
    reindex(agentDir); // item gone → vector pruned
    assert.equal(allVectors(agentDir).length, 0);
  });
});
