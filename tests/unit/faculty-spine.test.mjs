// tests/unit/faculty-spine.test.mjs
// TDD: shared faculty spine — proposal/provenance/trail/registry (WS2-T1)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FACULTIES, facultyDir, inboxDir, proposalsDir, archiveDir } from '../../zuzuu/faculty/contract.mjs';
import { proposalId, makeProposal, writeProposal, readProposal, listProposals, archiveProposal } from '../../zuzuu/faculty/proposal.mjs';
import { prov, mergeProvenance } from '../../zuzuu/faculty/provenance.mjs';
import { recordTrail } from '../../zuzuu/faculty/trail.mjs';
import { register, get as getAdapter, all as allAdapters } from '../../zuzuu/faculty/registry.mjs';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function withHome(fn) {
  const root = mkdtempSync(join(tmpdir(), 'mns-faculty-'));
  mkdirSync(join(root, '.mns'), { recursive: true });
  try {
    return fn(join(root, '.mns'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// contract.mjs
// ---------------------------------------------------------------------------
test('FACULTIES lists all five faculty names', () => {
  assert.deepEqual(FACULTIES, ['knowledge', 'memory', 'actions', 'instructions', 'guardrails']);
});

test('contract path helpers return expected sub-paths', () => {
  const mns = '/tmp/.mns';
  assert.equal(facultyDir(mns, 'knowledge'), '/tmp/.mns/knowledge');
  assert.equal(inboxDir(mns, 'knowledge'), '/tmp/.mns/knowledge/inbox');
  assert.equal(proposalsDir(mns, 'knowledge'), '/tmp/.mns/knowledge/proposals');
  assert.equal(archiveDir(mns, 'knowledge'), '/tmp/.mns/knowledge/proposals/archive');
});

// ---------------------------------------------------------------------------
// proposal.mjs — basic round-trip
// ---------------------------------------------------------------------------
test('makeProposal produces a well-formed pending record', () => {
  const p = makeProposal({
    faculty: 'knowledge',
    kind: 'item',
    source: 'session-abc',
    payload: { id: 'alpha', body: 'Alpha fact' },
    analysis: { er: { verdict: 'new' } },
    evidence: { hits: 2 },
    provenance: [{ session: 's1', ref: 'r1' }],
  });
  assert.equal(p.status, 'pending');
  assert.equal(p.faculty, 'knowledge');
  assert.equal(p.kind, 'item');
  assert.equal(p.source, 'session-abc');
  assert.ok(p.id, 'has id');
  assert.ok(p.created_at, 'has created_at');
  assert.deepEqual(p.payload, { id: 'alpha', body: 'Alpha fact' });
  assert.deepEqual(p.analysis, { er: { verdict: 'new' } });
  assert.deepEqual(p.evidence, { hits: 2 });
  assert.deepEqual(p.provenance, [{ session: 's1', ref: 'r1' }]);
});

test('writeProposal → listProposals returns the proposal; readProposal round-trips', () => {
  withHome((mns) => {
    const p = makeProposal({
      faculty: 'knowledge',
      kind: 'item',
      source: 'test-source',
      payload: { id: 'beta', body: 'Beta fact' },
    });
    writeProposal(mns, p);

    const list = listProposals(mns, 'knowledge');
    assert.equal(list.length, 1);
    assert.equal(list[0].id, p.id);
    assert.ok(list[0].payload, 'list entry has payload');

    const read = readProposal(mns, 'knowledge', p.id);
    assert.ok(read, 'readProposal returns the record');
    assert.equal(read.id, p.id);
    assert.deepEqual(read.payload, p.payload);
    assert.deepEqual(read.analysis, p.analysis);
    assert.deepEqual(read.provenance, p.provenance);
    assert.equal(read.faculty, 'knowledge');
  });
});

test('readProposal returns null for a missing file', () => {
  withHome((mns) => {
    const result = readProposal(mns, 'knowledge', 'nonexistent-id');
    assert.equal(result, null);
  });
});

// ---------------------------------------------------------------------------
// proposal.mjs — dual-read (legacy migration)
// ---------------------------------------------------------------------------
test('dual-read: legacy {candidate, er} is normalized to {payload, analysis.er}', () => {
  withHome((mns) => {
    const faculty = 'knowledge';
    const dir = join(mns, faculty, 'proposals');
    mkdirSync(dir, { recursive: true });
    const legacy = {
      id: 'legacy-fact-abc123',
      kind: 'item',
      status: 'pending',
      created_at: new Date().toISOString(),
      source: 'old-session',
      candidate: { id: 'legacy-fact', body: 'old format fact' },
      evidence: { hits: 1 },
      er: { verdict: 'new' },
    };
    writeFileSync(join(dir, `${legacy.id}.json`), JSON.stringify(legacy, null, 2) + '\n');

    // readProposal normalizes it
    const r = readProposal(mns, faculty, legacy.id);
    assert.ok(r, 'returns a record');
    assert.deepEqual(r.payload, legacy.candidate, 'candidate → payload');
    assert.deepEqual(r.analysis, { er: legacy.er }, 'er → analysis.er');
    assert.equal(r.faculty, faculty, 'faculty is set');

    // listProposals also normalizes
    const list = listProposals(mns, faculty);
    assert.equal(list.length, 1);
    assert.deepEqual(list[0].payload, legacy.candidate);
    assert.deepEqual(list[0].analysis, { er: legacy.er });
  });
});

test('dual-read: legacy with both candidate AND payload keeps payload', () => {
  withHome((mns) => {
    const faculty = 'knowledge';
    const dir = join(mns, faculty, 'proposals');
    mkdirSync(dir, { recursive: true });
    const mixed = {
      id: 'mixed-abc123',
      kind: 'item',
      status: 'pending',
      created_at: new Date().toISOString(),
      source: 'old-session',
      candidate: { id: 'old', body: 'old' },
      payload: { id: 'new', body: 'new format' },
      evidence: {},
    };
    writeFileSync(join(dir, `${mixed.id}.json`), JSON.stringify(mixed, null, 2) + '\n');
    const r = readProposal(mns, faculty, mixed.id);
    // payload already present — should remain
    assert.deepEqual(r.payload, { id: 'new', body: 'new format' });
  });
});

// ---------------------------------------------------------------------------
// proposal.mjs — archiveProposal
// ---------------------------------------------------------------------------
test('archiveProposal moves record to archive/ with status + resolved_at', () => {
  withHome((mns) => {
    const faculty = 'knowledge';
    const p = makeProposal({
      faculty,
      kind: 'item',
      source: 'test',
      payload: { id: 'gamma', body: 'Gamma' },
    });
    writeProposal(mns, p);

    // confirm it is in pending
    assert.equal(listProposals(mns, faculty).length, 1);

    const resolved = archiveProposal(mns, faculty, p.id, {
      status: 'approved',
      reason: 'looks good',
      applied: 'created gamma',
    });

    assert.equal(resolved.status, 'approved');
    assert.ok(resolved.resolved_at, 'resolved_at set');
    assert.equal(resolved.reason, 'looks good');
    assert.equal(resolved.applied, 'created gamma');

    // pending list is now empty
    assert.equal(listProposals(mns, faculty).length, 0);

    // archive file exists
    const archPath = join(mns, faculty, 'proposals', 'archive', `${p.id}.json`);
    assert.ok(existsSync(archPath), 'archive file present');

    const archived = JSON.parse(readFileSync(archPath, 'utf8'));
    assert.equal(archived.status, 'approved');
  });
});

test('archiveProposal with status rejected', () => {
  withHome((mns) => {
    const faculty = 'memory';
    const p = makeProposal({ faculty, kind: 'item', source: 's', payload: { id: 'x' } });
    writeProposal(mns, p);
    const resolved = archiveProposal(mns, faculty, p.id, { status: 'rejected', reason: 'dupe' });
    assert.equal(resolved.status, 'rejected');
    assert.equal(listProposals(mns, faculty).length, 0);
  });
});

// ---------------------------------------------------------------------------
// proposal.mjs — proposalId determinism
// ---------------------------------------------------------------------------
test('proposalId is deterministic for the same inputs', () => {
  const id1 = proposalId('my-slug', 'source-x');
  const id2 = proposalId('my-slug', 'source-x');
  assert.equal(id1, id2);
});

test('proposalId differs for different slug or source', () => {
  const a = proposalId('slug-a', 'source-x');
  const b = proposalId('slug-b', 'source-x');
  const c = proposalId('slug-a', 'source-y');
  assert.notEqual(a, b);
  assert.notEqual(a, c);
});

test('proposalId follows <slug>-<6-char-hex> format', () => {
  const id = proposalId('my-fact', 'session-1');
  assert.match(id, /^my-fact-[0-9a-f]{6}$/, 'id has slug-XXXXXX format');
});

// ---------------------------------------------------------------------------
// provenance.mjs
// ---------------------------------------------------------------------------
test('prov drops undefined keys', () => {
  const p = prov({ session: 's1', trace: undefined, ref: 'r1' });
  assert.ok(!('trace' in p), 'trace key dropped');
  assert.equal(p.session, 's1');
  assert.equal(p.ref, 'r1');
});

test('prov includes all defined keys', () => {
  const p = prov({ session: 's1', trace: 't1', ref: 'r1' });
  assert.deepEqual(p, { session: 's1', trace: 't1', ref: 'r1' });
});

test('mergeProvenance concatenates and deduplicates by session|ref', () => {
  const a = [{ session: 's1', ref: 'r1' }, { session: 's2', ref: 'r2' }];
  const b = [{ session: 's1', ref: 'r1' }, { session: 's3', ref: 'r3' }];
  const merged = mergeProvenance(a, b);
  assert.equal(merged.length, 3);
  // dedup: s1|r1 appears once
  const keys = merged.map((p) => `${p.session}|${p.ref}`);
  assert.equal(new Set(keys).size, keys.length, 'no dupes');
});

test('mergeProvenance handles empty arrays', () => {
  assert.deepEqual(mergeProvenance([], [{ session: 's1', ref: 'r1' }]), [{ session: 's1', ref: 'r1' }]);
  assert.deepEqual(mergeProvenance([{ session: 's1', ref: 'r1' }], []), [{ session: 's1', ref: 'r1' }]);
  assert.deepEqual(mergeProvenance(), []);
});

// ---------------------------------------------------------------------------
// trail.mjs
// ---------------------------------------------------------------------------
test('recordTrail appends a JSONL line with at + entry fields', () => {
  withHome((mns) => {
    recordTrail(mns, 'knowledge', { action: 'proposal-created', id: 'abc' });
    recordTrail(mns, 'knowledge', { action: 'proposal-archived', id: 'abc', status: 'approved' });
    const path = join(mns, '.live', 'knowledge.jsonl');
    assert.ok(existsSync(path));
    const lines = readFileSync(path, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.length, 2);
    assert.ok(lines[0].at, 'has at timestamp');
    assert.equal(lines[0].action, 'proposal-created');
    assert.equal(lines[0].id, 'abc');
    assert.equal(lines[1].action, 'proposal-archived');
    assert.equal(lines[1].status, 'approved');
  });
});

test('recordTrail is fail-soft: a bad mnsDir never throws', () => {
  assert.doesNotThrow(() => recordTrail('/nonexistent/ /bad', 'knowledge', { action: 'x' }));
});

test('recordTrail uses the faculty name for the file (knowledge.jsonl vs actions.jsonl)', () => {
  withHome((mns) => {
    recordTrail(mns, 'actions', { action: 'run' });
    recordTrail(mns, 'guardrails', { action: 'denied' });
    assert.ok(existsSync(join(mns, '.live', 'actions.jsonl')));
    assert.ok(existsSync(join(mns, '.live', 'guardrails.jsonl')));
  });
});

// ---------------------------------------------------------------------------
// registry.mjs
// ---------------------------------------------------------------------------
test('register + get + all round-trip a dummy adapter', () => {
  const adapter = { name: 'x', version: '1.0' };
  register(adapter);
  assert.deepEqual(getAdapter('x'), adapter);
  assert.ok(allAdapters().some((a) => a.name === 'x'));
});

test('register overwrites a same-name adapter', () => {
  const v1 = { name: 'y', version: '1' };
  const v2 = { name: 'y', version: '2' };
  register(v1);
  register(v2);
  assert.equal(getAdapter('y').version, '2');
});

test('get returns undefined for an unregistered name', () => {
  assert.equal(getAdapter('does-not-exist-ever'), undefined);
});

test('all returns an array', () => {
  assert.ok(Array.isArray(allAdapters()));
});
