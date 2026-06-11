// mns/miners/guardrails.mjs
// Guardrails miner (WS5-T3) — detect repeated destructive-command failures
// across sessions and propose ask-only guardrail rules.
//
// MANDATORY SAFETY PROPERTIES (enforced in aggregate):
//   1. action is ALWAYS 'ask' — never 'deny'. Auto-proposed rules only escalate
//      to the human prompt, they never hard-block.
//   2. Patterns are LITERAL-ESCAPED from the observed command — never a broad/
//      free regex.  escapeRegex() handles this.
//   3. Cross-session corroboration required — a destructive command must fail
//      ≥minFailures (default 3) times across ≥minSessions (default 2) DISTINCT
//      sessions.  A single session — no matter how many failures — produces
//      NOTHING.
//
// Shape: { faculty:'guardrails', aggregate(sessions, opts), propose(mnsDir, aggregated) }
// Self-registers on import.

import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { slugify } from '../knowledge/items.mjs';
import { makeProposal, writeProposal, listProposals } from '../faculty/proposal.mjs';
import { register } from './registry.mjs';

// ---------------------------------------------------------------------------
// escapeRegex — the ONLY safe way to build a pattern from a literal command.
// Escapes all RegExp metacharacters so the pattern matches the exact string.

/**
 * Escape all regex metacharacters in `s` so that `new RegExp(escapeRegex(s))`
 * matches exactly the string `s` and nothing broader.
 *
 * @param {string} s
 * @returns {string}
 */
export function escapeRegex(s) {
  // Standard set of regex metacharacters that need escaping.
  return String(s).replace(/[.*+?^${}()|[\]\\\/\-]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// helpers

/** Normalise a command string (trim + collapse whitespace). */
const norm = (cmd) => String(cmd).trim().replace(/\s+/g, ' ').slice(0, 200);

/** Derive a guardrails-miner id for a command. */
function guardId(cmd) {
  return 'guard-' + slugify(cmd, 50);
}

/** Load rules.json; returns { version, rules:[] } if absent/unreadable. */
function loadRules(mnsDir) {
  const path = join(mnsDir, 'guardrails', 'rules.json');
  if (!existsSync(path)) return { version: 1, rules: [] };
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { version: 1, rules: [] };
  }
}

// ---------------------------------------------------------------------------
// aggregate

/**
 * Group destructiveFailures by normalised command; emit a candidate ONLY when
 * both the occurrence count and distinct-session count meet their thresholds.
 *
 * SAFETY: a single-session cluster, no matter how large, produces NOTHING.
 *
 * @param {Array<{sessionId:string, destructiveFailures:{cmd:string,tool:string}[]}>} sessions
 * @param {object} opts
 * @param {number} [opts.minFailures=3]   min total failures across all sessions
 * @param {number} [opts.minSessions=2]  min distinct sessions with ≥1 failure each
 * @returns {Array<{payload:{id,action,tool,pattern,reason}, evidence:{occurrences,sessions}}>}
 */
export function aggregate(sessions, { minFailures = 3, minSessions = 2 } = {}) {
  // cmd (normalized) → { count: number, sessions: Set<sessionId>, tool: string }
  const stats = new Map();

  for (const s of sessions) {
    if (!Array.isArray(s.destructiveFailures)) continue;
    for (const { cmd, tool } of s.destructiveFailures) {
      const key = norm(cmd);
      const st = stats.get(key) ?? { count: 0, sessions: new Set(), tool: tool ?? 'Bash' };
      st.count++;
      st.sessions.add(s.sessionId);
      // Keep first observed tool name (they should all be 'Bash' for destructive cmds).
      stats.set(key, st);
    }
  }

  const candidates = [];
  for (const [cmd, st] of stats) {
    // SAFETY: enforce BOTH thresholds — cross-session gate is the key one.
    if (st.count < minFailures) continue;
    if (st.sessions.size < minSessions) continue; // ← single-session always rejected here

    const id = guardId(cmd);
    const pattern = escapeRegex(cmd);
    const tool = st.tool ?? 'Bash';

    candidates.push({
      payload: {
        id,
        // SAFETY: ALWAYS 'ask', never 'deny'.
        action: 'ask',
        tool,
        pattern,
        reason: `auto-proposed: '${cmd}' failed repeatedly across sessions — confirm before running`,
      },
      evidence: {
        occurrences: st.count,
        sessions: st.sessions.size,
      },
    });
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// propose

/**
 * Write a guardrails proposal into agent/guardrails/proposals/ for each candidate.
 * Idempotent:
 *   - skips if a guardrails proposal with the same payload.id already exists
 *   - skips if rules.json already has a rule with that id
 *
 * The proposals flow through `mns review` → guardrails adapter on approval.
 *
 * @param {string} mnsDir
 * @param {ReturnType<typeof aggregate>} aggregated
 * @returns {number} count of new proposals written
 */
export function propose(mnsDir, aggregated) {
  // Load existing proposals (ids already pending).
  const existing = listProposals(mnsDir, 'guardrails');
  const existingIds = new Set(existing.map((p) => p.payload?.id).filter(Boolean));

  // Load existing rules (ids already applied).
  const rulesData = loadRules(mnsDir);
  const rulesIds = new Set((rulesData.rules ?? []).map((r) => r.id).filter(Boolean));

  let count = 0;
  for (const c of aggregated) {
    const { payload, evidence } = c;

    // Idempotent: skip if already proposed or already a live rule.
    if (existingIds.has(payload.id)) continue;
    if (rulesIds.has(payload.id)) continue;

    const proposal = makeProposal({
      faculty: 'guardrails',
      kind: 'rule',
      source: 'distill',
      payload,
      evidence,
    });

    writeProposal(mnsDir, proposal);
    count++;
  }

  return count;
}

// ---------------------------------------------------------------------------
// self-register

export const miner = { faculty: 'guardrails', aggregate, propose };

register(miner);
