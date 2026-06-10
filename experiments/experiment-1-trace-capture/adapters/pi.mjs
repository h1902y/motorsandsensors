// pi CLI adapter — parses ~/.pi/agent/sessions/<slug>/*.jsonl.
//
// Built against REAL wire data (a captured `pi` probe session), not docs.
// Confirmed shapes (one JSON object per line):
//   { type:"session", version:3, id, timestamp, cwd }      → the session header (line 1)
//   { type:"model_change", id, parentId, timestamp, provider, modelId }
//   { type:"thinking_level_change", id, parentId, timestamp, thinkingLevel }   (metadata)
//   { type:"message", id, parentId, timestamp, message:{ role, content:[…], … } }
//       role "user"       → content [{ type:"text", text }]            (the prompt → a TURN)
//       role "assistant"  → content [{ type:"thinking", … } | { type:"text", text }
//                                    | { type:"toolCall", id, name, arguments }]  (toolCall → a TOOL span)
//       role "toolResult" → { toolCallId, toolName, content:[{type:"text",text}], isError }
//
// Tool spans pair the assistant's content.toolCall to its toolResult message by
// toolCall.id === toolResult.message.toolCallId, giving real durations + an
// isError → Status.ERROR flag. Turns come from role:"user" messages (clean prompt).

import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { event, trace, EventKind, Status } from '../core/event.mjs';

const SESSIONS_DIR = join(homedir(), '.pi', 'agent', 'sessions');
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

// First [{type:"text"}] item's text, joined — pi content is an array of parts.
function textOf(content) {
  if (!Array.isArray(content)) return '';
  return content
    .filter((c) => c && c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join(' ');
}

export const pi = {
  name: 'pi',

  detect() {
    return existsSync(SESSIONS_DIR);
  },

  listSessions() {
    if (!existsSync(SESSIONS_DIR)) return [];
    return readdirSync(SESSIONS_DIR, { recursive: true })
      .filter((f) => typeof f === 'string' && /\.jsonl$/.test(f))
      .map((f) => {
        const path = join(SESSIONS_DIR, f);
        // filename: <iso>_<uuid>.jsonl — fall back to the uuid for the id.
        const m = f.match(/([0-9a-f-]{36})\.jsonl$/i);
        return { sessionId: m ? m[1] : f, ref: path, label: 'pi', mtime: statSync(path).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
  },

  parse(ref) {
    const file = typeof ref === 'string' ? ref : ref.ref;
    const rows = readJsonl(file);

    const header = rows.find((r) => r.type === 'session') || {};
    let sessionId = header.id || '';
    const meta = { startMs: Infinity, endMs: -Infinity, model: '', cwd: header.cwd || '' };

    // Pass 1: index toolResult messages by toolCallId (end time + size + error flag).
    const results = new Map();
    for (const r of rows) {
      if (r.type !== 'message') continue;
      const m = r.message || {};
      if (m.role === 'toolResult' && m.toolCallId) {
        const out = textOf(m.content);
        results.set(m.toolCallId, { endMs: ms(r.timestamp), bytes: out.length, isError: !!m.isError });
      }
    }

    // Pass 2: walk in order; turns from user messages, tools from assistant toolCalls.
    const events = [];
    const turnEnd = new Map();
    let currentTurn = null;
    let turnIdx = 0;

    for (const r of rows) {
      const t = ms(r.timestamp);
      if (Number.isFinite(t)) {
        meta.startMs = Math.min(meta.startMs, t);
        meta.endMs = Math.max(meta.endMs, t);
      }
      if (r.type === 'model_change') meta.model ||= r.modelId || '';
      if (r.type !== 'message') continue;

      const m = r.message || {};

      if (m.role === 'user') {
        const text = clean(textOf(m.content));
        const refId = r.id || `${sessionId || 'pi'}:turn:${turnIdx}`;
        currentTurn = refId;
        turnIdx++;
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

      if (m.role === 'assistant' && Array.isArray(m.content)) {
        for (const c of m.content) {
          if (!c || c.type !== 'toolCall') continue;
          const res = results.get(c.id) || {};
          const startMs = Number.isFinite(t) ? t : meta.startMs;
          const endMs = Number.isFinite(res.endMs) ? res.endMs : startMs;
          const args = typeof c.arguments === 'string' ? c.arguments : JSON.stringify(c.arguments ?? {});
          const parent = currentTurn || sessionId || 'session';
          events.push(
            event({
              kind: EventKind.TOOL_CALL,
              refId: c.id || `${sessionId}:call:${events.length}`,
              parentRefId: parent,
              name: 'tool: ' + (c.name || 'tool'),
              startMs,
              endMs,
              status: res.isError ? Status.ERROR : Status.OK,
              attributes: {
                'gen_ai.operation.name': 'execute_tool',
                'gen_ai.tool.name': c.name || '',
                'host.tool.name': c.name || '',
                'tool.input.bytes': args.length,
                'tool.result.bytes': res.bytes ?? 0,
              },
            }),
          );
          turnEnd.set(parent, Math.max(turnEnd.get(parent) ?? 0, endMs));
        }
      }
    }

    sessionId ||= (file.match(/([0-9a-f-]{36})\.jsonl$/i) || [])[1] || file.split('/').pop();
    if (!Number.isFinite(meta.startMs)) meta.startMs = ms(header.timestamp) || 0;
    if (!Number.isFinite(meta.endMs)) meta.endMs = meta.startMs;

    for (const e of events) {
      if (e.kind === EventKind.TURN && turnEnd.has(e.refId)) e.endMs = Math.max(e.endMs, turnEnd.get(e.refId));
    }

    events.unshift(
      event({
        kind: EventKind.SESSION,
        refId: sessionId,
        parentRefId: null,
        name: `session ${String(sessionId).slice(0, 8)} (pi)`,
        startMs: meta.startMs,
        endMs: meta.endMs,
        attributes: { 'host.name': 'pi', 'host.session.model': meta.model, 'host.cwd': meta.cwd },
      }),
    );

    return trace({ host: 'pi', sessionId: String(sessionId), title: meta.cwd, events });
  },
};
