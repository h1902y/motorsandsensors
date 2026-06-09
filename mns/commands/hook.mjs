// `mns hook <Event>` — the callback Claude Code invokes on lifecycle hooks.
//
// Design B: the hook is a lifecycle SIGNAL + re-capture TRIGGER, never a span
// builder. Each relevant event re-parses the transcript through the proven
// capture path (idempotent, deterministic ids) and advances the live record.
//
//   SessionStart -> open live record (active) + capture
//   Stop         -> heartbeat + re-capture (status active)   [fires per turn]
//   SessionEnd   -> capture (status completed) + close live record
//
// MUST always exit 0 and never block — a throwing hook would disrupt the agent
// session. `runHook` wraps everything; failures degrade silently.

import { readFileSync } from 'node:fs';
import { byName } from '../../experiments/experiment-1-trace-capture/adapters/registry.mjs';
import { captureTrace } from '../capture-core.mjs';
import { SessionState } from '../session.mjs';
import { openLive, touchLive, closeLive } from '../live/live-store.mjs';

const HOST = 'claude-code'; // these hooks are installed into Claude Code

function safeCapture(adapter, ref, status, cwd) {
  if (!adapter || !ref) return;
  try {
    captureTrace({ adapter, ref, status, cwd });
  } catch {
    /* transcript not yet readable, etc. — never break the hook */
  }
}

/**
 * Core dispatch. Pure-ish (takes payload + injected now/cwd) so tests can drive
 * it without real stdin or a live agent.
 */
export function handleHook({ event, payload = {}, cwd = process.cwd(), now = Date.now() }) {
  const id = payload.session_id;
  const transcriptPath = payload.transcript_path;
  if (!id) return { event, skipped: 'no session_id' };
  const adapter = byName(HOST);

  switch (event) {
    case 'SessionStart':
      openLive({ id, host: HOST, transcriptPath, startedAt: new Date(now).toISOString(), now }, cwd);
      safeCapture(adapter, transcriptPath, SessionState.ACTIVE, cwd);
      break;
    case 'Stop':
      touchLive({ id, host: HOST, transcriptPath, now }, cwd);
      safeCapture(adapter, transcriptPath, SessionState.ACTIVE, cwd);
      break;
    case 'SessionEnd':
      safeCapture(adapter, transcriptPath, SessionState.COMPLETED, cwd);
      closeLive(id, cwd);
      break;
    default:
      return { event, skipped: 'unhandled event' };
  }
  return { event, id };
}

/** stdin entry used by the CLI. Reads the hook payload, dispatches, exits 0. */
export function runHook(event) {
  let payload = {};
  try {
    payload = JSON.parse(readFileSync('/dev/stdin', 'utf8'));
  } catch {
    /* no/garbage stdin — still exit 0 */
  }
  try {
    handleHook({ event, payload });
  } catch {
    /* never break the agent */
  }
  process.exit(0);
}
