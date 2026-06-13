// `zuzuu eval [--module f]` — non-interactive proposal ranking table.
// Loads proposals across all modules (or one with --module), ranks them
// highest-score first, and prints a table:
//   <score> [<conf>]  <module>/<id>  — <rationale>
//
// Also exports `evalLine` — a small pure helper used by `zuzuu review` to render
// a one-line eval annotation per proposal card.

import { join } from 'node:path';
import { paths } from '../core/store.mjs';
import * as registry from '../module/registry.mjs';
import { buildSessionMtimes, modulePending } from '../module/pending.mjs';
import { rank } from '../eval/rank.mjs';
import { getScorer } from '../eval/score.mjs';

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
 * Distil the raw evidence a proposal carries into the shape the UI renders to
 * plain language. Pure; never invents counts — a field the proposal lacks stays
 * undefined (inbox-sourced proposals carry only `erVerdict`; trace-mined ones
 * carry occurrences/sessions/failures).
 *
 * @param {object} proposal  A unified proposal record.
 * @returns {{ occurrences?: number, sessions?: number, failures?: number, erVerdict?: string }}
 */
export function evalEvidence(proposal) {
  const ev = proposal?.evidence ?? {};
  const out = {};
  if (typeof ev.occurrences === 'number') out.occurrences = ev.occurrences;
  if (typeof ev.sessions === 'number') out.sessions = ev.sessions;
  if (typeof ev.failures === 'number') out.failures = ev.failures;
  const verdict = proposal?.analysis?.er?.verdict;
  if (typeof verdict === 'string') out.erVerdict = verdict;
  return out;
}

/**
 * Pure: gather + rank all pending proposals, returning structured data for JSON output.
 * The zuzuu-web /eval source.
 * Touches FS via buildSessionMtimes (fail-open) and collectProposals.
 *
 * @param {string} agentDir   Resolved .zuzuu/ path.
 * @param {object} [opts]
 * @param {string} [opts.module]  Filter to a single module name.
 * @returns {{ ranked: Array<{id,module,title,score,confidence,rationale,signals,evidence}> }}
 *   `signals` = the 5 normalized 0-1 components behind the score;
 *   `evidence` = the raw counts the UI renders into plain language
 *   ({ occurrences, sessions, failures, erVerdict }). Both are best-effort:
 *   inbox-sourced proposals may carry only erVerdict.
 */
export function evalData(agentDir, { module: onlyModule = null } = {}) {
  const adapters = registry.all();
  const sessionMtimes = buildSessionMtimes(join(agentDir, '..'));
  const now = Date.now();
  const scorer = getScorer();

  const allEntries = [];
  for (const adapter of adapters) {
    if (onlyModule && adapter.name !== onlyModule) continue;
    const proposals = modulePending(agentDir, adapter);
    for (const proposal of proposals) {
      allEntries.push({ proposal, module: adapter.name });
    }
  }

  if (!allEntries.length) return { ranked: [] };

  const rawProposals = allEntries.map((e) => e.proposal);
  const rankResults = rank(rawProposals, scorer, { now, sessionMtimes });
  const moduleByProposalId = new Map(allEntries.map((e) => [e.proposal.id, e.module]));

  const ranked = rankResults.map(({ proposal, score, confidence, rationale, signals }) => {
    const fac = moduleByProposalId.get(proposal.id) ?? '?';
    const title = proposal.title
      ?? proposal.candidate?.body?.slice(0, 80)
      ?? proposal.payload?.body?.slice(0, 80)
      ?? proposal.id;
    return {
      id: proposal.id,
      module: fac,
      title,
      score,
      confidence,
      rationale,
      // The 5 normalized 0-1 components behind the score (occurrence,
      // corroboration, recency, failureReduction, erNovelty).
      signals,
      // Raw evidence the UI translates to plain language. Occurrences/sessions/
      // failures come from trace-mined proposals; erVerdict from the entity-
      // resolution analysis. Absent fields stay undefined (never invented).
      evidence: evalEvidence(proposal),
    };
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
  const onlyModule = args?.module ?? null;

  if (args?.json) {
    const d = evalData(agentDir, { module: onlyModule });
    log(JSON.stringify(d));
    return;
  }

  const { ranked } = evalData(agentDir, { module: onlyModule });
  if (!ranked.length) { log('no pending proposals'); return; }
  for (const { id, module, score, confidence, rationale } of ranked) {
    const warn = confidence === 'low' ? ' ⚠' : '';
    log(`${String(score).padEnd(6)} [${confidence}]  ${module}/${id}  — ${rationale}${warn}`);
  }
}
