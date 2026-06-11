import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLive, touchLive, closeLive, listLive } from '../../zuzuu/live/live-store.mjs';

function withHome(fn) {
  const root = mkdtempSync(join(tmpdir(), 'mns-live-'));
  mkdirSync(join(root, '.mns'), { recursive: true });
  try { return fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('openLive with a path-like id (pi passes the session-file path) does not throw', () => {
  withHome((root) => {
    const id = '/Users/x/.pi/agent/sessions/--proj--/2026_abc.jsonl';
    assert.doesNotThrow(() => openLive({ id, host: 'pi', transcriptPath: id, startedAt: 'now', now: 1 }, root));
    const live = listLive(root);
    assert.equal(live.length, 1, 'record written under a sanitized filename');
    assert.equal(live[0].id, id, 'the real id is preserved inside the record');
  });
});

test('touch + close key by the same sanitized filename (no duplicates, removable)', () => {
  withHome((root) => {
    const id = '/Users/x/.pi/agent/sessions/--proj--/abc.jsonl';
    openLive({ id, host: 'pi', transcriptPath: id, startedAt: 'now', now: 1 }, root);
    touchLive({ id, host: 'pi', now: 2 }, root);
    assert.equal(listLive(root).length, 1, 'touch did not create a duplicate');
    closeLive(id, root);
    assert.equal(listLive(root).length, 0, 'closed by the same key');
  });
});

test('a clean id (Claude/OpenCode) still works unchanged', () => {
  withHome((root) => {
    openLive({ id: 'ses_x', host: 'claude-code', transcriptPath: '/t.jsonl', startedAt: 'now', now: 1 }, root);
    assert.equal(listLive(root)[0].id, 'ses_x');
  });
});
