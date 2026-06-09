// Reconcile lost sessions. A killed terminal sends no SessionEnd, so an `active`
// live record just stops getting heartbeats. We detect that lazily (on `mns
// doctor`/`status`), and — because the transcript is still on disk — do a FULL,
// correct capture of the abandoned session before closing it. Nothing is lost.

import { listLive, isStale, closeLive } from './live-store.mjs';
import { byName } from '../../experiments/experiment-1-trace-capture/adapters/registry.mjs';
import { captureTrace } from '../capture-core.mjs';
import { SessionState } from '../session.mjs';

export const DEFAULT_STALE_MS = 15 * 60 * 1000; // 15 min without a heartbeat → abandoned

/**
 * Close out stale live sessions as `abandoned` (full transcript capture).
 * @returns {Array<{id, host, action}>} what was reconciled
 */
export function reconcile({ now = Date.now(), thresholdMs = DEFAULT_STALE_MS, cwd = process.cwd() } = {}) {
  const actions = [];
  for (const rec of listLive(cwd)) {
    if (!isStale(rec, now, thresholdMs)) continue;
    const adapter = byName(rec.host);
    if (adapter && rec.transcriptPath) {
      try {
        captureTrace({ adapter, ref: rec.transcriptPath, status: SessionState.ABANDONED, cwd });
      } catch {
        /* transcript gone/unreadable — still close the record below */
      }
    }
    closeLive(rec.id, cwd);
    actions.push({ id: rec.id, host: rec.host, action: 'abandoned' });
  }
  return actions;
}
