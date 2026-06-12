import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRules, evaluate, toPreToolUseDecision, toGeminiDecision } from '../../zuzuu/guardrails.mjs';
import { LAYOUT } from '../../zuzuu/scaffold.mjs';

function withRulesFile(content, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'zuzuu-guard-'));
  const path = join(dir, 'rules.json');
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content));
  try {
    return fn(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const RULES = {
  version: 1,
  rules: [
    { id: 'no-root-wipe', action: 'deny', tool: 'Bash', pattern: 'rm\\s+-rf\\s+/(\\s|$)', reason: 'root wipe' },
    { id: 'ask-force-push', action: 'ask', tool: 'Bash', pattern: 'git\\s+push\\s+.*--force', reason: 'history rewrite' },
    { id: 'no-secrets', action: 'deny', tool: '*', pattern: '\\.env\\b', reason: 'secrets' },
    { id: 'allow-env-example', action: 'allow', tool: '*', pattern: '\\.env\\.example', reason: 'sample file is fine' },
  ],
};

test('loadRules parses valid rules; rejects malformed (fail-open)', () => {
  withRulesFile(RULES, (p) => {
    const r = loadRules(p);
    assert.equal(r.ok, true);
    assert.equal(r.rules.length, 4);
  });
  withRulesFile('{ not json', (p) => assert.equal(loadRules(p).ok, false));
  withRulesFile({ rules: [{ id: 'x', action: 'explode', pattern: '.' }] }, (p) => assert.equal(loadRules(p).ok, false));
  withRulesFile({ rules: [{ id: 'x', action: 'deny', pattern: '([' }] }, (p) => assert.equal(loadRules(p).ok, false), 'bad regex');
  assert.equal(loadRules('/nonexistent/rules.json').ok, false);
});

test('evaluate: tool-scoped match, no-match returns null', () => {
  withRulesFile(RULES, (p) => {
    const { rules } = loadRules(p);
    assert.equal(evaluate(rules, { tool: 'Bash', input: { command: 'ls -la' } }), null);
    const hit = evaluate(rules, { tool: 'Bash', input: { command: 'rm -rf / ' } });
    assert.equal(hit.action, 'deny');
    assert.equal(hit.rule, 'no-root-wipe');
    // Bash-scoped rule must not fire for other tools
    assert.equal(evaluate(rules, { tool: 'Write', input: { content: 'rm -rf / ' } }), null);
  });
});

test('evaluate: severity wins — deny beats ask beats allow', () => {
  withRulesFile(RULES, (p) => {
    const { rules } = loadRules(p);
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
  withRulesFile(LAYOUT.files['.zuzuu/guardrails/rules.json'], (p) => {
    const { rules } = loadRules(p);
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
