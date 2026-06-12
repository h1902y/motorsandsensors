// `zuzuu eval [--faculty f]` — non-interactive proposal ranking table.
// Loads proposals across all faculties (or one with --faculty), ranks them
// highest-score first, and prints a table:
//   <score> [<conf>]  <faculty>/<id>  — <rationale>
//
// Also exports `evalLine` — a small pure helper used by `zuzuu review` to render
// a one-line eval annotation per proposal card.

import { join } from 'node:path';
import { paths, readIndex } from '../store.mjs';
import * as registry from '../faculty/registry.mjs';
import { listProposals as spineListProposals } from '../faculty/proposal.mjs';
import { rank } from '../eval/rank.mjs';
import { getScorer } from '../eval/score.mjs';
import '../knowledge/adapter.mjs';    // self-registers the 'knowledge' adapter
import '../actions/adapter.mjs';      // self-registers the 'actions' adapter
import '../guardrails/adapter.mjs';   // self-registers the 'guardrails' adapter
import '../instructions/adapter.mjs'; // self-registers the 'instructions' adapter
import '../memory/adapter.mjs';       // self-registers the 'memory' adapter

/**
 * Format one eval annotation line for a proposal card in `zuzuu review`.
 * Pure: no FS, no Date.now(). Accepts a scoreResult from mechanicalScore/rank.
 *
 * @param {{ score: number, confidence: string, rationale: string }} scoreResult
 * @returns {string}  e.g.  "eval: 0.775 [high] · recurring + cross-session"
 */
export function evalLine({ score, confidence, rationale }) {
  const warn = confidence === 'low' ? ' ⚠ low-signal' : '';
  return `eval: ${score} [${confidence}] · ${rationale}${warn}`;
}

/**
 * Build sessionMtimes from the sessions index — cheap best-effort.
 * Falls back to {} on any error.
 * @param {string} [cwd]
 * @returns {Record<string, number>}
 */
function buildSessionMtimes(cwd) {
  try {
    const idx = readIndex(cwd);
    const map = {};
    for (const s of idx.sessions ?? []) {
      if (!s.id) continue;
      // prefer startedAt ms; fall back to 0 (neutral recency)
      const ms = s.startedAt ? Date.parse(s.startedAt) : 0;
      if (!isNaN(ms) && ms > 0) map[s.id] = ms;
    }
    return map;
  } catch {
    return {};
  }
}

/** Collect proposals for a given adapter (mirrors review.mjs's facultyPending). */
function collectProposals(agentDir, adapter) {
  if (typeof adapter.listProposals === 'function') return adapter.listProposals(agentDir);
  return spineListProposals(agentDir, adapter.name);
}

/**
 * Pure: gather + rank all pending proposals, returning structured data for JSON output.
 * The zuzuu-web /eval source.
 * Touches FS via buildSessionMtimes (fail-open) and collectProposals.
 *
 * @param {string} agentDir   Resolved .zuzuu/ path.
 * @param {object} [opts]
 * @param {string} [opts.faculty]  Filter to a single faculty name.
 * @returns {{ ranked: Array<{id,faculty,title,score,confidence,rationale}> }}
 */
export function evalData(agentDir, { faculty: onlyFaculty = null } = {}) {
  const adapters = registry.all();
  const sessionMtimes = buildSessionMtimes(join(agentDir, '..'));
  const now = Date.now();
  const scorer = getScorer();

  const allEntries = [];
  for (const adapter of adapters) {
    if (onlyFaculty && adapter.name !== onlyFaculty) continue;
    const proposals = collectProposals(agentDir, adapter);
    for (const proposal of proposals) {
      allEntries.push({ proposal, faculty: adapter.name });
    }
  }

  if (!allEntries.length) return { ranked: [] };

  const rawProposals = allEntries.map((e) => e.proposal);
  const rankResults = rank(rawProposals, scorer, { now, sessionMtimes });
  const facultyByProposalId = new Map(allEntries.map((e) => [e.proposal.id, e.faculty]));

  const ranked = rankResults.map(({ proposal, score, confidence, rationale }) => {
    const fac = facultyByProposalId.get(proposal.id) ?? '?';
    const title = proposal.title
      ?? proposal.candidate?.body?.slice(0, 80)
      ?? proposal.payload?.body?.slice(0, 80)
      ?? proposal.id;
    return { id: proposal.id, faculty: fac, title, score, confidence, rationale };
  });

  return { ranked };
}

/**
 * Core of `zuzuu eval` — exported so tests can inject a custom log fn.
 *
 * @param {object}   args            Parsed CLI args.
 * @param {Function} [log=console.log]  Output sink (injectable for tests).
 */
export function evalCmd(args, log = console.log) {
  const agentDir = paths().dir;
  const onlyFaculty = args?.faculty ?? null;

  if (args?.json) {
    const d = evalData(agentDir, { faculty: onlyFaculty });
    log(JSON.stringify(d));
    return;
  }

  const { ranked } = evalData(agentDir, { faculty: onlyFaculty });
  if (!ranked.length) { log('no pending proposals'); return; }
  for (const { id, faculty, score, confidence, rationale } of ranked) {
    const warn = confidence === 'low' ? ' ⚠' : '';
    log(`${String(score).padEnd(6)} [${confidence}]  ${faculty}/${id}  — ${rationale}${warn}`);
  }
}
