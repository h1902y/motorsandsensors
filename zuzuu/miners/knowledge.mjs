// Knowledge miner (WS5-T1) — the existing source-A distill path, wrapped as a
// registry miner. NO behavior change: `aggregate` is the same function the
// golden distill test asserts on; `propose` mirrors `distillSessions` (one
// `createProposal` per aggregated candidate). Self-registers on import.

import { aggregate } from '../knowledge/distill.mjs';
import { createProposal } from '../knowledge/proposals.mjs';
import { register } from './registry.mjs';

/** File one knowledge proposal per aggregated candidate; return the count. */
export function propose(agentDir, aggregated) {
  for (const c of aggregated) {
    createProposal(agentDir, { candidate: c.candidate, source: 'distill', evidence: c.evidence });
  }
  return aggregated.length;
}

export const miner = { faculty: 'knowledge', aggregate, propose };

register(miner);

export { aggregate };
