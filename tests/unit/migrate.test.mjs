// tests/unit/migrate.test.mjs
// TDD: one-time proposal schema migrator — candidate→payload (WS2-T5)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { migrateProposals, migrateHome } from '../../zuzuu/commands/migrate.mjs';
import { readProposal } from '../../zuzuu/faculty/proposal.mjs';

function withTempRepo(fn) {
  const root = mkdtempSync(join(tmpdir(), 'mns-mig-'));
  try { return fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('migrateHome renames .mns→agent, dot-prefixes internals, rewrites gitignore; idempotent', () => {
  withTempRepo((root) => {
    mkdirSync(join(root, '.mns', 'traces'), { recursive: true });
    mkdirSync(join(root, '.mns', 'live'), { recursive: true });
    mkdirSync(join(root, '.mns', 'knowledge'), { recursive: true });
    writeFileSync(join(root, '.mns', 'mns.json'), '{"version":2}\n');
    writeFileSync(join(root, '.mns', 'knowledge', 'index.db'), 'x');
    writeFileSync(join(root, '.gitignore'), '.mns/traces/\n.mns/live/\n.mns/knowledge/index.db\nnode_modules/\n');

    const r1 = migrateHome(root);
    assert.equal(r1.migrated, true);
    assert.ok(existsSync(join(root, 'agent', 'agent.json')), 'mns.json → agent.json');
    assert.ok(existsSync(join(root, 'agent', '.traces')), 'traces → .traces');
    assert.ok(existsSync(join(root, 'agent', '.live')), 'live → .live');
    assert.ok(existsSync(join(root, 'agent', 'knowledge', '.index.db')), 'index.db → .index.db');
    assert.ok(!existsSync(join(root, '.mns')), 'legacy .mns gone');
    const gi = readFileSync(join(root, '.gitignore'), 'utf8');
    assert.ok(gi.includes('agent/.traces/') && !gi.includes('.mns/'), 'gitignore rewritten');
    assert.ok(gi.includes('node_modules/'), 'user gitignore lines preserved');

    assert.equal(migrateHome(root).migrated, false, 'idempotent second run');
  });
});

test('migrateHome no-ops when agent/ already exists (never clobbers)', () => {
  withTempRepo((root) => {
    mkdirSync(join(root, 'agent'), { recursive: true });
    mkdirSync(join(root, '.mns'), { recursive: true });
    assert.equal(migrateHome(root).migrated, false);
    assert.ok(existsSync(join(root, '.mns')), 'legacy left untouched when agent/ present');
  });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function withHome(fn) {
  const root = mkdtempSync(join(tmpdir(), 'mns-migrate-'));
  const mnsDir = join(root, '.mns');
  mkdirSync(join(mnsDir, 'knowledge', 'proposals', 'archive'), { recursive: true });
  try {
    return fn(mnsDir);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const LEGACY = {
  id: 'x-1',
  kind: 'item',
  status: 'pending',
  candidate: { id: 'x', type: 'fact', body: 'b' },
  er: { verdict: 'new' },
};

// ---------------------------------------------------------------------------
// 1. Legacy proposal in proposals/ is migrated
// ---------------------------------------------------------------------------
test('migrateProposals: legacy candidate/er → payload/analysis.er, faculty set', () => {
  withHome((mnsDir) => {
    const proposalsPath = join(mnsDir, 'knowledge', 'proposals');
    writeFileSync(join(proposalsPath, 'x-1.json'), JSON.stringify(LEGACY, null, 2) + '\n');

    const result = migrateProposals(mnsDir);

    assert.equal(result.scanned, 1, 'scanned 1 file');
    assert.equal(result.migrated, 1, 'migrated 1 file');
    assert.equal(result.skipped, 0, 'skipped 0');

    const raw = JSON.parse(readFileSync(join(proposalsPath, 'x-1.json'), 'utf8'));

    // new keys present
    assert.deepEqual(raw.payload, { id: 'x', type: 'fact', body: 'b' }, 'payload = candidate');
    assert.deepEqual(raw.analysis, { er: { verdict: 'new' } }, 'analysis.er = er');
    assert.equal(raw.faculty, 'knowledge', 'faculty set');

    // legacy keys removed
    assert.equal(raw.candidate, undefined, 'candidate removed');
    assert.equal(raw.er, undefined, 'er removed');

    // preserved fields
    assert.equal(raw.id, 'x-1');
    assert.equal(raw.kind, 'item');
    assert.equal(raw.status, 'pending');
  });
});

// ---------------------------------------------------------------------------
// 2. Idempotent — running again leaves the file unchanged, migrated=0
// ---------------------------------------------------------------------------
test('migrateProposals is idempotent on already-migrated records', () => {
  withHome((mnsDir) => {
    const proposalsPath = join(mnsDir, 'knowledge', 'proposals');
    writeFileSync(join(proposalsPath, 'x-1.json'), JSON.stringify(LEGACY, null, 2) + '\n');

    // first run
    migrateProposals(mnsDir);
    const afterFirst = readFileSync(join(proposalsPath, 'x-1.json'), 'utf8');

    // second run
    const result2 = migrateProposals(mnsDir);
    const afterSecond = readFileSync(join(proposalsPath, 'x-1.json'), 'utf8');

    assert.equal(result2.migrated, 0, 'migrated=0 on second run');
    assert.equal(result2.skipped, 1, 'skipped=1 (already new shape)');
    assert.equal(afterFirst, afterSecond, 'file content unchanged');
  });
});

// ---------------------------------------------------------------------------
// 3. Legacy record in proposals/archive/ is also migrated
// ---------------------------------------------------------------------------
test('migrateProposals migrates records in proposals/archive/', () => {
  withHome((mnsDir) => {
    const archivePath = join(mnsDir, 'knowledge', 'proposals', 'archive');
    const legacyArchived = { ...LEGACY, status: 'rejected', resolved_at: '2026-01-01T00:00:00.000Z', reason: 'dup' };
    writeFileSync(join(archivePath, 'x-1.json'), JSON.stringify(legacyArchived, null, 2) + '\n');

    const result = migrateProposals(mnsDir);

    assert.equal(result.migrated, 1, 'archive record migrated');

    const raw = JSON.parse(readFileSync(join(archivePath, 'x-1.json'), 'utf8'));
    assert.deepEqual(raw.payload, { id: 'x', type: 'fact', body: 'b' });
    assert.deepEqual(raw.analysis, { er: { verdict: 'new' } });
    assert.equal(raw.faculty, 'knowledge');
    assert.equal(raw.candidate, undefined);
    assert.equal(raw.er, undefined);
    // preserved resolved fields
    assert.equal(raw.status, 'rejected');
    assert.equal(raw.resolved_at, '2026-01-01T00:00:00.000Z');
    assert.equal(raw.reason, 'dup');
  });
});

// ---------------------------------------------------------------------------
// 4. Garbage/bad JSON is skipped without throwing
// ---------------------------------------------------------------------------
test('migrateProposals skips unreadable/garbage JSON files without throwing', () => {
  withHome((mnsDir) => {
    const proposalsPath = join(mnsDir, 'knowledge', 'proposals');
    writeFileSync(join(proposalsPath, 'corrupt.json'), '{ this is NOT valid json ,,, }');
    writeFileSync(join(proposalsPath, 'x-1.json'), JSON.stringify(LEGACY, null, 2) + '\n');

    let result;
    assert.doesNotThrow(() => {
      result = migrateProposals(mnsDir);
    });

    assert.equal(result.scanned, 2, 'scanned 2 (including corrupt)');
    assert.equal(result.migrated, 1, 'migrated 1 valid');
    assert.equal(result.skipped, 1, 'skipped 1 corrupt');
  });
});

// ---------------------------------------------------------------------------
// 5. readProposal returns a coherent record after migration
// ---------------------------------------------------------------------------
test('readProposal returns a coherent record after migration', () => {
  withHome((mnsDir) => {
    const proposalsPath = join(mnsDir, 'knowledge', 'proposals');
    writeFileSync(join(proposalsPath, 'x-1.json'), JSON.stringify(LEGACY, null, 2) + '\n');

    migrateProposals(mnsDir);

    const rec = readProposal(mnsDir, 'knowledge', 'x-1');
    assert.ok(rec, 'record readable');
    assert.equal(rec.id, 'x-1');
    assert.equal(rec.faculty, 'knowledge');
    assert.deepEqual(rec.payload, { id: 'x', type: 'fact', body: 'b' });
    assert.deepEqual(rec.analysis, { er: { verdict: 'new' } });
    assert.equal(rec.candidate, undefined, 'no legacy candidate key on normalised record');
  });
});
