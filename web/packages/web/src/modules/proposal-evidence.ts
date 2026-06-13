// Pure logic for rendering a proposal's "why" in plain language — shared by the
// review ceremony (ReviewFlow) and the module-detail expandable card (ModuleView).
// React-free so the translation rules are unit-testable.
import type { RankedProposalEvidence, RankedProposalSignals } from "@zuzuu-web/protocol";

/** Confidence buckets the score collapses to (mirrors the CLI scorer's
 *  >=0.66 high / >=0.33 med / else low). */
export type Confidence = "high" | "med" | "low";

export interface ConfidencePill {
  /** the bucket, lowercased — also the design-token key */
  level: Confidence;
  /** the human label shown in the pill */
  label: string;
  /** semantic color token name (maps to a Tailwind class in the component) */
  tone: "success" | "warning" | "neutral";
}

/** Map a confidence string (or a raw score, if the string is missing) to the
 *  pill descriptor. Unknown/null confidence with a score still resolves via the
 *  same thresholds the CLI uses; a bare null → low. */
export function confidencePill(
  confidence: string | null | undefined,
  score?: number | null,
): ConfidencePill {
  let level: Confidence;
  if (confidence === "high" || confidence === "med" || confidence === "low") {
    level = confidence;
  } else if (typeof score === "number") {
    level = score >= 0.66 ? "high" : score >= 0.33 ? "med" : "low";
  } else {
    level = "low";
  }
  const meta: Record<Confidence, Omit<ConfidencePill, "level">> = {
    high: { label: "high confidence", tone: "success" },
    med: { label: "medium confidence", tone: "warning" },
    low: { label: "low confidence", tone: "neutral" },
  };
  return { level, ...meta[level] };
}

/** A meaningful signal, translated to a phrase, with its 0-1 strength (for an
 *  optional inline bar). Only signals that carry real information are emitted. */
export interface SignalPhrase {
  /** stable key for React lists + the source signal name */
  key: string;
  /** the plain-language phrase */
  text: string;
  /** the signal's normalized strength in [0,1] (for an inline bar) */
  strength: number;
}

const ER_PHRASE: Record<string, string> = {
  new: "new — not seen before",
  enrich: "enriches an existing item",
  duplicate: "already known",
};

/**
 * Translate the signal vector + raw evidence into human phrases. Renders only
 * the signals that mean something (>0, or a present evidence count), so a weak
 * proposal shows few phrases rather than a wall of zeros.
 *
 * Prefers the raw evidence counts when present ("seen 12× across 3 sessions");
 * falls back to the normalized signal when only the vector is available
 * ("recurring", "recently active").
 */
export function signalPhrases(
  signals?: RankedProposalSignals,
  evidence?: RankedProposalEvidence,
): SignalPhrase[] {
  const out: SignalPhrase[] = [];
  const s = signals;
  const e = evidence ?? {};

  // occurrence — prefer the raw count
  if (typeof e.occurrences === "number" && e.occurrences > 0) {
    out.push({ key: "occurrence", text: `seen ${e.occurrences}×`, strength: s?.occurrence ?? 0 });
  } else if (s && s.occurrence > 0) {
    out.push({ key: "occurrence", text: "recurring pattern", strength: s.occurrence });
  }

  // corroboration — cross-session coverage
  if (typeof e.sessions === "number" && e.sessions > 0) {
    out.push({
      key: "corroboration",
      text: `across ${e.sessions} session${e.sessions === 1 ? "" : "s"}`,
      strength: s?.corroboration ?? 0,
    });
  } else if (s && s.corroboration > 0) {
    out.push({ key: "corroboration", text: "spans multiple sessions", strength: s.corroboration });
  }

  // failureReduction — only meaningful when there are failures to reduce
  if (typeof e.failures === "number" && e.failures > 0) {
    out.push({
      key: "failureReduction",
      text: `reduces ${e.failures} repeated failure${e.failures === 1 ? "" : "s"}`,
      strength: s?.failureReduction ?? 0,
    });
  } else if (s && s.failureReduction > 0) {
    out.push({ key: "failureReduction", text: "addresses repeated failures", strength: s.failureReduction });
  }

  // recency — a derived signal only (no raw count); skip the neutral 0.5 middle
  if (s) {
    if (s.recency >= 0.8) out.push({ key: "recency", text: "recently active", strength: s.recency });
    else if (s.recency > 0 && s.recency <= 0.2) out.push({ key: "recency", text: "stale", strength: s.recency });
  }

  // novelty — verdict is the clearest framing; fall back to the vector
  if (e.erVerdict && ER_PHRASE[e.erVerdict]) {
    out.push({ key: "erNovelty", text: ER_PHRASE[e.erVerdict]!, strength: s?.erNovelty ?? 0 });
  } else if (s) {
    if (s.erNovelty >= 1) out.push({ key: "erNovelty", text: "new — not seen before", strength: 1 });
    else if (s.erNovelty === 0) out.push({ key: "erNovelty", text: "already known", strength: 0 });
  }

  return out;
}
