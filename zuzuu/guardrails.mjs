// The Guardrails faculty — v1 rule engine (pure; I/O lives in the hook command).
//
// Rules are DATA, not code: one envelope item per rule under
// .zuzuu/guardrails/items/<id>.md (the Faculty Standard, W24) — *definitions*
// in the pin-definitions sense (versioned in git, graduate via proposals like
// every faculty's contents).
//
//   ---
//   id: no-root-wipe
//   faculty: guardrails
//   kind: rule
//   title: …
//   payload:
//     action: deny              # deny | ask | allow
//     tool: Bash                # exact tool name, or "*"
//     pattern: "rm\\s+-rf\\s+/" # regex over the tool INPUT (stringified)
//     reason: destructive root delete
//   ---
//   (optional rationale prose)
//
// Evaluation: collect every matching rule, then severity wins — deny > ask >
// allow (an explicit allow can whitelist past a later ask/deny only if it is
// NOT outweighed; severity beats file order so a sloppy rule ordering can never
// silently disarm a deny).
//
// FAIL-OPEN, per item: a malformed rule file is SKIPPED (and counted in
// `skipped`), never a crash and never a block — the other rules still apply.
// The gate runs per tool call, so loads are cached on the items dir's stat
// signature (names+mtimes+sizes): re-parse only when something changed. No
// derived file — the item files stay the single source of truth.

import { join } from 'node:path';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { parseEnvelope } from './faculty/envelope.mjs';

const SEVERITY = { deny: 3, ask: 2, allow: 1 };
const ACTIONS = new Set(Object.keys(SEVERITY));

// dir → { sig, result } — tiny in-memory cache (per process; the spawned gate
// pays one cold load, long-lived processes like `zuzuu web` skip re-parses).
const cache = new Map();

/** Compile one parsed envelope item into a rule, or null if malformed. */
function compileRule(item) {
  const p = item?.payload ?? {};
  if (!item?.id || !ACTIONS.has(p.action) || typeof p.pattern !== 'string' || !p.pattern) return null;
  try {
    return { id: String(item.id), action: p.action, tool: p.tool || '*', re: new RegExp(p.pattern, 'i'), reason: String(p.reason ?? '') };
  } catch {
    return null; // uncompilable pattern → skip this rule only
  }
}

/**
 * Load the rules from a guardrails faculty dir (…/guardrails) by composing the
 * envelope items under its items/ subdir. FAIL-OPEN: a missing dir is zero
 * rules; a malformed item is skipped + counted, never a crash.
 * @param {string} guardrailsDir  the faculty dir (e.g. <home>/guardrails)
 * @returns {{ok: boolean, rules: Array, skipped: Array<{file: string, error: string}>}}
 */
export function loadRules(guardrailsDir) {
  try {
    const dir = join(guardrailsDir, 'items');
    let names;
    try {
      names = readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
    } catch {
      return { ok: true, rules: [], skipped: [] }; // no items dir → no rules (normal flow)
    }
    let sig = null;
    try {
      sig = names.map((n) => { const s = statSync(join(dir, n)); return `${n}:${s.mtimeMs}:${s.size}`; }).join('|');
      const hit = cache.get(dir);
      if (hit && hit.sig === sig) return hit.result;
    } catch { sig = null; /* stat race → just load uncached */ }

    const rules = [];
    const skipped = [];
    for (const f of names) {
      try {
        const { ok, item, errors } = parseEnvelope(readFileSync(join(dir, f), 'utf8'));
        const rule = ok ? compileRule(item) : null;
        if (rule) rules.push(rule);
        else skipped.push({ file: f, error: ok ? 'malformed rule payload' : (errors[0] ?? 'parse error') });
      } catch (e) {
        skipped.push({ file: f, error: e.message });
      }
    }
    const result = { ok: true, rules, skipped };
    if (sig != null) cache.set(dir, { sig, result });
    return result;
  } catch (e) {
    return { ok: false, rules: [], skipped: [], error: e.message }; // engine trouble → fail open
  }
}

/**
 * Evaluate a tool call against loaded rules.
 * @param {Array} rules        from loadRules().rules
 * @param {{tool:string, input:any}} call
 * @returns {null | {action:'deny'|'ask'|'allow', rule:string, reason:string}}
 *          null = no rule matched → defer to the host's normal permission flow
 */
export function evaluate(rules, { tool, input }) {
  const haystack = typeof input === 'string' ? input : JSON.stringify(input ?? {});
  let winner = null;
  for (const r of rules) {
    if (r.tool !== '*' && r.tool !== tool) continue;
    if (!r.re.test(haystack)) continue;
    if (!winner || SEVERITY[r.action] > SEVERITY[winner.action]) {
      winner = { action: r.action, rule: r.id, reason: r.reason || `matched guardrail ${r.id}` };
    }
  }
  return winner;
}

/**
 * Gemini CLI block shape: stdout JSON { decision: "deny", reason } (exit 0).
 * Gemini has no "ask" decision → defer (null) so its own approval flow runs.
 * Only an explicit deny blocks.
 */
export function toGeminiDecision(verdict) {
  if (!verdict || verdict.action !== 'deny') return null;
  return { decision: 'deny', reason: `guardrail ${verdict.rule}: ${verdict.reason}` };
}

/** Map a verdict to Claude Code's PreToolUse hookSpecificOutput (verified schema). */
export function toPreToolUseDecision(verdict) {
  if (!verdict || verdict.action === 'allow') return null; // no output → normal flow (fail-open / explicit allow)
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: verdict.action, // 'deny' | 'ask'
      permissionDecisionReason: `guardrail ${verdict.rule}: ${verdict.reason}`,
    },
  };
}
