// Codex CLI adapter — parses ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl.
//
// Built against REAL wire data (a captured `codex exec` session), not docs —
// the docs warn the serialization differs from source. Confirmed shapes:
//   { timestamp, type, payload }  per line
//   type "session_meta"   → payload { id, cwd, ... }            (the session id)
//   type "turn_context"   → payload { model, cwd }
//   type "event_msg"      → payload { type: task_started | user_message | agent_message | token_count | task_complete, message? }
//   type "response_item"  → payload { type: "message"|"function_call"|"function_call_output", ... }
//        message          → { role: developer|user|assistant, content:[{type,text}] }
//        function_call    → { name, call_id, arguments(JSON string) }
//        function_call_output → { call_id, output }  (linked FLAT by call_id)
//
// Turns come from event_msg/user_message (clean prompt text — avoids the injected
// <environment_context>/developer messages). Tool spans pair function_call ↔
// function_call_output by call_id, giving real durations. Rich, like Claude.

import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { event, trace, EventKind, Status } from '../core/event.mjs';

const SESSIONS_DIR = join(homedir(), '.codex', 'sessions');
const ms = (iso) => (iso ? Date.parse(iso) : NaN);
const clean = (s) => String(s).replace(/\s+/g, ' ').trim();
const truncate = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function readJsonl(file) {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export const codex = {
  name: 'codex',

  detect() {
    return existsSync(SESSIONS_DIR);
  },

  listSessions() {
    if (!existsSync(SESSIONS_DIR)) return [];
    return readdirSync(SESSIONS_DIR, { recursive: true })
      .filter((f) => typeof f === 'string' && /rollout-.*\.jsonl$/.test(f))
      .map((f) => {
        const path = join(SESSIONS_DIR, f);
        const m = f.match(/rollout-.*-([0-9a-f-]{36})\.jsonl$/i);
        return { sessionId: m ? m[1] : f, ref: path, label: 'codex', mtime: statSync(path).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
  },

  parse(ref) {
    const file = typeof ref === 'string' ? ref : ref.ref;
    const rows = readJsonl(file);

    let sessionId = '';
    const meta = { startMs: Infinity, endMs: -Infinity, model: '', cwd: '' };

    // Pass 1: index function_call_output by call_id (end time + size).
    const results = new Map();
    for (const r of rows) {
      const p = r.payload || {};
      if (r.type === 'response_item' && p.type === 'function_call_output') {
        const out = typeof p.output === 'string' ? p.output : JSON.stringify(p.output ?? '');
        results.set(p.call_id, { endMs: ms(r.timestamp), bytes: out.length });
      }
    }

    // Pass 2: walk in order; turns from user_message, tools from function_call.
    const events = [];
    const turnEnd = new Map();
    let currentTurn = null;
    let turnIdx = 0;

    for (const r of rows) {
      const p = r.payload || {};
      const t = ms(r.timestamp);
      if (Number.isFinite(t)) {
        meta.startMs = Math.min(meta.startMs, t);
        meta.endMs = Math.max(meta.endMs, t);
      }
      if (r.type === 'session_meta') sessionId ||= p.id || '';
      if (r.type === 'session_meta' || r.type === 'turn_context') meta.cwd ||= p.cwd || '';
      if (r.type === 'turn_context') meta.model ||= p.model || '';

      if (r.type === 'event_msg' && p.type === 'user_message') {
        const text = clean(p.message || '');
        const refId = `${sessionId || 'codex'}:turn:${turnIdx++}`;
        currentTurn = refId;
        events.push(
          event({
            kind: EventKind.TURN,
            refId,
            parentRefId: sessionId || 'session',
            name: 'turn: ' + (truncate(text, 60) || '(empty)'),
            startMs: Number.isFinite(t) ? t : meta.startMs,
            endMs: Number.isFinite(t) ? t : meta.startMs,
            attributes: { 'turn.prompt.bytes': text.length },
          }),
        );
      }

      if (r.type === 'response_item' && p.type === 'function_call') {
        const res = results.get(p.call_id) || {};
        const startMs = Number.isFinite(t) ? t : meta.startMs;
        const endMs = Number.isFinite(res.endMs) ? res.endMs : startMs;
        const args = typeof p.arguments === 'string' ? p.arguments : JSON.stringify(p.arguments ?? {});
        const parent = currentTurn || sessionId || 'session';
        events.push(
          event({
            kind: EventKind.TOOL_CALL,
            refId: p.call_id || `${sessionId}:call:${events.length}`,
            parentRefId: parent,
            name: p.name || 'tool',
            startMs,
            endMs,
            status: Status.OK, // Codex output carries no explicit error flag (see CONCLUSIONS)
            attributes: {
              'gen_ai.operation.name': 'execute_tool',
              'gen_ai.tool.name': p.name || '',
              'host.tool.name': p.name || '',
              'tool.input.bytes': args.length,
              'tool.result.bytes': res.bytes ?? 0,
            },
          }),
        );
        turnEnd.set(parent, Math.max(turnEnd.get(parent) ?? 0, endMs));
      }
    }

    sessionId ||= (file.match(/([0-9a-f-]{36})\.jsonl$/i) || [])[1] || file.split('/').pop();
    if (!Number.isFinite(meta.startMs)) meta.startMs = 0;
    if (!Number.isFinite(meta.endMs)) meta.endMs = meta.startMs;

    for (const e of events) {
      if (e.kind === EventKind.TURN && turnEnd.has(e.refId)) e.endMs = Math.max(e.endMs, turnEnd.get(e.refId));
    }

    events.unshift(
      event({
        kind: EventKind.SESSION,
        refId: sessionId,
        parentRefId: null,
        name: `session ${String(sessionId).slice(0, 8)} (codex)`,
        startMs: meta.startMs,
        endMs: meta.endMs,
        attributes: { 'host.name': 'codex', 'host.session.model': meta.model, 'host.cwd': meta.cwd },
      }),
    );

    return trace({ host: 'codex', sessionId: String(sessionId), title: meta.cwd, events });
  },
};
