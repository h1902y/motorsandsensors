import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleHook } from '../../zuzuu/commands/hook.mjs';
import { openLive, listLive } from '../../zuzuu/live/live-store.mjs';
import { reconcile } from '../../zuzuu/live/reconcile.mjs';
import { readIndex } from '../../zuzuu/store.mjs';
import { SessionState } from '../../zuzuu/session.mjs';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'claude-sample.jsonl');
// The fixture's session id (claude-code adapter derives this from the transcript).
const SID = 'sess-test';

function withTemp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'mns-live-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const payload = { session_id: SID, transcript_path: FIXTURE };
const findSid = (cwd) => readIndex(cwd).sessions.find((s) => s.id === SID);

test('lifecycle: SessionStart→Stop→SessionEnd drives active → completed', () => {
  withTemp((cwd) => {
    handleHook({ event: 'SessionStart', payload, cwd, now: 1000 });
    assert.equal(listLive(cwd).length, 1, 'a live record opened');
    assert.equal(findSid(cwd).status, SessionState.ACTIVE, 'index shows active after start');

    handleHook({ event: 'Stop', payload, cwd, now: 2000 });
    assert.equal(findSid(cwd).status, SessionState.ACTIVE, 'still active after a turn (Stop is per-turn)');

    handleHook({ event: 'SessionEnd', payload: { ...payload, reason: 'clear' }, cwd, now: 3000 });
    assert.equal(findSid(cwd).status, SessionState.COMPLETED, 'completed on SessionEnd');
    assert.equal(listLive(cwd).length, 0, 'live record closed');
  });
});

test('lost session: stale live record reconciles to abandoned (full capture from transcript)', () => {
  withTemp((cwd) => {
    // a session that started but never sent SessionEnd (terminal killed)
    openLive({ id: SID, host: 'claude-code', transcriptPath: FIXTURE, startedAt: new Date(1000).toISOString(), now: 1000 }, cwd);
    assert.equal(listLive(cwd).length, 1);

    const actions = reconcile({ now: 1000 + 60_000, thresholdMs: 1000, cwd });
    assert.equal(actions.length, 1);
    assert.equal(actions[0].action, 'abandoned');
    assert.equal(listLive(cwd).length, 0, 'live record cleared');
    assert.equal(findSid(cwd).status, SessionState.ABANDONED, 'captured as abandoned with full trace');
    assert.ok(findSid(cwd).counts.tools >= 1, 'the killed session’s tools were still captured from disk');
  });
});

test('reconcile leaves fresh (non-stale) sessions alone', () => {
  withTemp((cwd) => {
    openLive({ id: SID, host: 'claude-code', transcriptPath: FIXTURE, startedAt: new Date(1000).toISOString(), now: 1000 }, cwd);
    const actions = reconcile({ now: 1500, thresholdMs: 60_000, cwd });
    assert.equal(actions.length, 0);
    assert.equal(listLive(cwd).length, 1);
  });
});
