// tests/unit/json-outputs.test.mjs
// The --json outputs the zuzuu-web daemon consumes (status/inbox/generation/digest).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { statusData } from '../../zuzuu/commands/status.mjs';
import { inboxData } from '../../zuzuu/commands/inbox.mjs';
import { moduleGenerationsData, moduleGenerationShowData } from '../../zuzuu/commands/module.mjs';
import { checkpointListData } from '../../zuzuu/commands/checkpoint.mjs';
import { evalData } from '../../zuzuu/commands/eval.mjs';
import { proposalsListData, approveData, rejectData } from '../../zuzuu/commands/proposals.mjs';
import { serializeEnvelope } from '../../zuzuu/module/envelope.mjs';

const actionMd = (slug, snippet) => serializeEnvelope({
  id: slug, module: 'actions', kind: 'script', title: slug, status: 'active',
  created_at: '2026-06-12T00:00:00Z', payload: { exec: 'run.mjs' }, body: snippet,
});
import { actInboxData, actApproveData, actRejectData } from '../../zuzuu/commands/act.mjs';
import { mintModuleGeneration } from '../../zuzuu/module/generation/write.mjs';
import { mintCheckpoint } from '../../zuzuu/module/generation/checkpoint.mjs';
import { writeProposal, makeProposal } from '../../zuzuu/module/proposal.mjs';
import { processInbox } from '../../zuzuu/knowledge/inbox.mjs';
import { digestData } from '../../zuzuu/commands/digest.mjs';
import { SEED_TYPES, SEED_ATTRIBUTES, SEED_RELATIONS } from '../../zuzuu/knowledge/registry.mjs';

function withHome(fn) {
  const root = mkdtempSync(join(tmpdir(), 'zjson-'));
  const dir = join(root, '.zuzuu');
  mkdirSync(join(dir, 'knowledge', 'proposals'), { recursive: true });
  try { return fn(dir); } finally { rmSync(root, { recursive: true, force: true }); }
}

/** withHome variant that also seeds the knowledge registry (needed for approve). */
function withKnowledgeHome(fn) {
  const root = mkdtempSync(join(tmpdir(), 'zjson-kh-'));
  const dir = join(root, '.zuzuu');
  const reg = join(dir, 'knowledge', 'registry');
  mkdirSync(reg, { recursive: true });
  mkdirSync(join(dir, 'knowledge', 'inbox'), { recursive: true });
  writeFileSync(join(reg, 'types.json'), JSON.stringify(SEED_TYPES));
  writeFileSync(join(reg, 'attributes.json'), JSON.stringify(SEED_ATTRIBUTES));
  writeFileSync(join(reg, 'relations.json'), JSON.stringify(SEED_RELATIONS));
  try { return fn(dir, root); } finally { rmSync(root, { recursive: true, force: true }); }
}

/** Scaffold an action inbox entry for act helper tests. */
function withActHome(slug, fn) {
  const root = mkdtempSync(join(tmpdir(), 'zjson-act-'));
  const home = join(root, '.zuzuu');
  const dir = join(home, 'actions', 'inbox', slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'ACTION.md'), actionMd(slug, 'do the thing'));
  writeFileSync(join(dir, 'run.mjs'), 'export async function main(){ return { ok: true }; }');
  try { return fn(home); } finally { rmSync(root, { recursive: true, force: true }); }
}

// ── Task 5: statusData now includes hosts ────────────────────────────────────

test('statusData reports home, per-module generations, pending map, drift, checkpoints', () => {
  withHome((dir) => {
    const d = statusData(dir, { hosts: [] });
    assert.equal(d.home, true);
    assert.equal(typeof d.generations, 'object');     // per-module actives
    assert.equal(d.generations.knowledge, null);      // none minted
    assert.equal(d.checkpoints, 0);
    assert.equal(typeof d.pending, 'object');
    assert.equal(d.pending.knowledge, 0);
    assert.equal(d.drift.dirty, false);
  });
});

test('statusData includes hosts array in output', () => {
  withHome((dir) => {
    const d = statusData(dir, { hosts: [{ name: 'claude-code' }] });
    assert.ok(Array.isArray(d.hosts), 'hosts is an array');
    assert.equal(d.hosts[0].name, 'claude-code');
  });
});

test('statusData hosts defaults to an array when no second arg provided', () => {
  withHome((dir) => {
    // default: detected() is called — may return [] or real entries, but must be array
    const d = statusData(dir);
    assert.ok(Array.isArray(d.hosts), 'hosts is present and is an array');
  });
});

// ── Task 1: evalData ─────────────────────────────────────────────────────────

test('evalData returns ranked array with required keys for a seeded proposal', () => {
  withHome((dir) => {
    // seed a pending knowledge proposal
    writeFileSync(
      join(dir, 'knowledge', 'proposals', 'kp1.json'),
      JSON.stringify({
        id: 'kp1',
        module: 'knowledge',
        kind: 'item',
        status: 'pending',
        source: 'session-abc',
        candidate: {
          id: 'kp1',
          type: 'fact',
          body: 'use node:sqlite for local storage',
          attributes: {},
          relations: [],
          provenance: [],
        },
        er: { verdict: 'new', confidence: 0.9, reason: 'first observation', match: null },
        evidence: { occurrences: 2 },
        provenance: [{ sessionId: 'session-abc' }],
      }),
    );
    const d = evalData(dir);
    assert.ok(d && typeof d === 'object', 'evalData returns an object');
    assert.ok(Array.isArray(d.ranked), 'ranked is an array');
    assert.ok(d.ranked.length > 0, 'ranked has entries');
    const first = d.ranked[0];
    assert.ok('id' in first, 'has id');
    assert.ok('module' in first, 'has module');
    assert.ok('title' in first, 'has title');
    assert.ok('score' in first, 'has score');
    assert.ok('confidence' in first, 'has confidence');
    assert.ok('rationale' in first, 'has rationale');
    assert.equal(first.id, 'kp1');
    assert.equal(first.module, 'knowledge');
  });
});

test('evalData returns empty ranked array when no proposals', () => {
  withHome((dir) => {
    const d = evalData(dir);
    assert.ok(d && typeof d === 'object');
    assert.ok(Array.isArray(d.ranked));
    assert.equal(d.ranked.length, 0);
  });
});

// ── Task 2: proposals list/approve/reject --json ──────────────────────────────

test('proposalsListData returns {pending:[{id,module,title}]}', () => {
  withHome((dir) => {
    const p = makeProposal({
      module: 'knowledge', kind: 'item', source: 'sess1',
      payload: { id: 'kfact', type: 'fact', body: 'zero-deps policy', attributes: {}, relations: [] },
    });
    writeProposal(dir, p);
    const d = proposalsListData(dir, 'knowledge');
    assert.ok(Array.isArray(d.pending), 'pending is array');
    assert.ok(d.pending.length > 0, 'has pending items');
    const item = d.pending[0];
    assert.ok('id' in item, 'has id');
    assert.ok('module' in item, 'has module');
    assert.ok('title' in item, 'has title');
    assert.equal(item.module, 'knowledge');
  });
});

test('proposalsListData returns empty pending when no proposals', () => {
  withHome((dir) => {
    const d = proposalsListData(dir);
    assert.ok(Array.isArray(d.pending));
    assert.equal(d.pending.length, 0);
  });
});

// ── Finding 1: proposals list --json promotes inbox candidates ────────────────

test('proposalsListData is pure (no side-effects), but json list path promotes inbox first', () => {
  withKnowledgeHome((dir) => {
    // seed a plain-text inbox candidate
    writeFileSync(join(dir, 'knowledge', 'inbox', 'x.md'), 'Node 22 has native sqlite support via node:sqlite');
    // proposalsListData itself does NOT call processInbox (it's pure)
    const before = proposalsListData(dir);
    assert.equal(before.pending.length, 0, 'pure helper sees nothing before promotion');
    // simulate what the --json list branch does: processInbox then proposalsListData
    processInbox(dir);
    const after = proposalsListData(dir);
    assert.ok(after.pending.length > 0, 'candidate appears after promotion');
    assert.equal(after.pending[0].module, 'knowledge');
    assert.ok(!existsSync(join(dir, 'knowledge', 'inbox', 'x.md')), 'inbox file consumed');
  });
});

// ── Finding 2a: proposals approve/reject --json via single-source helpers ─────

test('approveResultData: approve a seeded knowledge proposal → {ok,action,...}', () => {
  withKnowledgeHome((dir) => {
    // seed a proposal via processInbox so it's fully ER-resolved
    writeFileSync(join(dir, 'knowledge', 'inbox', 'y.md'), 'Zero runtime dependencies is a deliberate policy');
    processInbox(dir);
    const listed = proposalsListData(dir);
    assert.ok(listed.pending.length > 0, 'proposal exists');
    const { id, module } = listed.pending[0];
    const r = approveData(dir, id, module);
    assert.equal(r.ok, true, 'ok is true');
    assert.ok('action' in r, 'has action');
    // JSON-serialisable
    const parsed = JSON.parse(JSON.stringify(r));
    assert.equal(parsed.ok, true);
  });
});

test('rejectResultData: reject a seeded knowledge proposal → {ok,id}', () => {
  withKnowledgeHome((dir) => {
    writeFileSync(join(dir, 'knowledge', 'inbox', 'z.md'), 'Golden ids come from real runs not hand-computed');
    processInbox(dir);
    const listed = proposalsListData(dir);
    assert.ok(listed.pending.length > 0, 'proposal exists');
    const { id, module } = listed.pending[0];
    const r = rejectData(dir, id, module, 'test-reason');
    assert.equal(r.ok, true, 'ok is true');
    assert.equal(r.id, id, 'id echoed');
    // JSON-serialisable
    const parsed = JSON.parse(JSON.stringify(r));
    assert.equal(parsed.ok, true);
    assert.equal(parsed.id, id);
  });
});

// ── Finding 2b: act inbox/approve/reject via single-source helpers ────────────

test('actInboxData: {pending:[{slug,...}]} from a seeded inbox action', () => {
  withActHome('do-thing', (home) => {
    const result = actInboxData(home);
    assert.ok(Array.isArray(result.pending), 'pending is array');
    assert.ok(result.pending.length > 0, 'has pending items');
    assert.ok('slug' in result.pending[0], 'has slug');
    assert.equal(result.pending[0].slug, 'do-thing');
    // JSON-serialisable
    const parsed = JSON.parse(JSON.stringify(result));
    assert.equal(parsed.pending[0].slug, 'do-thing');
  });
});

test('actApproveData: activate a seeded inbox action → {ok:true, action, slug}', () => {
  withActHome('my-action', (home) => {
    const result = actApproveData(home, 'my-action');
    assert.equal(result.ok, true);
    assert.ok('action' in result, 'has action');
    assert.equal(result.slug, 'my-action');
    assert.match(result.action, /activated my-action/);
    // JSON-serialisable
    const parsed = JSON.parse(JSON.stringify(result));
    assert.equal(parsed.ok, true);
    assert.equal(parsed.slug, 'my-action');
  });
});

test('actRejectData: reject a seeded inbox action → {ok:true, action, slug}', () => {
  withActHome('bad-action', (home) => {
    const result = actRejectData(home, 'bad-action');
    assert.equal(result.ok, true);
    assert.ok('action' in result, 'has action');
    assert.equal(result.slug, 'bad-action');
    assert.match(result.action, /rejected bad-action/);
    // JSON-serialisable
    const parsed = JSON.parse(JSON.stringify(result));
    assert.equal(parsed.ok, true);
    assert.equal(parsed.slug, 'bad-action');
  });
});

// ── Per-module generation + checkpoint --json data ───────────────────────────

test('mintModuleGeneration returns a per-module lockfile {id,module,mintedFrom,items}', () => {
  withHome((dir) => {
    const lf = mintModuleGeneration(dir, 'knowledge', { mintedFrom: ['p1', 'p2'] });
    assert.match(lf.id, /^gen_/, 'id matches gen_ pattern');
    assert.equal(lf.module, 'knowledge');
    assert.deepEqual(lf.mintedFrom, ['p1', 'p2']);
    assert.ok(Array.isArray(lf.items), 'items is array');
    assert.ok('forkedFrom' in lf, 'has forkedFrom');
  });
});

test('moduleGenerationsData returns {module,active,generations}', () => {
  withHome((dir) => {
    const lf = mintModuleGeneration(dir, 'knowledge', { mintedFrom: [] });
    const d = moduleGenerationsData(dir, 'knowledge');
    assert.equal(d.module, 'knowledge');
    assert.equal(d.active, lf.id);
    assert.equal(d.generations[0].id, lf.id);
  });
});

test('moduleGenerationShowData returns the diff; unknown id → null', () => {
  withHome((dir) => {
    const lf = mintModuleGeneration(dir, 'knowledge', { mintedFrom: [] });
    const show = moduleGenerationShowData(dir, 'knowledge', lf.id);
    assert.equal(show.id, lf.id);
    assert.equal(show.module, 'knowledge');
    assert.ok(Array.isArray(show.added));
    assert.equal(moduleGenerationShowData(dir, 'knowledge', 'gen_999'), null);
  });
});

test('checkpointListData returns checkpoints pinning per-module actives', () => {
  withHome((dir) => {
    mintModuleGeneration(dir, 'knowledge', { mintedFrom: [] });
    const cp = mintCheckpoint(dir, { label: 'x' });
    const d = checkpointListData(dir);
    assert.equal(d.checkpoints.length, 1);
    assert.equal(d.checkpoints[0].id, cp.id);
    assert.equal(d.checkpoints[0].pins.knowledge, 'gen_001');
  });
});

// ── pre-existing tests (unchanged) ───────────────────────────────────────────

test('inboxData lists pending proposals with module + title + total', () => {
  withHome((dir) => {
    writeFileSync(join(dir, 'knowledge', 'proposals', 'p1.json'),
      JSON.stringify({ id: 'p1', kind: 'item', status: 'pending',
        candidate: { id: 'p1', type: 'fact', body: 'use node:sqlite', attributes: {}, relations: [], provenance: [] } }));
    const d = inboxData(dir);
    assert.equal(d.total, 1);
    assert.equal(d.pending[0].module, 'knowledge');
    assert.equal(d.pending[0].id, 'p1');
    assert.match(d.pending[0].title, /node:sqlite/);
  });
});

test('digestData returns { text }', () => {
  withHome((dir) => {
    const d = digestData(dir);
    assert.equal(typeof d.text, 'string');
  });
});
