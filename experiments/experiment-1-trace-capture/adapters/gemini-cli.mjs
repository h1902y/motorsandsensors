// Gemini CLI adapter — parses ~/.gemini/tmp/<project>/logs.json.
//
// Deliberately the THIN counterpart to claude-code, and the honest proof of the
// README's thesis that "observability completeness varies by host". Gemini's
// logs.json is a flat user-prompt timeline only:
//   { sessionId, messageId, type:"user", message, timestamp }
// — no assistant turns, no tool calls (those live in Gemini *checkpoint* files,
// deferred). So this adapter emits SESSION -> TURN (prompt) and stops there.
// Same core, second host, different shape => host-agnosticity DEMONSTRATED, not
// asserted; the missing tool layer is a capture gap, not a core change.

import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { event, trace, EventKind } from '../core/event.mjs';
import { emptySignals } from './signals.mjs';

const TMP_DIR = join(homedir(), '.gemini', 'tmp');

const ms = (iso) => (iso ? Date.parse(iso) : NaN);
const clean = (s) => String(s).replace(/\s+/g, ' ').trim();
const truncate = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function readLog(file) {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export const geminiCli = {
  name: 'gemini-cli',

  detect() {
    return existsSync(TMP_DIR);
  },

  // Cross-host distill: logs.json is PROMPT-ONLY (no tool calls) → empty superset.
  // Honest: gemini's on-disk capture is thin (tool calls live in checkpoints).
  mineSignals() {
    return emptySignals();
  },

  listSessions() {
    if (!existsSync(TMP_DIR)) return [];
    const out = [];
    for (const project of readdirSync(TMP_DIR)) {
      const file = join(TMP_DIR, project, 'logs.json');
      if (!existsSync(file)) continue;
      const rows = readLog(file);
      const sessions = new Map(); // sessionId -> {count, last}
      for (const r of rows) {
        if (!r.sessionId) continue;
        const s = sessions.get(r.sessionId) || { count: 0, last: 0 };
        s.count++;
        s.last = Math.max(s.last, ms(r.timestamp) || 0);
        sessions.set(r.sessionId, s);
      }
      for (const [sessionId, s] of sessions) {
        out.push({ sessionId, label: `${project} (${s.count} msgs)`, ref: { file, sessionId }, mtime: s.last });
      }
    }
    return out.sort((a, b) => b.mtime - a.mtime);
  },

  parse(ref) {
    const { file, sessionId } = ref;
    const rows = readLog(file)
      .filter((r) => r.sessionId === sessionId && r.type === 'user')
      .sort((a, b) => (a.messageId ?? 0) - (b.messageId ?? 0));

    const times = rows.map((r) => ms(r.timestamp)).filter(Number.isFinite);
    const startMs = times.length ? Math.min(...times) : 0;
    const endMs = times.length ? Math.max(...times) : startMs;

    const events = rows.map((r, i) => {
      const t = ms(r.timestamp);
      const start = Number.isFinite(t) ? t : startMs;
      // Tile prompts: a prompt span runs until the next prompt (gives readable durations).
      const nextT = ms(rows[i + 1]?.timestamp);
      const end = Number.isFinite(nextT) ? nextT : Math.max(start, endMs);
      const text = clean(r.message);
      return event({
        kind: EventKind.TURN,
        refId: `${sessionId}:${r.messageId ?? i}`,
        parentRefId: sessionId,
        name: 'turn: ' + (truncate(text, 60) || '(empty)'),
        startMs: start,
        endMs: end,
        attributes: { 'turn.prompt.bytes': text.length },
      });
    });

    events.unshift(
      event({
        kind: EventKind.SESSION,
        refId: sessionId,
        parentRefId: null,
        name: `session ${sessionId.slice(0, 8)} (gemini-cli)`,
        startMs,
        endMs,
        attributes: {
          'host.name': 'gemini-cli',
          'host.capture.note': 'logs.json = user prompts only; tool calls live in checkpoints (not captured)',
        },
      }),
    );

    return trace({ host: 'gemini-cli', sessionId, events });
  },
};
