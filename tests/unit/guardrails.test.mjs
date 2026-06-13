import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRules, evaluate, toPreToolUseDecision, toGeminiDecision } from '../../zuzuu/guardrails/engine.mjs';
import { serializeEnvelope } from '../../zuzuu/module/envelope.mjs';
import { LAYOUT } from '../../zuzuu/home/scaffold.mjs';

// Build a throwaway guardrails module dir with one envelope item per rule.
// `files` may also carry raw text values (malformed-item cases).
function withRuleItems(files, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'zuzuu-guard-'));
  const guardrailsDir = join(dir, 'guardrails');
  mkdirSync(join(guardrailsDir, 'items'), { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(guardrailsDir, 'items', name), content);
  }
  try {
    return fn(guardrailsDir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const rule = ({ id, action, tool = '*', pattern, reason }) =>
  serializeEnvelope({
    id, module: 'guardrails', kind: 'rule', title: reason, status: 'active',
    created_at: '2026-06-12T00:00:00Z', payload: { action, tool, pattern, reason }, body: '',
  });

const RULES = {
  'no-root-wipe.md': rule({ id: 'no-root-wipe', action: 'deny', tool: 'Bash', pattern: 'rm\\s+-rf\\s+/(\\s|$)', reason: 'root wipe' }),
  'ask-force-push.md': rule({ id: 'ask-force-push', action: 'ask', tool: 'Bash', pattern: 'git\\s+push\\s+.*--force', reason: 'history rewrite' }),
  'no-secrets.md': rule({ id: 'no-secrets', action: 'deny', tool: '*', pattern: '\\.env\\b', reason: 'secrets' }),
  'allow-env-example.md': rule({ id: 'allow-env-example', action: 'allow', tool: '*', pattern: '\\.env\\.example', reason: 'sample file is fine' }),
};

test('loadRules composes envelope items; missing dir is zero rules (fail-open)', () => {
  withRuleItems(RULES, (gd) => {
    const r = loadRules(gd);
    assert.equal(r.ok, true);
    assert.equal(r.rules.length, 4);
    assert.deepEqual(r.skipped, []);
  });
  const empty = loadRules('/nonexistent/guardrails');
  assert.equal(empty.ok, true);
  assert.deepEqual(empty.rules, []);
});

test('loadRules: a malformed item is skipped + counted — the others still load', () => {
  withRuleItems(
    {
      ...RULES,
      'not-an-envelope.md': '{ this is not an envelope at all',
      'bad-action.md': rule({ id: 'bad-action', action: 'deny', pattern: 'x', reason: 'r' }).replace('action: deny', 'action: explode'),
      'bad-regex.md': rule({ id: 'bad-regex', action: 'deny', pattern: 'PLACEHOLDER', reason: 'r' }).replace('pattern: PLACEHOLDER', 'pattern: "(["'),
    },
    (gd) => {
      const r = loadRules(gd);
      assert.equal(r.ok, true, 'malformed items never sink the load');
      assert.equal(r.rules.length, 4, 'the 4 good rules survive');
      assert.equal(r.skipped.length, 3, 'each malformed item counted');
      const verdict = evaluate(r.rules, { tool: 'Bash', input: { command: 'rm -rf / ' } });
      assert.equal(verdict?.action, 'deny', 'good rules still enforce');
    },
  );
});

test('loadRules caches on the items dir signature (same result object back)', () => {
  withRuleItems(RULES, (gd) => {
    const first = loadRules(gd);
    const second = loadRules(gd);
    assert.equal(first, second, 'unchanged dir → cached result');
    writeFileSync(join(gd, 'items', 'extra.md'), rule({ id: 'extra', action: 'ask', pattern: 'zzz', reason: 'new rule' }));
    const third = loadRules(gd);
    assert.equal(third.rules.length, 5, 'a new item invalidates the cache');
  });
});

test('evaluate: tool-scoped match, no-match returns null', () => {
  withRuleItems(RULES, (gd) => {
    const { rules } = loadRules(gd);
    assert.equal(evaluate(rules, { tool: 'Bash', input: { command: 'ls -la' } }), null);
    const hit = evaluate(rules, { tool: 'Bash', input: { command: 'rm -rf / ' } });
    assert.equal(hit.action, 'deny');
    assert.equal(hit.rule, 'no-root-wipe');
    // Bash-scoped rule must not fire for other tools
    assert.equal(evaluate(rules, { tool: 'Write', input: { content: 'rm -rf / ' } }), null);
  });
});

test('evaluate: severity wins — deny beats ask beats allow', () => {
  withRuleItems(RULES, (gd) => {
    const { rules } = loadRules(gd);
    // matches both no-secrets (deny) and allow-env-example (allow) → deny wins
    const both = evaluate(rules, { tool: 'Read', input: { file_path: '/app/.env.example' } });
    assert.equal(both.action, 'deny');
    const ask = evaluate(rules, { tool: 'Bash', input: { command: 'git push origin main --force' } });
    assert.equal(ask.action, 'ask');
  });
});

test('seeded force-push rule catches the real exp-8 bypass (git -C … --force-with-lease)', () => {
  // Pasted from a real live-fire session (exp-8): the agent ran this exact
  // command and the old adjacent `git\s+push` pattern let it through the gate.
  const seeds = {
    'no-root-wipe.md': LAYOUT.files['.zuzuu/guardrails/items/no-root-wipe.md'],
    'no-secret-reads.md': LAYOUT.files['.zuzuu/guardrails/items/no-secret-reads.md'],
    'confirm-force-push.md': LAYOUT.files['.zuzuu/guardrails/items/confirm-force-push.md'],
  };
  withRuleItems(seeds, (gd) => {
    const { rules } = loadRules(gd);
    assert.equal(rules.length, 3, 'all three seed items load');
    const bypass = evaluate(rules, {
      tool: 'Bash',
      input: { command: 'git -C /Users/hkc/Documents/home-livefire-2 push --force-with-lease origin main' },
    });
    assert.equal(bypass?.action, 'ask');
    assert.equal(bypass?.rule, 'confirm-force-push');
    // the plain form still matches; a plain push still doesn't
    assert.equal(evaluate(rules, { tool: 'Bash', input: { command: 'git push --force origin main' } })?.action, 'ask');
    assert.equal(evaluate(rules, { tool: 'Bash', input: { command: 'git push origin main' } }), null);
  });
});

test('toGeminiDecision: deny → {decision:deny,reason}; ask/allow → null (defer)', () => {
  assert.deepEqual(
    toGeminiDecision({ action: 'deny', rule: 'no-secret-reads', reason: 'secrets' }),
    { decision: 'deny', reason: 'guardrail no-secret-reads: secrets' },
  );
  assert.equal(toGeminiDecision({ action: 'ask', rule: 'r', reason: 'x' }), null);
  assert.equal(toGeminiDecision({ action: 'allow', rule: 'r', reason: 'x' }), null);
  assert.equal(toGeminiDecision(null), null);
});

test('toPreToolUseDecision maps to the verified hookSpecificOutput schema', () => {
  const d = toPreToolUseDecision({ action: 'deny', rule: 'r1', reason: 'because' });
  assert.deepEqual(d, {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: 'guardrail r1: because',
    },
  });
  assert.equal(toPreToolUseDecision(null), null);
  assert.equal(toPreToolUseDecision({ action: 'allow', rule: 'r2', reason: 'ok' }), null, 'allow → silent (normal flow)');
});
