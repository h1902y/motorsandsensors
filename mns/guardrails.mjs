// The Guardrails faculty — v1 rule engine (pure; I/O lives in the hook command).
//
// Rules are DATA, not code: .mns/guardrails/rules.json, ordered, declarative —
// a *definition* in the pin-definitions sense (versioned in git, graduates via
// proposals like every faculty's contents).
//
//   { "version": 1,
//     "rules": [ { "id": "no-root-wipe", "action": "deny",
//                  "tool": "Bash",              // exact tool name, or "*"
//                  "pattern": "rm\\s+-rf\\s+/", // regex over the tool INPUT (stringified)
//                  "reason": "destructive root delete" } ] }
//
// Evaluation: collect every matching rule, then severity wins — deny > ask >
// allow (an explicit allow can whitelist past a later ask/deny only if it is
// NOT outweighed; severity beats file order so a sloppy rule ordering can never
// silently disarm a deny).
//
// FAIL-OPEN: any malformed rule/file yields { ok:false } and no decision — the
// host proceeds through its normal permission flow. A guardrail bug must never
// brick the agent; misses are logged, not fatal.

import { readFileSync } from 'node:fs';

const SEVERITY = { deny: 3, ask: 2, allow: 1 };
const ACTIONS = new Set(Object.keys(SEVERITY));

/** Parse + validate a rules file. Fail-open: returns ok:false on any problem. */
export function loadRules(path) {
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(data.rules)) return { ok: false, rules: [], error: 'rules is not an array' };
    const rules = [];
    for (const r of data.rules) {
      if (!r || typeof r !== 'object' || !ACTIONS.has(r.action) || typeof r.pattern !== 'string') {
        return { ok: false, rules: [], error: `malformed rule: ${JSON.stringify(r).slice(0, 80)}` };
      }
      try {
        rules.push({ id: String(r.id ?? `rule-${rules.length}`), action: r.action, tool: r.tool || '*', re: new RegExp(r.pattern, 'i'), reason: String(r.reason ?? '') });
      } catch (e) {
        return { ok: false, rules: [], error: `bad pattern in ${r.id}: ${e.message}` };
      }
    }
    return { ok: true, rules };
  } catch (e) {
    return { ok: false, rules: [], error: e.message };
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
