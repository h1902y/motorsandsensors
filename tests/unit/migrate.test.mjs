// tests/unit/migrate.test.mjs
// TDD: one-time proposal schema migrator — candidate→payload (WS2-T5)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { migrateProposals } from '../../zuzuu/commands/migrations/proposals.mjs';
import { migrateHome } from '../../zuzuu/commands/migrations/home.mjs';
import { readProposal } from '../../zuzuu/faculty/proposal.mjs';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function withHome(fn) {
  const root = mkdtempSync(join(tmpdir(), 'zuzuu-migrate-'));
  const agentDir = join(root, '.zuzuu');
  mkdirSync(join(agentDir, 'knowledge', 'proposals', 'archive'), { recursive: true });
  try {
    return fn(agentDir);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function withTempRepo(fn) {
  const root = mkdtempSync(join(tmpdir(), 'zuzuu-mig-home-'));
  try { return fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

// seed a legitimate zuzuu home at agent/ (the pre-2026-06-12 layout)
function seedLegacyHome(root) {
  mkdirSync(join(root, 'agent', '.traces'), { recursive: true });
  mkdirSync(join(root, 'agent', 'knowledge'), { recursive: true });
  writeFileSync(join(root, 'agent', 'agent.json'), '{"version":3}\n');
  writeFileSync(join(root, 'agent', '.traces', 'claude-code-a.otlp.jsonl'), '{}\n');
  writeFileSync(
    join(root, 'agent', 'sessions.json'),
    JSON.stringify({ version: 1, sessions: [{ id: 'a', host: 'claude-code', traceRef: 'agent/.traces/claude-code-a.otlp.jsonl' }] }, null, 2) + '\n',
  );
}

// ---------------------------------------------------------------------------
// migrateHome — agent/ → .zuzuu/ (W1, 2026-06-12)
// ---------------------------------------------------------------------------
test('migrateHome moves agent/ → .zuzuu/, rewrites gitignore + traceRefs; idempotent', () => {
  withTempRepo((root) => {
    seedLegacyHome(root);
    writeFileSync(join(root, '.gitignore'), 'agent/.traces/\nagent/.live/\nagent/knowledge/.index.db\nnode_modules/\n');

    const r1 = migrateHome(root);
    assert.equal(r1.migrated, true);
    assert.ok(existsSync(join(root, '.zuzuu', 'agent.json')), 'home moved to .zuzuu/');
    assert.ok(existsSync(join(root, '.zuzuu', '.traces', 'claude-code-a.otlp.jsonl')), 'inner layout byte-identical');
    assert.ok(!existsSync(join(root, 'agent')), 'old agent/ gone');

    const gi = readFileSync(join(root, '.gitignore'), 'utf8');
    assert.ok(gi.includes('.zuzuu/.traces/') && !gi.includes('agent/.traces/'), 'gitignore rewritten');
    assert.ok(gi.includes('node_modules/'), 'user gitignore lines preserved');

    const idx = JSON.parse(readFileSync(join(root, '.zuzuu', 'sessions.json'), 'utf8'));
    assert.equal(idx.sessions[0].traceRef, '.zuzuu/.traces/claude-code-a.otlp.jsonl', 'traceRef rewritten');

    assert.equal(migrateHome(root).migrated, false, 'idempotent second run');
  });
});

test('migrateHome never clobbers an existing .zuzuu/', () => {
  withTempRepo((root) => {
    seedLegacyHome(root);
    mkdirSync(join(root, '.zuzuu'), { recursive: true });
    assert.equal(migrateHome(root).migrated, false);
    assert.ok(existsSync(join(root, 'agent', 'agent.json')), 'legacy left untouched when .zuzuu/ present');
  });
});

test('migrateHome does NOT touch an unrelated agent/ dir (no agent.json)', () => {
  withTempRepo((root) => {
    mkdirSync(join(root, 'agent', 'src'), { recursive: true });
    writeFileSync(join(root, 'agent', 'src', 'index.ts'), 'export {}\n');
    assert.equal(migrateHome(root).migrated, false);
    assert.ok(existsSync(join(root, 'agent', 'src', 'index.ts')), 'user agent/ dir untouched');
    assert.ok(!existsSync(join(root, '.zuzuu')), 'no .zuzuu created');
  });
});

test('migrateHome scrubs legacy deny rules from .claude settings, keeps user rules', () => {
  withTempRepo((root) => {
    seedLegacyHome(root);
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(
      join(root, '.claude', 'settings.json'),
      JSON.stringify({ permissions: { deny: ['Read(./agent/.traces/**)', 'Read(./agent/.live/**)', 'Read(./secrets/**)'] } }, null, 2) + '\n',
    );

    migrateHome(root);

    const s = JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf8'));
    assert.ok(!s.permissions.deny.includes('Read(./agent/.traces/**)'), 'legacy deny gone');
    assert.ok(s.permissions.deny.includes('Read(./.zuzuu/.traces/**)'), 'new deny present');
    assert.ok(s.permissions.deny.includes('Read(./.zuzuu/.live/**)'), 'new live deny present');
    assert.ok(s.permissions.deny.includes('Read(./secrets/**)'), 'user deny preserved');
  });
});

test('migrateHome drops the derived knowledge index (rebuilds on next recall)', () => {
  withTempRepo((root) => {
    seedLegacyHome(root);
    writeFileSync(join(root, 'agent', 'knowledge', '.index.db'), 'derived');
    migrateHome(root);
    assert.ok(!existsSync(join(root, '.zuzuu', 'knowledge', '.index.db')), 'derived index dropped');
    assert.ok(existsSync(join(root, '.zuzuu', 'knowledge')), 'knowledge dir intact');
  });
});

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
  withHome((agentDir) => {
    const proposalsPath = join(agentDir, 'knowledge', 'proposals');
    writeFileSync(join(proposalsPath, 'x-1.json'), JSON.stringify(LEGACY, null, 2) + '\n');

    const result = migrateProposals(agentDir);

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
  withHome((agentDir) => {
    const proposalsPath = join(agentDir, 'knowledge', 'proposals');
    writeFileSync(join(proposalsPath, 'x-1.json'), JSON.stringify(LEGACY, null, 2) + '\n');

    // first run
    migrateProposals(agentDir);
    const afterFirst = readFileSync(join(proposalsPath, 'x-1.json'), 'utf8');

    // second run
    const result2 = migrateProposals(agentDir);
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
  withHome((agentDir) => {
    const archivePath = join(agentDir, 'knowledge', 'proposals', 'archive');
    const legacyArchived = { ...LEGACY, status: 'rejected', resolved_at: '2026-01-01T00:00:00.000Z', reason: 'dup' };
    writeFileSync(join(archivePath, 'x-1.json'), JSON.stringify(legacyArchived, null, 2) + '\n');

    const result = migrateProposals(agentDir);

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
  withHome((agentDir) => {
    const proposalsPath = join(agentDir, 'knowledge', 'proposals');
    writeFileSync(join(proposalsPath, 'corrupt.json'), '{ this is NOT valid json ,,, }');
    writeFileSync(join(proposalsPath, 'x-1.json'), JSON.stringify(LEGACY, null, 2) + '\n');

    let result;
    assert.doesNotThrow(() => {
      result = migrateProposals(agentDir);
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
  withHome((agentDir) => {
    const proposalsPath = join(agentDir, 'knowledge', 'proposals');
    writeFileSync(join(proposalsPath, 'x-1.json'), JSON.stringify(LEGACY, null, 2) + '\n');

    migrateProposals(agentDir);

    const rec = readProposal(agentDir, 'knowledge', 'x-1');
    assert.ok(rec, 'record readable');
    assert.equal(rec.id, 'x-1');
    assert.equal(rec.faculty, 'knowledge');
    assert.deepEqual(rec.payload, { id: 'x', type: 'fact', body: 'b' });
    assert.deepEqual(rec.analysis, { er: { verdict: 'new' } });
    assert.equal(rec.candidate, undefined, 'no legacy candidate key on normalised record');
  });
});
