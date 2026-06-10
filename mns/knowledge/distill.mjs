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
import { claudeCode } from '../../experiments/experiment-1-trace-capture/adapters/claude-code.mjs';
import { slugify } from './items.mjs';
import { createProposal, fileRegistryProposals } from './proposals.mjs';

const norm = (cmd) => String(cmd).trim().replace(/\s+/g, ' ').slice(0, 200);

/** Extract raw mining signals from one Claude Code transcript. */
export function mineTranscript(file) {
  const out = { commands: [], files: [], failures: [] };
  let sessionId = '';
  const results = new Map(); // tool_use_id -> is_error
  const uses = []; // {name, input}
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
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (b.type === 'tool_use') {
        const input = typeof b.input === 'string' ? safeParse(b.input) : b.input ?? {};
        uses.push({ id: b.id, name: b.name, input });
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
  }
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

/** Run the full distill: mine sessions → candidates → ER → proposals. */
export function distillSessions(mnsDir, transcriptFiles) {
  const mined = transcriptFiles.map((f) => {
    try {
      return mineTranscript(f);
    } catch {
      return null;
    }
  }).filter(Boolean);
  const candidates = aggregate(mined);
  const proposals = candidates.map((c) => createProposal(mnsDir, { candidate: c.candidate, source: 'distill', evidence: c.evidence }));
  const registryProposals = fileRegistryProposals(mnsDir);
  return { sessionsMined: mined.length, proposals, registryProposals };
}

/** Resolve which transcripts to mine. */
export function transcriptsFor({ scope = 'all', session = null, cwd = process.cwd() }) {
  const sessions = claudeCode.listSessions({ cwd });
  if (session) return sessions.filter((s) => s.sessionId.includes(session)).map((s) => s.ref);
  if (scope === 'last') return sessions.slice(0, 1).map((s) => s.ref);
  return sessions.map((s) => s.ref);
}
