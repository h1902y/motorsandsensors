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

import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { byName } from '../../experiments/experiment-1-trace-capture/adapters/registry.mjs';
import { captureTrace } from '../capture-core.mjs';
import { SessionState } from '../session.mjs';
import { openLive, touchLive, closeLive } from '../live/live-store.mjs';
import { loadRules, evaluate, toPreToolUseDecision } from '../guardrails.mjs';
import { paths } from '../store.mjs';

// Lifecycle events, normalized across hosts (verified by observing each host):
//   open  — session starts
//   turn  — agent finished a response turn (per-turn "still alive"); re-capture
//   end   — clean session end (rare: most hosts have none → staleness reconciles)
// Claude: SessionStart / Stop / SessionEnd. OpenCode: session.created / session.idle
// / session.deleted (deleted is delete-only, so end is effectively staleness too).
const OPEN = new Set(['SessionStart', 'session.created']);
const TURN = new Set(['Stop', 'session.idle']);
const END = new Set(['SessionEnd', 'session.deleted']);

function safeCapture(adapter, ref, status, cwd) {
  if (!adapter || !ref) return;
  try {
    captureTrace({ adapter, ref, status, cwd });
  } catch {
    /* source not yet readable, etc. — never break the hook */
  }
}

/**
 * Core dispatch — host-agnostic. The capture `ref` is host-specific: Claude
 * re-parses the transcript file (`transcript_path`); OpenCode re-reads its
 * SQLite store keyed by `session_id`. Pure-ish (injected now/cwd) for tests.
 */
export function handleHook({ event, payload = {}, cwd = process.cwd(), now = Date.now(), host = 'claude-code' }) {
  const id = payload.session_id;
  if (!id) return { event, skipped: 'no session_id' };
  const ref = host === 'claude-code' ? payload.transcript_path : id; // opencode: sessionId → adapter reads its DB
  const adapter = byName(host);

  if (OPEN.has(event)) {
    openLive({ id, host, transcriptPath: ref, startedAt: new Date(now).toISOString(), now }, cwd);
    safeCapture(adapter, ref, SessionState.ACTIVE, cwd);
  } else if (TURN.has(event)) {
    touchLive({ id, host, transcriptPath: ref, now }, cwd);
    safeCapture(adapter, ref, SessionState.ACTIVE, cwd);
  } else if (END.has(event)) {
    safeCapture(adapter, ref, SessionState.COMPLETED, cwd);
    closeLive(id, cwd);
  } else {
    return { event, skipped: 'unhandled event' };
  }
  return { event, id, host };
}

/**
 * The Guardrails gate (PreToolUse). Evaluates the tool call against
 * .mns/guardrails/rules.json and prints Claude's hookSpecificOutput decision —
 * or NOTHING (exit 0, no JSON = defer to the host's normal permission flow).
 * That silence is the fail-open: engine errors and rule-file problems can slow
 * nothing down and block nothing. Matched decisions are logged for the trace.
 */
export function gateToolUse({ payload = {}, cwd = process.cwd() } = {}) {
  try {
    const { dir } = paths(cwd);
    const loaded = loadRules(join(dir, 'guardrails', 'rules.json'));
    if (!loaded.ok) return null; // missing/malformed rules → fail open
    const verdict = evaluate(loaded.rules, { tool: payload.tool_name, input: payload.tool_input });
    if (verdict) {
      try {
        const liveDir = join(dir, 'live');
        mkdirSync(liveDir, { recursive: true });
        appendFileSync(
          join(liveDir, `guardrails-${payload.session_id || 'unknown'}.jsonl`),
          JSON.stringify({ at: new Date().toISOString(), tool: payload.tool_name, ...verdict }) + '\n',
        );
      } catch {
        /* logging must not affect the gate */
      }
    }
    return toPreToolUseDecision(verdict);
  } catch {
    return null; // fail open, always
  }
}

/**
 * CLI entry. Claude hooks pipe a JSON payload on stdin; OpenCode's plugin passes
 * `--host opencode --session <id>` (no stdin). Always exits 0 (never break the agent).
 */
export function runHook(event, { host = 'claude-code', session } = {}) {
  let payload = {};
  if (host === 'claude-code') {
    try {
      payload = JSON.parse(readFileSync('/dev/stdin', 'utf8'));
    } catch {
      /* no/garbage stdin */
    }
  } else {
    payload = { session_id: session };
  }
  try {
    if (event === 'PreToolUse') {
      const decision = gateToolUse({ payload });
      if (decision) process.stdout.write(JSON.stringify(decision));
    } else {
      handleHook({ event, payload, host });
    }
  } catch {
    /* never break the agent */
  }
  process.exit(0);
}
