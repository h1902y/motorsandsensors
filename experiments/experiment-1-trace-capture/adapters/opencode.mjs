// OpenCode adapter — reads ~/.local/share/opencode/opencode.db (SQLite).
//
// Built against REAL wire data (a live `opencode run` session via the Google
// provider). Confirmed shapes (v1.16.2):
//   session row: { id, directory, title, model(JSON string), time_created, time_updated }
//   message row: { id, session_id, time_created, data:JSON{ role: user|assistant, time } }
//   part row:    { id, message_id, session_id, time_created, data:JSON{ type, ... } }
//     part.data.type ∈ text | tool | reasoning | step-start | step-finish
//       text → { text }                        (user prompt + assistant text live here)
//       tool → { tool, callID, state:{ status, input, output, time:{start,end}, metadata:{exit} } }
//
// node:sqlite is loaded LAZILY (createRequire) so importing this adapter never
// breaks the registry on Node <22 — only `opencode` commands touch SQLite.

import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { event, trace, EventKind, Status } from '../core/event.mjs';

const require = createRequire(import.meta.url);
const DB_PATH = join(homedir(), '.local', 'share', 'opencode', 'opencode.db');

const clean = (s) => String(s).replace(/\s+/g, ' ').trim();
const truncate = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const openDb = (path) => new (require('node:sqlite').DatabaseSync)(path, { readOnly: true });

/**
 * Pure normalization — host-agnostic, hermetically testable.
 * @param {object} t
 * @param {{id,directory,title,model,time_created,time_updated}} t.session
 * @param {Array<{id,role,time_created}>} t.messages
 * @param {Array<{messageId,time_created,type,text?,tool?,callID?,state?}>} t.parts
 */
export function buildTrace({ session, messages, parts }) {
  const sid = session.id;
  const events = [];

  const partsByMsg = new Map();
  for (const p of parts) {
    if (!partsByMsg.has(p.messageId)) partsByMsg.set(p.messageId, []);
    partsByMsg.get(p.messageId).push(p);
  }

  // Turns: one per user message; prompt text = its text parts.
  const turns = [];
  for (const m of messages.filter((m) => m.role === 'user').sort((a, b) => a.time_created - b.time_created)) {
    const text = (partsByMsg.get(m.id) || []).filter((p) => p.type === 'text').map((p) => p.text || '').join(' ');
    turns.push({ refId: m.id, start: m.time_created });
    events.push(
      event({
        kind: EventKind.TURN,
        refId: m.id,
        parentRefId: sid,
        name: 'turn: ' + (truncate(clean(text), 60) || '(empty)'),
        startMs: m.time_created,
        endMs: m.time_created,
        attributes: { 'turn.prompt.bytes': text.length },
      }),
    );
  }

  // Tool spans: from tool parts, paired durations via state.time.{start,end}.
  const turnEnd = new Map();
  for (const p of parts.filter((p) => p.type === 'tool').sort((a, b) => (a.state?.time?.start || 0) - (b.state?.time?.start || 0))) {
    const st = p.state || {};
    const startMs = st.time?.start || p.time_created || session.time_created;
    const endMs = st.time?.end || startMs;
    let parent = sid;
    for (const t of turns) if (t.start <= startMs) parent = t.refId; // most recent user turn
    const input = JSON.stringify(st.input ?? {});
    const output = typeof st.output === 'string' ? st.output : JSON.stringify(st.output ?? '');
    events.push(
      event({
        kind: EventKind.TOOL_CALL,
        refId: p.callID || `${sid}:call:${events.length}`,
        parentRefId: parent,
        name: p.tool || 'tool',
        startMs,
        endMs,
        status: st.status === 'error' ? Status.ERROR : Status.OK,
        attributes: {
          'gen_ai.operation.name': 'execute_tool',
          'gen_ai.tool.name': p.tool || '',
          'host.tool.name': p.tool || '',
          'tool.input.bytes': input.length,
          'tool.result.bytes': output.length,
        },
      }),
    );
    turnEnd.set(parent, Math.max(turnEnd.get(parent) ?? 0, endMs));
  }

  for (const e of events) if (e.kind === EventKind.TURN && turnEnd.has(e.refId)) e.endMs = Math.max(e.endMs, turnEnd.get(e.refId));

  const ends = events.map((e) => e.endMs);
  const startMs = session.time_created || Math.min(...turns.map((t) => t.start), session.time_updated || 0);
  const endMs = Math.max(session.time_updated || 0, startMs, ...ends);

  let model = '';
  try {
    const m = typeof session.model === 'string' ? JSON.parse(session.model) : session.model;
    if (m) model = `${m.providerID || ''}/${m.id || m.modelID || ''}`;
  } catch {
    /* model stays '' */
  }

  events.unshift(
    event({
      kind: EventKind.SESSION,
      refId: sid,
      parentRefId: null,
      name: `session ${String(sid).slice(0, 12)} (opencode)`,
      startMs,
      endMs,
      attributes: { 'host.name': 'opencode', 'host.session.model': model, 'host.cwd': session.directory || '' },
    }),
  );

  return trace({ host: 'opencode', sessionId: sid, title: session.title || '', events });
}

export const opencode = {
  name: 'opencode',

  detect() {
    return existsSync(DB_PATH);
  },

  listSessions() {
    if (!existsSync(DB_PATH)) return [];
    const db = openDb(DB_PATH);
    try {
      return db
        .prepare('SELECT id, title, time_updated FROM session ORDER BY time_updated DESC')
        .all()
        .map((r) => ({ sessionId: r.id, ref: { db: DB_PATH, sessionId: r.id }, label: r.title || 'opencode', mtime: r.time_updated }));
    } finally {
      db.close();
    }
  },

  parse(ref) {
    const dbPath = ref?.db || DB_PATH;
    const sid = ref?.sessionId || ref;
    const db = openDb(dbPath);
    try {
      const session = db.prepare('SELECT id, directory, title, model, time_created, time_updated FROM session WHERE id = ?').get(sid);
      if (!session) throw new Error(`opencode session not found: ${sid}`);
      const messages = db
        .prepare('SELECT id, time_created, data FROM message WHERE session_id = ? ORDER BY time_created')
        .all(sid)
        .map((m) => ({ id: m.id, time_created: m.time_created, role: JSON.parse(m.data).role }));
      const parts = db
        .prepare('SELECT message_id, time_created, data FROM part WHERE session_id = ? ORDER BY time_created')
        .all(sid)
        .map((p) => {
          const d = JSON.parse(p.data);
          return { messageId: p.message_id, time_created: p.time_created, type: d.type, text: d.text, tool: d.tool, callID: d.callID, state: d.state };
        });
      return buildTrace({ session, messages, parts });
    } finally {
      db.close();
    }
  },
};
