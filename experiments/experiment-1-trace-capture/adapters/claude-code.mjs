// Claude Code adapter — parses ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl.
//
// Richest host we have: the transcript carries tool_use blocks (stable `toolu_…`
// ids) paired to tool_result blocks (`tool_use_id` + `is_error`), each entry
// timestamped. So we build a full SESSION -> TURN -> TOOL_CALL tree with real
// durations and OK/ERROR status. No hooks, no live process — pure file parsing.

import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { event, trace, EventKind, Status } from '../core/event.mjs';

const require = createRequire(import.meta.url);
const PROJECTS_DIR = join(homedir(), '.claude', 'projects');

// Claude encodes the project's cwd into the dir name by replacing non-alphanumerics with '-'.
const encodeCwd = (cwd) => cwd.replace(/[^A-Za-z0-9]/g, '-');

const ms = (iso) => (iso ? Date.parse(iso) : NaN);

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

/** Extract plain prompt text from a user message.content (string | block array). */
function promptText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const txt = content
      .filter((b) => b.type === 'text')
      .map((b) => b.text || '')
      .join(' ');
    return txt;
  }
  return '';
}

const clean = (s) => s.replace(/\s+/g, ' ').trim();
const truncate = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export const claudeCode = {
  name: 'claude-code',

  detect() {
    return existsSync(PROJECTS_DIR);
  },

  // Cross-host distill: delegate to the canonical Claude signal extractor.
  // Lazy import avoids an import-time cycle (distill.mjs imports this adapter);
  // mineTranscript is only called at runtime, so the cycle is harmless.
  mineSignals(ref) {
    try {
      const file = typeof ref === 'string' ? ref : ref.ref;
      // eslint-disable-next-line global-require
      const { mineTranscript } = require('../../../zuzuu/knowledge/distill.mjs');
      const { sessionId, ...sig } = mineTranscript(file);
      return sig;
    } catch {
      return { commands: [], files: [], failures: [], sequences: [], correctionTurns: [], destructiveFailures: [] };
    }
  },

  listSessions(opts = {}) {
    const cwd = opts.cwd || process.cwd();
    const dirs = opts.project
      ? [opts.project]
      : [encodeCwd(cwd)].filter((d) => existsSync(join(PROJECTS_DIR, d)));
    // Fallback: if this project's dir isn't present, scan every project.
    const roots = dirs.length ? dirs : (existsSync(PROJECTS_DIR) ? readdirSync(PROJECTS_DIR) : []);
    const out = [];
    for (const d of roots) {
      const dir = join(PROJECTS_DIR, d);
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir)) {
        if (!f.endsWith('.jsonl')) continue;
        const path = join(dir, f);
        out.push({ sessionId: f.replace(/\.jsonl$/, ''), label: d, ref: path, mtime: statSync(path).mtimeMs });
      }
    }
    return out.sort((a, b) => b.mtime - a.mtime);
  },

  parse(ref) {
    const file = typeof ref === 'string' ? ref : ref.ref;
    const rows = readJsonl(file);

    let sessionId = '';
    const session = { startMs: Infinity, endMs: -Infinity, model: '', version: '', cwd: '', gitBranch: '' };

    // Pass 1: index tool_result end-times/status/size by tool_use_id.
    const results = new Map();
    for (const r of rows) {
      const c = r.message?.content;
      if (!Array.isArray(c)) continue;
      for (const b of c) {
        if (b.type !== 'tool_result') continue;
        const body = typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? '');
        results.set(b.tool_use_id, { endMs: ms(r.timestamp), isError: !!b.is_error, bytes: body.length });
      }
    }

    // Pass 2: walk in order, tracking the current turn; emit turn + tool events.
    const events = [];
    const seenTurns = new Set();
    const turnEnd = new Map(); // turnRefId -> latest child end ms
    let currentTurn = null;

    for (const r of rows) {
      if (r.sessionId) sessionId ||= r.sessionId;
      const t = ms(r.timestamp);
      if (Number.isFinite(t)) {
        session.startMs = Math.min(session.startMs, t);
        session.endMs = Math.max(session.endMs, t);
      }
      if (r.cwd) session.cwd ||= r.cwd;
      if (r.gitBranch) session.gitBranch ||= r.gitBranch;
      if (r.version) session.version ||= r.version;
      if (r.message?.model) session.model ||= r.message.model;

      const role = r.message?.role;
      const content = r.message?.content;

      // A real user turn: role=user, has text/string content (not a tool_result), not meta.
      if (r.type === 'user' && role === 'user' && !r.isMeta && Number.isFinite(t)) {
        const isToolResult = Array.isArray(content) && content.some((b) => b.type === 'tool_result');
        if (!isToolResult) {
          const refId = r.promptId || r.uuid;
          if (refId && !seenTurns.has(refId)) {
            seenTurns.add(refId);
            const text = clean(promptText(content));
            currentTurn = refId;
            events.push(
              event({
                kind: EventKind.TURN,
                refId,
                parentRefId: sessionId || 'session',
                name: 'turn: ' + (truncate(text, 60) || '(empty)'),
                startMs: t,
                endMs: t,
                attributes: { 'turn.prompt.bytes': text.length },
              }),
            );
          }
        }
      }

      // Tool calls: assistant content with tool_use blocks.
      if (r.type === 'assistant' && Array.isArray(content)) {
        for (const b of content) {
          if (b.type !== 'tool_use') continue;
          const res = results.get(b.id) || {};
          const startMs = Number.isFinite(t) ? t : res.endMs ?? session.startMs;
          const endMs = Number.isFinite(res.endMs) ? res.endMs : startMs;
          const input = typeof b.input === 'string' ? b.input : JSON.stringify(b.input ?? {});
          const parent = currentTurn || sessionId || 'session';
          events.push(
            event({
              kind: EventKind.TOOL_CALL,
              refId: b.id,
              parentRefId: parent,
              name: b.name || 'tool',
              startMs,
              endMs,
              status: res.isError ? Status.ERROR : Status.OK,
              attributes: {
                'gen_ai.operation.name': 'execute_tool',
                'gen_ai.tool.name': b.name || '',
                'host.tool.name': b.name || '',
                'tool.input.bytes': input.length, // size only — raw input is not put on the trace
                'tool.result.bytes': res.bytes ?? 0,
              },
            }),
          );
          turnEnd.set(parent, Math.max(turnEnd.get(parent) ?? 0, endMs));
        }
      }
    }

    sessionId ||= file.split('/').pop().replace(/\.jsonl$/, '');
    if (!Number.isFinite(session.startMs)) session.startMs = 0;
    if (!Number.isFinite(session.endMs)) session.endMs = session.startMs;

    // Extend each turn to cover its tool children.
    for (const e of events) {
      if (e.kind === EventKind.TURN && turnEnd.has(e.refId)) e.endMs = Math.max(e.endMs, turnEnd.get(e.refId));
    }

    // The SESSION root.
    events.unshift(
      event({
        kind: EventKind.SESSION,
        refId: sessionId,
        parentRefId: null,
        name: `session ${sessionId.slice(0, 8)} (claude-code)`,
        startMs: session.startMs,
        endMs: session.endMs,
        attributes: {
          'host.name': 'claude-code',
          'host.session.model': session.model,
          'host.session.version': session.version,
          'host.cwd': session.cwd,
          'host.git.branch': session.gitBranch,
        },
      }),
    );

    return trace({ host: 'claude-code', sessionId, title: session.cwd, events });
  },
};
