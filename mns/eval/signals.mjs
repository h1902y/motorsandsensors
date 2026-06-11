// mns/eval/signals.mjs
// Extract a normalized signal vector from a proposal record.
// Pure — no FS, no Date.now(), no Math.random(). Inject `now` and `sessionMtimes`.

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Extract a normalized signal vector from a proposal.
 *
 * @param {object} proposal  - A unified proposal record (payload, analysis, evidence, provenance).
 * @param {object} opts
 * @param {number} opts.now             - Current epoch ms (injected; default 0).
 * @param {object} opts.sessionMtimes   - Map of sessionId → epoch ms of last modification.
 * @param {object} opts.thresholds      - Override default normalisation denominators.
 * @returns {{ occurrence, corroboration, recency, failureReduction, erNovelty }} — each in [0,1].
 */
export function extractSignals(proposal, { now = 0, sessionMtimes = {}, thresholds = {} } = {}) {
  const evidence = proposal?.evidence ?? {};
  const analysis = proposal?.analysis ?? {};
  const provenance = Array.isArray(proposal?.provenance) ? proposal.provenance : [];

  const occurrenceThresh   = thresholds.occurrence       ?? 10;
  const sessionsThresh     = thresholds.sessions         ?? 3;
  const failuresThresh     = thresholds.failures         ?? 3;
  const recencyWindowMs    = thresholds.recencyWindowMs  ?? THIRTY_DAYS_MS;

  // occurrence: how often did this pattern appear?
  const occurrence = Math.min((evidence.occurrences ?? 0) / occurrenceThresh, 1);

  // corroboration: how many distinct sessions contributed?
  const corroboration = Math.min((evidence.sessions ?? 0) / sessionsThresh, 1);

  // recency: find the newest known session mtime among the provenance entries.
  // If no provenance sessions are found in sessionMtimes → neutral 0.5.
  let recency;
  const knownMtimes = provenance
    .map((p) => sessionMtimes[p?.session])
    .filter((ms) => ms !== undefined && ms !== null);

  if (knownMtimes.length === 0) {
    recency = 0.5;
  } else {
    const newest = Math.max(...knownMtimes);
    const age = now - newest;
    recency = 1 - Math.min(age / recencyWindowMs, 1);
  }

  // failureReduction: a proposal that addresses repeated failures is valuable.
  const failureReduction = Math.min((evidence.failures ?? 0) / failuresThresh, 1);

  // erNovelty: reward novel / enrich over duplicate.
  const verdictMap = { new: 1, enrich: 0.5, duplicate: 0 };
  const verdict = analysis?.er?.verdict;
  const erNovelty = verdict in verdictMap ? verdictMap[verdict] : 0.5;

  return { occurrence, corroboration, recency, failureReduction, erNovelty };
}
