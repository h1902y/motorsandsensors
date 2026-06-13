// zuzuu/eval/score.mjs
// Mechanical scorer — weighted sum of normalized signals → { score, confidence, rationale, signals }.
// Pure; deterministic; no FS, no Date.now(), no Math.random().
//
// Module hook: a module may export evalSignals(proposal) → PARTIAL
// signals; those overlay the mechanical extraction (fail-soft via the
// registry's invoke — a broken hook leaves the default scorer untouched).
// No built-in implements it today, so behavior is unchanged.

import { extractSignals } from './signals.mjs';
import { BUILTIN_MODULES, invoke } from '../module/registry.mjs';

// Weight vector (must sum to 1.0).
const W = {
  occurrence:       0.30,
  corroboration:    0.30,
  recency:          0.15,
  failureReduction: 0.15,
  erNovelty:        0.10,
};

/**
 * Build a short human-readable rationale from the dominant signals.
 * Deterministic — purely a function of signal values.
 */
function buildRationale(s) {
  const parts = [];

  // Positive signals
  if (s.occurrence >= 0.8 && s.corroboration >= 0.8) {
    parts.push('recurring + cross-session');
  } else if (s.occurrence >= 0.8) {
    parts.push('high occurrence');
  } else if (s.corroboration >= 0.8) {
    parts.push('strong cross-session coverage');
  }

  if (s.failureReduction >= 0.5) {
    parts.push('addresses repeated failures');
  }

  if (s.recency >= 0.8) {
    parts.push('recently active');
  }

  // Novelty framing
  if (s.erNovelty === 0) {
    parts.push('already known');
  } else if (s.erNovelty === 1 && parts.length === 0) {
    parts.push('novel signal');
  }

  // Low-signal fallback
  if (parts.length === 0) {
    parts.push('weak evidence');
  }

  return parts.join('; ');
}

/**
 * Score a proposal mechanically.
 *
 * @param {object} proposal - Unified proposal record.
 * @param {object} opts     - Passed through to extractSignals (now, sessionMtimes, thresholds).
 * @returns {{ score: number, confidence: string, rationale: string, signals: object }}
 */
export function mechanicalScore(proposal, opts = {}) {
  let s = extractSignals(proposal, opts);

  // Optional per-module evalSignals hook — partial overlay, fail-soft.
  const mod = BUILTIN_MODULES[proposal?.module];
  if (mod && typeof mod.evalSignals === 'function') {
    const r = invoke({ id: proposal.module, module: mod }, 'evalSignals', proposal);
    if (r.ok && r.value && typeof r.value === 'object') s = { ...s, ...r.value };
  }

  const raw =
    W.occurrence       * s.occurrence +
    W.corroboration    * s.corroboration +
    W.recency          * s.recency +
    W.failureReduction * s.failureReduction +
    W.erNovelty        * s.erNovelty;

  const score = Number(Math.min(Math.max(raw, 0), 1).toFixed(4));

  const confidence = score >= 0.66 ? 'high' : score >= 0.33 ? 'med' : 'low';

  const rationale = buildRationale(s);

  return { score, confidence, rationale, signals: s };
}

export const SCORERS = { mechanical: mechanicalScore };

export function getScorer(name = 'mechanical') {
  return SCORERS[name] ?? mechanicalScore;
}
