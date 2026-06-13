// tests/unit/migrate-items.test.mjs
// W24 — the Module Standard migrator. Goldens seed a REAL pre-standard home:
// the rules.json the old scaffold actually shipped, an action.json/run.mjs pair
// authored by the old `zuzuu act new`, a SKILL.md runbook, legacy knowledge and
// memory frontmatter, and a filled project.md. Migrate, then assert envelopes,
// gate parity, and that the action still runs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateItems, needsItemsMigration } from '../../zuzuu/commands/migrations/items.mjs';
import { parseEnvelope, validateEnvelope, PAYLOAD_SCHEMAS } from '../../zuzuu/module/envelope.mjs';
import { loadRules, evaluate } from '../../zuzuu/guardrails/engine.mjs';
import { readItem } from '../../zuzuu/knowledge/items.mjs';
import { runAction } from '../../zuzuu/actions/dispatch.mjs';
import { allActions } from '../../zuzuu/actions/manifest.mjs';
import { computeDigest } from '../../zuzuu/digest/compose.mjs';

// ── the OLD shapes, verbatim ────────────────────────────────────────────────

// The exact rules.json the pre-W24 scaffold seeded (pasted, not reconstructed).
const OLD_RULES_JSON = JSON.stringify(
  {
    version: 1,
    rules: [
      { id: 'no-root-wipe', action: 'deny', tool: 'Bash', pattern: 'rm\\s+-[a-z]*r[a-z]*\\s+/(\\s|$)', reason: 'destructive delete at filesystem root' },
      { id: 'no-secret-reads', action: 'deny', tool: '*', pattern: '\\.env(\\.|\\b)|id_rsa|\\.pem\\b', reason: 'secret material should not enter the context' },
      { id: 'confirm-force-push', action: 'ask', tool: 'Bash', pattern: 'git\\b.*\\bpush\\b.*--force', reason: 'force-push rewrites shared history' },
    ],
  },
  null,
  2,
) + '\n';

// A real pre-W24 knowledge item (the old top-level-keys grammar).
const OLD_KNOWLEDGE_ITEM = `---
id: test-command
type: command
created_at: 2026-06-10T12:00:00Z
status: active
attributes:
  command: npm test
relations:
  - type: relates-to
    target: ci-pipeline
provenance:
  - session: ses_abc
    ref: occurrences=12
---
The test suite runs with npm test.
`;

// A real pre-W24 memory entry (date/provenance{sessions,hosts}/tags/status keys).
const OLD_MEMORY_ENTRY = `---
id: mem-2026-06-11-flaky-ci
date: 2026-06-11
title: Flaky CI fixed by pinning node 22
provenance:
  sessions: [ses_abc123]
  hosts: [claude-code]
tags: [ci, flaky-test]
status: curated
---
## Attempted
Pinned node 22.
## Resulted
CI green.
## Remember next time
Pin early.
`;

const OLD_ACTION_JSON = JSON.stringify({
  slug: 'greet',
  title: 'Greet someone',
  description: 'what this action does',
  promptSnippet: 'greets by name',
  inputs: { type: 'object', properties: { who: { type: 'string' } }, required: [] },
  outputs: { type: 'object' },
  default_args: { who: 'world' },
  requires: [],
}, null, 2) + '\n';

const OLD_SKILL_MD = `---
name: Deploy
description: how to ship
---

## Steps

1. \`npm run build\`
2. \`npm run deploy\`
`;

function seedOldHome() {
  const root = mkdtempSync(join(tmpdir(), 'zuzuu-migrate-items-'));
  const home = join(root, '.zuzuu');
  mkdirSync(join(home, 'knowledge', 'items'), { recursive: true });
  mkdirSync(join(home, 'memory', 'entries'), { recursive: true });
  mkdirSync(join(home, 'guardrails'), { recursive: true });
  mkdirSync(join(home, 'instructions'), { recursive: true });
  mkdirSync(join(home, 'actions', 'greet'), { recursive: true });
  mkdirSync(join(home, 'actions', 'deploy'), { recursive: true });
  mkdirSync(join(home, 'actions', 'inbox', 'proposed'), { recursive: true });
  writeFileSync(join(home, 'knowledge', 'items', 'test-command.md'), OLD_KNOWLEDGE_ITEM);
  writeFileSync(join(home, 'memory', 'entries', 'mem-2026-06-11-flaky-ci.md'), OLD_MEMORY_ENTRY);
  writeFileSync(join(home, 'guardrails', 'rules.json'), OLD_RULES_JSON);
  writeFileSync(join(home, 'instructions', 'project.md'), '# Project steering\n\nShip daily. Tests before merge.\n');
  writeFileSync(join(home, 'actions', 'greet', 'action.json'), OLD_ACTION_JSON);
  writeFileSync(join(home, 'actions', 'greet', 'run.mjs'), 'export async function main(args){ return { msg: `hi ${args.who}` }; }');
  writeFileSync(join(home, 'actions', 'deploy', 'SKILL.md'), OLD_SKILL_MD);
  writeFileSync(join(home, 'actions', 'inbox', 'proposed', 'action.json'), JSON.stringify({ slug: 'proposed', promptSnippet: 'a proposed thing' }));
  return { root, home };
}

function withOldHome(fn) {
  const { root, home } = seedOldHome();
  try {
    return fn(home);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ── goldens ─────────────────────────────────────────────────────────────────

test('needsItemsMigration detects every old shape; clean homes say no', () => {
  withOldHome((home) => {
    assert.equal(needsItemsMigration(home), true);
    migrateItems(home);
    assert.equal(needsItemsMigration(home), false, 'after migration nothing is left to migrate');
  });
});

test('migrateItems converts every module and reports the summary', () => {
  withOldHome((home) => {
    const r = migrateItems(home);
    assert.deepEqual(r.errors, []);
    assert.equal(r.knowledge, 1);
    assert.equal(r.memory, 1);
    assert.equal(r.guardrails, 3);
    assert.equal(r.actions, 3, 'greet + deploy + the proposed inbox action');
    assert.equal(r.instructions, 1);
  });
});

test('knowledge: keys standardise, ids and in-memory shape unchanged', () => {
  withOldHome((home) => {
    migrateItems(home);
    const raw = readFileSync(join(home, 'knowledge', 'items', 'test-command.md'), 'utf8');
    const { ok, item } = parseEnvelope(raw);
    assert.ok(ok);
    assert.equal(item.module, 'knowledge');
    assert.equal(item.payload.type, 'command');
    assert.ok(validateEnvelope(item, PAYLOAD_SCHEMAS.knowledge).ok);
    // the knowledge wrapper still reads the historical shape — same id, same fields
    const k = readItem(home, 'test-command');
    assert.equal(k.id, 'test-command');
    assert.equal(k.type, 'command');
    assert.equal(k.attributes.command, 'npm test');
    assert.deepEqual(k.relations, [{ type: 'relates-to', target: 'ci-pipeline' }]);
    assert.deepEqual(k.provenance, [{ session: 'ses_abc', ref: 'occurrences=12' }]);
    assert.equal(k.created_at, '2026-06-10T12:00:00Z');
  });
});

test('memory: legacy episode keys map onto the envelope', () => {
  withOldHome((home) => {
    migrateItems(home);
    const { ok, item } = parseEnvelope(readFileSync(join(home, 'memory', 'entries', 'mem-2026-06-11-flaky-ci.md'), 'utf8'));
    assert.ok(ok);
    assert.equal(item.kind, 'episode');
    assert.equal(item.title, 'Flaky CI fixed by pinning node 22');
    assert.equal(item.created_at, '2026-06-11');
    assert.deepEqual(item.payload.sessions, ['ses_abc123']);
    assert.deepEqual(item.payload.hosts, ['claude-code']);
    assert.deepEqual(item.payload.tags, ['ci', 'flaky-test']);
    assert.ok(item.body.includes('## Remember next time'));
    assert.ok(validateEnvelope(item, PAYLOAD_SCHEMAS.memory).ok);
  });
});

test('guardrails: rules.json explodes into items with GATE PARITY, then disappears', () => {
  withOldHome((home) => {
    // verdicts BEFORE (computed from the raw rules.json semantics) are the golden:
    // deny root-wipe · deny .env read · ask force-push · silence on ls
    migrateItems(home);
    assert.ok(!existsSync(join(home, 'guardrails', 'rules.json')), 'rules.json deleted after explosion');
    const { ok, rules, skipped } = loadRules(join(home, 'guardrails'));
    assert.ok(ok);
    assert.equal(rules.length, 3);
    assert.deepEqual(skipped, []);
    const verdict = (tool, input) => evaluate(rules, { tool, input });
    assert.equal(verdict('Bash', { command: 'rm -rf / ' })?.action, 'deny');
    assert.equal(verdict('Bash', { command: 'rm -rf / ' })?.rule, 'no-root-wipe');
    assert.equal(verdict('Read', { file_path: '/app/.env' })?.action, 'deny');
    assert.equal(verdict('Bash', { command: 'git -C /x push --force-with-lease origin main' })?.action, 'ask', 'the exp-8 bypass still caught');
    assert.equal(verdict('Bash', { command: 'ls -la' }), null, 'no spurious matches');
  });
});

test('actions: action.json → ACTION.md and the action STILL RUNS (defaults intact)', () => {
  withOldHome((home) => {
    migrateItems(home);
    const dir = join(home, 'actions', 'greet');
    assert.ok(existsSync(join(dir, 'ACTION.md')));
    assert.ok(!existsSync(join(dir, 'action.json')), 'legacy manifest removed');
    const { ok, item } = parseEnvelope(readFileSync(join(dir, 'ACTION.md'), 'utf8'));
    assert.ok(ok);
    assert.equal(item.kind, 'script');
    assert.equal(item.payload.exec, 'run.mjs');
    assert.deepEqual(item.payload.args, { who: 'world' });
    assert.ok(validateEnvelope(item, PAYLOAD_SCHEMAS.actions).ok);
    // runnable, with the old default_args still applied
    const r = runAction(home, 'greet', {});
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(r.value, { msg: 'hi world' });
    // the SKILL.md runbook converted too, body preserved
    const dep = parseEnvelope(readFileSync(join(home, 'actions', 'deploy', 'ACTION.md'), 'utf8'));
    assert.ok(dep.ok);
    assert.equal(dep.item.kind, 'runbook');
    assert.equal(dep.item.title, 'Deploy');
    assert.ok(dep.item.body.includes('npm run build'));
    assert.ok(!existsSync(join(home, 'actions', 'deploy', 'SKILL.md')));
    // listing sees both + not the inbox one
    assert.deepEqual(allActions(home).map((a) => a.slug).sort(), ['deploy', 'greet']);
  });
});

test('instructions: project.md becomes the steering item the digest reads', () => {
  withOldHome((home) => {
    migrateItems(home);
    assert.ok(!existsSync(join(home, 'instructions', 'project.md')));
    const { ok, item } = parseEnvelope(readFileSync(join(home, 'instructions', 'items', 'steering.md'), 'utf8'));
    assert.ok(ok);
    assert.equal(item.kind, 'steering');
    assert.ok(item.body.includes('Ship daily.'));
    const d = computeDigest(home);
    assert.match(d.text, /Ship daily\./);
    assert.doesNotMatch(d.text, /steering is empty/i);
  });
});

test('idempotent: a second run converts nothing and breaks nothing', () => {
  withOldHome((home) => {
    migrateItems(home);
    const before = readFileSync(join(home, 'knowledge', 'items', 'test-command.md'), 'utf8');
    const r2 = migrateItems(home);
    assert.equal(r2.knowledge + r2.memory + r2.guardrails + r2.actions + r2.instructions, 0);
    assert.deepEqual(r2.errors, []);
    assert.equal(readFileSync(join(home, 'knowledge', 'items', 'test-command.md'), 'utf8'), before, 'byte-identical');
  });
});

test('fail-soft: one broken legacy item is reported, the rest convert', () => {
  withOldHome((home) => {
    writeFileSync(join(home, 'knowledge', 'items', 'broken.md'), 'no frontmatter at all');
    const r = migrateItems(home);
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0].file, /broken\.md/);
    assert.equal(r.knowledge, 1, 'the good item still converted');
    assert.equal(r.guardrails, 3);
  });
});

test('a customized steering item is never clobbered by project.md', () => {
  withOldHome((home) => {
    mkdirSync(join(home, 'instructions', 'items'), { recursive: true });
    writeFileSync(join(home, 'instructions', 'items', 'steering.md'), '---\nid: steering\nmodule: instructions\nkind: steering\ntitle: Mine\nstatus: active\ncreated_at: 2026-06-12\n---\nMY steering\n');
    const r = migrateItems(home);
    assert.ok(r.errors.some((e) => /merge by hand/.test(e.error)));
    assert.ok(existsSync(join(home, 'instructions', 'project.md')), 'project.md left for the human');
    const { item } = parseEnvelope(readFileSync(join(home, 'instructions', 'items', 'steering.md'), 'utf8'));
    assert.equal(item.body, 'MY steering');
  });
});
