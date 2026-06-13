// zuzuu/module/pending.mjs — pending-proposal collection shared by the gate
// surfaces (`zuzuu review`, `zuzuu proposals`, `zuzuu eval`). One walk order,
// one ranked grouping; adapters with their own listProposals (dir-shaped
// modules) override the spine read.

import * as registry from './registry.mjs';
import { listProposals as spineListProposals } from './proposal.mjs';
import { readIndex } from '../core/store.mjs';
import { rank } from '../eval/rank.mjs';
import { getScorer } from '../eval/score.mjs';

// Review walks modules in a fixed order so piped sessions are deterministic
// (the combo smoke test feeds one stdin across the actions pass then knowledge).
export const REVIEW_ORDER = ['actions', 'knowledge', 'guardrails', 'instructions', 'memory'];

/** Build sessionMtimes map from the sessions index — best-effort, fail-open. */
export function buildSessionMtimes(cwd) {
  try {
    const idx = readIndex(cwd);
    const map = {};
    for (const s of idx.sessions ?? []) {
      if (!s.id) continue;
      const ms = s.startedAt ? Date.parse(s.startedAt) : 0;
      if (!isNaN(ms) && ms > 0) map[s.id] = ms;
    }
    return map;
  } catch {
    return {};
  }
}

/** Pending proposals for one adapter (dir-shaped adapters override listProposals). */
export function modulePending(agentDir, a) {
  if (typeof a.listProposals === 'function') return a.listProposals(agentDir);
  // JSON-record modules: read via the spine (records carry both the spine shape
  // and the legacy candidate/er keys the knowledge card renders from).
  return spineListProposals(agentDir, a.name);
}

/** Ordered list of adapters that have pending proposals to review. */
export function pendingByModule(agentDir) {
  const adapters = registry.all();
  const seen = new Set();
  const ordered = [];
  for (const name of REVIEW_ORDER) {
    const a = adapters.find((x) => x.name === name);
    if (a) { ordered.push(a); seen.add(name); }
  }
  for (const a of adapters) if (!seen.has(a.name)) ordered.push(a);
  const sessionMtimes = buildSessionMtimes();
  const now = Date.now();
  const scorer = getScorer();
  const out = [];
  for (const a of ordered) {
    let proposals = modulePending(agentDir, a);
    if (!proposals.length) continue;
    // Rank proposals highest-score-first (display only — never changes approval/mint).
    const ranked = rank(proposals, scorer, { now, sessionMtimes });
    proposals = ranked.map((r) => r.proposal);
    out.push({ adapter: a, proposals });
  }
  return out;
}
