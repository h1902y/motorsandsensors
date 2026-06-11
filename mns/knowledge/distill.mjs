// `mns distill` — source A: mechanical miners over real sessions.
//
// Reads HOST transcripts directly (not our OTLP traces — those carry byte
// sizes only, by privacy design; mining is an internal on-machine read and
// only the distilled FACT + provenance becomes knowledge). Claude Code first —
// the richest log. Deterministic, zero-LLM: the cheap unambiguous signals.
//
// Miners (v1):
//   commands  — normalized Bash commands recurring ≥3× across ≥2 sessions
//               → `command` candidates ("a project command")
//   hot-files — files Read/Edit/Written ≥5× → `entity` candidates
//   failures  — tools failing ≥3× → `fact` candidates (worth knowing!)

import { readFileSync } from 'node:fs';
import * as registry from '../../experiments/experiment-1-trace-capture/adapters/registry.mjs';
import { slugify } from './items.mjs';
import { createProposal, fileRegistryProposals } from './proposals.mjs';

const norm = (cmd) => String(cmd).trim().replace(/\s+/g, ' ').slice(0, 200);

// Superset (WS5-T1) constants.
const SEQ_SEP = ' && '; // joins adjacent Bash commands into a 2-gram label
const CORRECTION_LEXICON = ["no, don't", "don't ", 'actually use', 'always ', 'never ', 'stop ', 'instead'];
const DESTRUCTIVE_SHAPES = [/\brm\s+-[a-z]*r/, /git\s+push\s+.*--force/, /DROP\s+TABLE/i, /chmod\s+-R/];

const isCorrection = (text) => {
  const t = String(text).toLowerCase();
  return CORRECTION_LEXICON.some((p) => t.includes(p));
};
const isDestructive = (cmd) => DESTRUCTIVE_SHAPES.some((re) => re.test(cmd));

/** Extract a plain-text string from a user message content (string or block array). */
function userText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join(' ');
  }
  return '';
}
/** True if a user message is a tool_result echo (not a real user turn). */
const isToolResult = (content) => Array.isArray(content) && content.some((b) => b && b.type === 'tool_result');

/**
 * Extract raw mining signals from one Claude Code transcript.
 * SUPERSET (WS5-T1): the original `commands/files/failures` keys are unchanged;
 * `sequences/correctionTurns/destructiveFailures` are added for later faculties.
 */
export function mineTranscript(file) {
  const out = { commands: [], files: [], failures: [], sequences: [], correctionTurns: [], destructiveFailures: [] };
  let sessionId = '';
  const results = new Map(); // tool_use_id -> is_error
  const uses = []; // {id, name, input}
  const bashOrder = []; // normalized Bash commands in transcript order
  const userTurns = []; // {text, afterToolAction}
  let sawToolAction = false;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.sessionId) sessionId ||= e.sessionId;
    const content = e.message?.content;
    // real user turn (text), not a tool_result echo → candidate correction turn
    if (e.type === 'user' && content != null && !isToolResult(content)) {
      const text = userText(content).trim();
      if (text) userTurns.push({ text, afterToolAction: sawToolAction });
    }
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (b.type === 'tool_use') {
        const input = typeof b.input === 'string' ? safeParse(b.input) : b.input ?? {};
        uses.push({ id: b.id, name: b.name, input });
        sawToolAction = true;
        if (b.name === 'Bash' && input?.command) bashOrder.push(norm(input.command));
      } else if (b.type === 'tool_result') {
        results.set(b.tool_use_id, !!b.is_error);
      }
    }
  }
  for (const u of uses) {
    const failed = results.get(u.id) === true;
    if (u.name === 'Bash' && u.input?.command) out.commands.push({ cmd: norm(u.input.command), failed });
    const fp = u.input?.file_path || u.input?.path;
    if (fp && ['Read', 'Write', 'Edit', 'NotebookEdit'].includes(u.name)) out.files.push(String(fp));
    if (failed) out.failures.push(u.name);
    if (failed && u.name === 'Bash' && u.input?.command) {
      const cmd = norm(u.input.command);
      if (isDestructive(cmd)) out.destructiveFailures.push({ cmd, tool: u.name });
    }
  }
  // 2-gram Bash sequences (adjacent within the session)
  for (let i = 0; i + 1 < bashOrder.length; i++) out.sequences.push(bashOrder[i] + SEQ_SEP + bashOrder[i + 1]);
  // corrective user turns that follow an assistant tool action
  for (const t of userTurns) if (t.afterToolAction && isCorrection(t.text)) out.correctionTurns.push({ text: t.text.slice(0, 500) });
  return { sessionId, ...out };
}

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

/**
 * Aggregate signals across sessions → candidates.
 * Pure (hermetically testable): takes mined per-session signals, returns candidates.
 */
export function aggregate(sessions, { minCmdCount = 3, minCmdSessions = 2, minFileTouches = 5, minFailures = 3 } = {}) {
  const candidates = [];
  // commands
  const cmdStats = new Map(); // cmd -> {count, sessions:Set, failures}
  for (const s of sessions) {
    for (const { cmd, failed } of s.commands) {
      const st = cmdStats.get(cmd) ?? { count: 0, sessions: new Set(), failures: 0 };
      st.count++;
      st.sessions.add(s.sessionId);
      if (failed) st.failures++;
      cmdStats.set(cmd, st);
    }
  }
  for (const [cmd, st] of cmdStats) {
    if (st.count >= minCmdCount && st.sessions.size >= minCmdSessions) {
      candidates.push({
        candidate: {
          id: 'command-' + slugify(cmd, 40),
          type: 'command',
          body: `Recurring project command: \`${cmd}\` (used ${st.count}× across ${st.sessions.size} sessions${st.failures ? `, failed ${st.failures}×` : ''}).`,
          attributes: { command: cmd },
          relations: [],
          provenance: [...st.sessions].slice(0, 5).map((id) => ({ session: id, ref: 'distill:commands' })),
        },
        evidence: { occurrences: st.count, sessions: st.sessions.size, failures: st.failures },
      });
    }
  }
  // hot files
  const fileStats = new Map();
  for (const s of sessions) {
    for (const f of s.files) {
      const st = fileStats.get(f) ?? { count: 0, sessions: new Set() };
      st.count++;
      st.sessions.add(s.sessionId);
      fileStats.set(f, st);
    }
  }
  for (const [path, st] of fileStats) {
    if (st.count >= minFileTouches) {
      const base = path.split('/').slice(-2).join('/');
      candidates.push({
        candidate: {
          id: 'file-' + slugify(base, 40),
          type: 'entity',
          body: `Hot file in this project: \`${path}\` (touched ${st.count}× across ${st.sessions.size} sessions).`,
          attributes: { path },
          relations: [],
          provenance: [...st.sessions].slice(0, 5).map((id) => ({ session: id, ref: 'distill:hot-files' })),
        },
        evidence: { occurrences: st.count, sessions: st.sessions.size },
      });
    }
  }
  // failing tools
  const failStats = new Map();
  for (const s of sessions) for (const t of s.failures) failStats.set(t, (failStats.get(t) ?? 0) + 1);
  for (const [tool, n] of failStats) {
    if (n >= minFailures) {
      candidates.push({
        candidate: {
          id: 'failing-tool-' + slugify(tool, 30),
          type: 'fact',
          body: `Tool \`${tool}\` fails frequently in this project (${n} failures observed) — worth investigating why.`,
          attributes: {},
          relations: [],
          provenance: sessions.filter((s) => s.failures.includes(tool)).slice(0, 5).map((s) => ({ session: s.sessionId, ref: 'distill:failures' })),
        },
        evidence: { occurrences: n },
      });
    }
  }
  return candidates;
}

/**
 * Mine one {host, ref} pair into the per-session signal superset (tagged with a
 * host-prefixed sessionId so cross-host provenance is legible). Tolerant.
 */
export function mineHostSession({ host, ref, sessionId }) {
  try {
    const adapter = registry.byName(host);
    if (!adapter || typeof adapter.mineSignals !== 'function') return null;
    const sig = adapter.mineSignals(ref);
    const sid = sessionId || (typeof ref === 'string' ? ref : ref?.sessionId) || host;
    return { sessionId: `${host}:${sid}`, host, ...sig };
  } catch {
    return null;
  }
}

/** Run the full distill: mine sessions (all hosts) → candidates → ER → proposals. */
export function distillSessions(mnsDir, pairs) {
  const mined = pairs.map(mineHostSession).filter(Boolean);
  const candidates = aggregate(mined);
  const proposals = candidates.map((c) => createProposal(mnsDir, { candidate: c.candidate, source: 'distill', evidence: c.evidence }));
  const registryProposals = fileRegistryProposals(mnsDir);
  return { sessionsMined: mined.length, proposals, registryProposals };
}

/**
 * Resolve which transcripts to mine across ALL detected hosts.
 * Returns `[{host, ref}]`, newest-first, honoring `scope` ('last'|'all') and a
 * `session` substring filter. (Was claude-only — that starved 4 of 5 hosts.)
 */
export function transcriptsFor({ scope = 'all', session = null, cwd = process.cwd() }) {
  const pairs = [];
  for (const adapter of registry.detected()) {
    let sessions = [];
    try {
      sessions = adapter.listSessions({ cwd });
    } catch {
      continue; // a flaky host (e.g. SQLite on old Node) must not break the rest
    }
    for (const s of sessions) pairs.push({ host: adapter.name, ref: s.ref, sessionId: s.sessionId, mtime: s.mtime ?? 0 });
  }
  pairs.sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0));
  let filtered = pairs;
  if (session) filtered = pairs.filter((p) => String(p.sessionId).includes(session));
  else if (scope === 'last') filtered = pairs.slice(0, 1);
  return filtered.map((p) => ({ host: p.host, ref: p.ref, sessionId: p.sessionId }));
}
