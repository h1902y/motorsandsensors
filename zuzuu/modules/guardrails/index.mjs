// zuzuu/modules/guardrails/index.mjs — the Guardrails module.
//
// Consolidates the adapter (rule proposals → envelope items), the miner
// (repeated destructive-command failures → ask-only rules, WS5-T3), the digest
// section and the GATE hook (the only module with one — the enforced
// PreToolUse engine) behind the Module contract. The rule engine
// itself stays in zuzuu/guardrails/engine.mjs (the gate's hot path imports it
// directly too); this module is the contract face.
//
// A guardrails proposal payload is a single rule record:
//   { id, action: deny|ask|allow, tool, pattern, reason, body? }
//
// MANDATORY MINER SAFETY PROPERTIES (enforced in aggregate):
//   1. action is ALWAYS 'ask' — never 'deny'. Auto-proposed rules only escalate
//      to the human prompt, they never hard-block.
//   2. Patterns are LITERAL-ESCAPED from the observed command — never a broad/
//      free regex.  escapeRegex() handles this.
//   3. Cross-session corroboration required — a destructive command must fail
//      ≥minFailures (default 3) times across ≥minSessions (default 2) DISTINCT
//      sessions.  A single session — no matter how many failures — produces
//      NOTHING.

import { join } from 'node:path';
import { writeModuleItem } from '../../module/items.mjs';
import { deriveTitle } from '../../module/envelope.mjs';
import { makeProposal, writeProposal, listProposals, isArchivedResolved } from '../../module/proposal.mjs';
import { loadRules, evaluate } from '../../guardrails/engine.mjs';
import { slugify } from '../../knowledge/items.mjs';

const name = 'guardrails';

export const manifest = {
  id: 'guardrails',
  title: 'Guardrails',
  tagline: 'what NOT to do — enforced rules on every tool call',
  version: '1.0.0',
  contract: 1,
  kinds: ['rule'],
  itemsDir: 'items',
  schema: 'schema.json',
  hooks: { miner: true, digest: true, eval: false, gate: true },
  ui: { icon: 'shield', accent: 'danger', teaching: 'Hard rules enforced by the zuzuu gate on every tool call — a refusal here is policy, not preference.' },
};

const VALID_ACTIONS = new Set(['deny', 'ask', 'allow']);

// ---------------------------------------------------------------------------
// adapter contract
// ---------------------------------------------------------------------------

/**
 * Ingest a raw rule object. Pass-through: rule fields are the payload.
 * @param {string} agentDir
 * @param {object} raw  — expected shape: { id, action, tool, pattern, reason }
 *                         or { payload: { ... } } from the spine
 */
function ingest(_agentDir, raw) {
  const payload = raw?.payload ?? raw ?? {};
  return { payload, analysis: {}, dedupeKey: payload.id };
}

/**
 * Validate a rule payload.
 * @returns {{ok:boolean, errors:string[], warnings:string[]}}
 */
export function validate(_agentDir, payload) {
  const errors = [];
  if (!payload?.id || typeof payload.id !== 'string' || !payload.id.trim()) {
    errors.push('rule id is required (non-empty string slug)');
  }
  if (!VALID_ACTIONS.has(payload?.action)) {
    errors.push(`action must be one of deny|ask|allow (got '${payload?.action}')`);
  }
  if (!payload?.tool || typeof payload.tool !== 'string') {
    errors.push('tool is required (exact tool name or \'*\')');
  }
  if (typeof payload?.pattern !== 'string' || !payload.pattern) {
    errors.push('pattern is required (a non-empty regex string)');
  } else {
    try {
      new RegExp(payload.pattern); // eslint-disable-line no-new
    } catch (e) {
      errors.push(`pattern does not compile as a RegExp: ${e.message}`);
    }
  }
  if (!payload?.reason || !String(payload.reason).trim()) {
    errors.push('reason is required (non-empty)');
  }
  return { ok: errors.length === 0, errors, warnings: [] };
}

/**
 * Apply an approved rule proposal: write the envelope item (upsert by id).
 * @returns {{ok:boolean, action:string, itemIds:string[]}}
 */
function apply(agentDir, proposal) {
  const rule = proposal?.payload ?? {};
  const id = rule.id;
  writeModuleItem(agentDir, {
    id,
    module: name,
    kind: 'rule',
    title: deriveTitle(rule.reason, id),
    status: 'active',
    created_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    provenance: Array.isArray(proposal?.provenance) ? proposal.provenance : [],
    payload: { action: rule.action, tool: rule.tool || '*', pattern: rule.pattern, reason: rule.reason },
    body: rule.body ?? '',
  });
  return { ok: true, action: `added rule ${id}`, itemIds: [id] };
}

export const applyProposal = apply;

/**
 * Render a rule proposal for the human gate.
 * @returns {{line:string, card:string}}
 */
function render(proposal) {
  const r = proposal?.payload ?? {};
  const summary = `${r.action ?? '?'} ${r.tool ?? '*'} /${r.pattern ?? ''}/ — ${r.reason ?? ''}`;
  return {
    line: `${r.id ?? ''}  [rule]  ${summary}`,
    card: summary,
  };
}

export const adapter = { name, ingest, validate, apply, render };

// ---------------------------------------------------------------------------
// gate hook — the ONLY module with one; same fail-open law as the engine
// ---------------------------------------------------------------------------

/**
 * Evaluate one tool call against this home's rule items.
 * @param {string} agentDir
 * @param {{tool:string, input:any}} toolCall
 * @returns {null | {action:'deny'|'ask'|'allow', rule:string, reason:string}}
 *          null = no rule matched / engine trouble → host's normal flow (fail-open)
 */
export function gate(agentDir, toolCall) {
  try {
    const loaded = loadRules(join(agentDir, 'guardrails'));
    if (!loaded.ok) return null;
    return evaluate(loaded.rules, toolCall);
  } catch {
    return null; // fail open
  }
}

// ---------------------------------------------------------------------------
// miner (WS5-T3 — destructive-failure clusters → ask-only rules, unchanged)
// ---------------------------------------------------------------------------

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

/** Normalise a command string (trim + collapse whitespace). */
const norm = (cmd) => String(cmd).trim().replace(/\s+/g, ' ').slice(0, 200);

/** Derive a guardrails-miner id for a command. */
function guardId(cmd) {
  return 'guard-' + slugify(cmd, 50);
}

/** Ids of live rule items (guardrails/items/*.md); absent/unreadable → none. */
function liveRuleIds(agentDir) {
  try {
    return new Set(loadRules(join(agentDir, 'guardrails')).rules.map((r) => r.id));
  } catch {
    return new Set();
  }
}

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

/**
 * Write a guardrails proposal into .zuzuu/guardrails/proposals/ for each candidate.
 * Idempotent:
 *   - skips if a guardrails proposal with the same payload.id already exists
 *   - skips if a live rule item (guardrails/items/<id>.md) already exists
 *   - skips if the id is already resolved in proposals/archive/ — a rejection
 *     is remembered; re-distilling never resurrects it
 *
 * The proposals flow through `zuzuu review` → guardrails adapter on approval.
 *
 * @param {string} agentDir
 * @param {ReturnType<typeof aggregate>} aggregated
 * @returns {number} count of new proposals written
 */
export function propose(agentDir, aggregated) {
  // Load existing proposals (ids already pending).
  const existing = listProposals(agentDir, 'guardrails');
  const existingIds = new Set(existing.map((p) => p.payload?.id).filter(Boolean));

  // Live rule items (ids already applied).
  const rulesIds = liveRuleIds(agentDir);

  let count = 0;
  for (const c of aggregated) {
    const { payload, evidence } = c;

    // Idempotent: skip if already proposed or already a live rule.
    if (existingIds.has(payload.id)) continue;
    if (rulesIds.has(payload.id)) continue;

    const proposal = makeProposal({
      module: 'guardrails',
      kind: 'rule',
      source: 'distill',
      payload,
      evidence,
    });

    // A rejection is remembered: never resurrect an archive-resolved id.
    if (isArchivedResolved(agentDir, 'guardrails', proposal.id)) continue;

    writeProposal(agentDir, proposal);
    count++;
  }

  return count;
}

export const miner = { module: name, aggregate, propose };

// ---------------------------------------------------------------------------
// digest section (moved from the pre-module digest, byte-identical output)
// ---------------------------------------------------------------------------

/**
 * The Guardrails digest section: rule count + the enforcement reminder.
 * @param {string} agentDir
 * @returns {{lines: string[], data: object}}
 */
export function digestSection(agentDir) {
  let guardrails;
  try {
    const loaded = loadRules(join(agentDir, 'guardrails'));
    guardrails = { ok: loaded.ok, count: loaded.ok ? loaded.rules.length : 0, skipped: loaded.skipped?.length ?? 0 };
  } catch {
    guardrails = { ok: false, count: 0, skipped: 0 };
  }
  const lines = ['## Guardrails'];
  lines.push(guardrails.count ? `${guardrails.count} rule(s) — the enforced gate is on; refusals are policy.` : 'no rules configured.');
  return { lines, data: guardrails };
}

// ---------------------------------------------------------------------------
// session signals (the observability surface — `zuzuu session inspect`)
// ---------------------------------------------------------------------------

/** Counts of the mined-signal superset slices this module grows from. */
export function sessionSignals(signals = {}) {
  return { destructiveFailures: signals.destructiveFailures?.length ?? 0 };
}
