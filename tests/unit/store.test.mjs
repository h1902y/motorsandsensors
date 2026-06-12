import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeTrace, upsertSession, readIndex, lastTrace, resolveTrace, paths, homeDir, liveDir } from '../../zuzuu/store.mjs';
import { makeSession } from '../../zuzuu/session.mjs';

// Hermetic: operate in a temp dir outside the repo (not a git repo → git info null).
function withTempRepo(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'zuzuu-store-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const sampleRequest = { resourceSpans: [{ resource: { attributes: [] }, scopeSpans: [{ scope: { name: 's' }, spans: [] }] }] };

test('homeDir prefers .zuzuu/ when present', () => {
  withTempRepo((cwd) => { mkdirSync(join(cwd, '.zuzuu'), { recursive: true }); assert.equal(homeDir(cwd), join(cwd, '.zuzuu')); });
});
test('homeDir defaults to .zuzuu/ for a fresh project', () => {
  withTempRepo((cwd) => assert.equal(homeDir(cwd), join(cwd, '.zuzuu')));
});
test('paths exposes .traces + liveDir is .live', () => {
  withTempRepo((cwd) => {
    assert.ok(paths(cwd).tracesDir.endsWith(join('.zuzuu', '.traces')));
    assert.equal(liveDir(paths(cwd).dir), join(cwd, '.zuzuu', '.live'));
  });
});

test('writeTrace writes a gitignored-path blob and returns a repo-relative ref', () => {
  withTempRepo((cwd) => {
    const ref = writeTrace('claude-code', 'sess1', [sampleRequest], cwd);
    assert.equal(ref, join('.zuzuu', '.traces', 'claude-code-sess1.otlp.jsonl'));
    assert.ok(existsSync(resolveTrace(ref, cwd)));
  });
});

test('upsertSession persists to the index and replaces by id (no duplicates)', () => {
  withTempRepo((cwd) => {
    const rec = makeSession({ id: 's1', host: 'claude-code', startedAt: '2026-06-09T10:00:00.000Z', endedAt: '2026-06-09T10:01:00.000Z' });
    upsertSession(rec, cwd);
    assert.equal(readIndex(cwd).sessions.length, 1);
    // re-capture same id → replace, not append
    upsertSession({ ...rec, counts: { turns: 1, tools: 2, errors: 0 } }, cwd);
    const idx = readIndex(cwd);
    assert.equal(idx.sessions.length, 1);
    assert.equal(idx.sessions[0].counts.tools, 2);
  });
});

test('readIndex returns an empty index when none exists', () => {
  withTempRepo((cwd) => {
    const idx = readIndex(cwd);
    assert.deepEqual(idx.sessions, []);
    assert.ok(idx.version >= 1);
  });
});

test('lastTrace finds the most recent blob; paths() roots at the given cwd', () => {
  withTempRepo((cwd) => {
    assert.equal(lastTrace(cwd), null);
    writeTrace('gemini-cli', 'g1', [sampleRequest], cwd);
    assert.ok(lastTrace(cwd).endsWith('gemini-cli-g1.otlp.jsonl'));
    assert.ok(paths(cwd).dir.startsWith(cwd));
  });
});

test('upsertSession round-trips generation field in the index (WS3-T3)', () => {
  withTempRepo((cwd) => {
    const rec = makeSession({
      id: 'sess-gen',
      host: 'claude-code',
      generation: 'gen_007',
      startedAt: '2026-06-09T10:00:00.000Z',
      endedAt: '2026-06-09T10:01:00.000Z',
    });
    upsertSession(rec, cwd);
    const stored = readIndex(cwd).sessions.find((s) => s.id === 'sess-gen');
    assert.ok(stored, 'session should be in index');
    assert.equal(stored.generation, 'gen_007', 'generation should round-trip through the index');
  });
});
