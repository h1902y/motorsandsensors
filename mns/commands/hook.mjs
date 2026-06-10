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
import { join, dirname } from 'node:path';
import { byName } from '../../experiments/experiment-1-trace-capture/adapters/registry.mjs';
import { captureTrace } from '../capture-core.mjs';
import { SessionState } from '../session.mjs';
import { openLive, touchLive, closeLive } from '../live/live-store.mjs';
import { loadRules, evaluate, toPreToolUseDecision, toGeminiDecision } from '../guardrails.mjs';
import { paths } from '../store.mjs';
import { computeDigest } from '../digest.mjs';

// Lifecycle events, normalized across hosts (verified by observing each host):
//   open  — session starts
//   turn  — agent finished a response turn (per-turn "still alive"); re-capture
//   end   — clean session end (rare: most hosts have none → staleness reconciles)
// Claude: SessionStart/Stop/SessionEnd · OpenCode: session.created/idle/deleted
// Gemini: SessionStart/AfterAgent/SessionEnd · Codex: SessionStart/UserPromptSubmit/Stop (no clean end)
const OPEN = new Set(['SessionStart', 'session.created']);
const TURN = new Set(['Stop', 'session.idle', 'AfterAgent', 'UserPromptSubmit']);
const END = new Set(['SessionEnd', 'session.deleted']);

/** Gemini's adapter reads logs.json filtered by sessionId; derive it from the
 *  hook's transcript_path (~/.gemini/tmp/<proj>/chats/session-*.json → ../../logs.json). */
export function geminiRef(payload = {}) {
  const tp = payload.transcript_path || '';
  const projDir = dirname(dirname(tp)); // .../chats/x.json → .../<proj>
  return { file: join(projDir, 'logs.json'), sessionId: payload.session_id };
}

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
  let ref;
  if (host === 'opencode') ref = id;                 // adapter reads its DB by id
  else if (host === 'gemini-cli') ref = geminiRef(payload);
  else ref = payload.transcript_path;                 // claude-code, codex: the transcript/rollout file
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

const GATE_EVENTS = new Set(['PreToolUse', 'BeforeTool']);

/**
 * Evaluate a tool call against rules.json and return the host's block decision
 * (or null = fail-open / no match → host's normal flow). Logs matched decisions.
 *   codex + claude-code → hookSpecificOutput · gemini-cli → {decision,reason}
 */
export function gateDecision({ host = 'claude-code', payload = {}, cwd = process.cwd() } = {}) {
  try {
    const { dir } = paths(cwd);
    const loaded = loadRules(join(dir, 'guardrails', 'rules.json'));
    if (!loaded.ok) return null;
    const verdict = evaluate(loaded.rules, { tool: payload.tool_name, input: payload.tool_input });
    if (verdict) {
      try {
        const liveDir = join(dir, 'live');
        mkdirSync(liveDir, { recursive: true });
        appendFileSync(
          join(liveDir, `guardrails-${payload.session_id || 'unknown'}.jsonl`),
          JSON.stringify({ at: new Date().toISOString(), host, tool: payload.tool_name, ...verdict }) + '\n',
        );
      } catch { /* logging must not affect the gate */ }
    }
    return host === 'gemini-cli' ? toGeminiDecision(verdict) : toPreToolUseDecision(verdict);
  } catch {
    return null; // fail open
  }
}

/**
 * Build Claude Code's SessionStart additionalContext payload from the faculty
 * digest. Returns null on ANY failure (fail-open: the session proceeds with no
 * injected context, never a broken hook).
 * @param {string} cwd  repo cwd; paths() resolves the .mns home under it
 */
export function sessionStartContext(cwd = process.cwd()) {
  try {
    const mnsDir = paths(cwd).dir;
    const { text } = computeDigest(mnsDir);
    if (!text || !text.trim()) return null;
    return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } };
  } catch {
    return null;
  }
}

/**
 * CLI entry. Claude hooks pipe a JSON payload on stdin; OpenCode's plugin passes
 * `--host opencode --session <id>` (no stdin). Always exits 0 (never break the agent).
 */
export function runHook(event, { host = 'claude-code', session } = {}) {
  let payload = {};
  if (host === 'opencode') {
    payload = { session_id: session };
  } else {
    // claude-code, gemini-cli, codex all pipe a JSON payload on fd 0
    try {
      // fd 0, not '/dev/stdin' — the device-path form breaks for piped stdin on
      // Linux (CI caught this; macOS masked it).
      payload = JSON.parse(readFileSync(0, 'utf8'));
    } catch {
      /* no/garbage stdin */
    }
  }
  try {
    if (GATE_EVENTS.has(event)) {
      const decision = gateDecision({ host, payload });
      if (decision) process.stdout.write(JSON.stringify(decision));
    } else {
      try { handleHook({ event, payload, host }); } catch { /* capture failure is silent — never blocks the digest or the host */ }
      if (event === 'SessionStart') {
        try {
          const ctx = sessionStartContext();
          if (ctx) process.stdout.write(JSON.stringify(ctx));
        } catch { /* digest failure is silent (fail-open) */ }
      }
    }
  } catch {
    /* never break the agent */
  }
  process.exit(0);
}
