// mns/eval/rank.mjs
// Rank proposals by mechanical score, high→low.
// Pure — no FS, no side-effects. Input array is never mutated.

import { mechanicalScore } from './score.mjs';

/**
 * Rank an array of proposals by score, descending.
 * Stable on ties: proposals with equal scores are ordered by proposal.id (lexicographic ascending).
 *
 * @param {object[]} proposals - Array of unified proposal records.
 * @param {Function} scorer    - Scoring function (default: mechanicalScore).
 * @param {object}   opts      - Options forwarded to the scorer (now, sessionMtimes, thresholds).
 * @returns {Array<{ proposal, score, confidence, rationale, signals }>} - New array, sorted DESC.
 */
export function rank(proposals, scorer = mechanicalScore, opts = {}) {
  const scored = proposals.map((proposal) => ({
    proposal,
    ...scorer(proposal, opts),
  }));

  // Sort descending by score; stable tie-break by proposal.id ascending.
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const idA = String(a.proposal?.id ?? '');
    const idB = String(b.proposal?.id ?? '');
    return idA < idB ? -1 : idA > idB ? 1 : 0;
  });

  return scored;
}
