// tests/unit/faculty-adapters.test.mjs
// WS2-T4 — Guardrails, Instructions, Memory faculty adapters.
// TDD: written first, verified against the implementation below.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Self-registers each adapter on import:
import '../../zuzuu/guardrails/adapter.mjs';
import '../../zuzuu/instructions/adapter.mjs';
import '../../zuzuu/memory/adapter.mjs';

import * as registry from '../../zuzuu/faculty/registry.mjs';
import * as gate from '../../zuzuu/faculty/gate.mjs';
import { writeProposal, makeProposal } from '../../zuzuu/faculty/proposal.mjs';
import { applyScaffold, LAYOUT } from '../../zuzuu/scaffold.mjs';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function withHome(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'mns-fadapters-'));
  const mnsDir = join(dir, '.mns');
  mkdirSync(mnsDir, { recursive: true });
  try {
    return fn(mnsDir, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Ensure a faculty's proposals dir exists (adapters may rely on it for apply)
function ensureProposalsDir(mnsDir, faculty) {
  mkdirSync(join(mnsDir, faculty, 'proposals'), { recursive: true });
}

// ---------------------------------------------------------------------------
// Guardrails adapter
// ---------------------------------------------------------------------------

test('guardrails adapter: registered with correct contract', () => {
  const a = registry.get('guardrails');
  assert.ok(a, 'guardrails adapter registered');
  assert.equal(a.name, 'guardrails');
  for (const fn of ['ingest', 'validate', 'apply', 'render']) {
    assert.equal(typeof a[fn], 'function', `${fn} is a function`);
  }
});

test('guardrails adapter.validate: accepts a well-formed rule', () => {
  const a = registry.get('guardrails');
  const r = a.validate(null, {
    id: 'no-rm-rf',
    action: 'deny',
    tool: 'Bash',
    pattern: 'rm\\s+-rf',
    reason: 'destructive delete',
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.errors, []);
});

test('guardrails adapter.validate: rejects missing id', () => {
  const a = registry.get('guardrails');
  const r = a.validate(null, { action: 'deny', tool: 'Bash', pattern: 'rm', reason: 'bad' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /id/.test(e)), 'error mentions id');
});

test('guardrails adapter.validate: rejects invalid action', () => {
  const a = registry.get('guardrails');
  const r = a.validate(null, { id: 'x', action: 'yell', tool: '*', pattern: 'foo', reason: 'bad' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /action/.test(e)));
});

test('guardrails adapter.validate: rejects invalid regex pattern', () => {
  const a = registry.get('guardrails');
  const r = a.validate(null, { id: 'y', action: 'deny', tool: '*', pattern: '(unclosed', reason: 'bad regex' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /pattern/.test(e)));
});

test('guardrails adapter.validate: rejects empty reason', () => {
  const a = registry.get('guardrails');
  const r = a.validate(null, { id: 'z', action: 'allow', tool: '*', pattern: 'foo', reason: '' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /reason/.test(e)));
});

test('guardrails gate.approve: appends rule to rules.json', () => {
  withHome((mnsDir) => {
    ensureProposalsDir(mnsDir, 'guardrails');
    const rule = { id: 'block-curl', action: 'deny', tool: 'Bash', pattern: 'curl\\s+.*secret', reason: 'exfil risk' };
    const p = makeProposal({ faculty: 'guardrails', kind: 'rule', source: 'test', payload: rule });
    writeProposal(mnsDir, p);

    const r = gate.approve(mnsDir, 'guardrails', p.id);
    assert.ok(r.ok, JSON.stringify(r));
    assert.match(r.action, /block-curl/);

    // rules.json now contains the rule
    const rulesPath = join(mnsDir, 'guardrails', 'rules.json');
    assert.ok(existsSync(rulesPath), 'rules.json created');
    const data = JSON.parse(readFileSync(rulesPath, 'utf8'));
    assert.ok(Array.isArray(data.rules), 'rules is array');
    assert.ok(data.rules.some((x) => x.id === 'block-curl'), 'rule present');
  });
});

test('guardrails gate.approve: replaces existing rule with same id', () => {
  withHome((mnsDir) => {
    ensureProposalsDir(mnsDir, 'guardrails');
    // Seed an existing rules.json with the same id
    mkdirSync(join(mnsDir, 'guardrails'), { recursive: true });
    writeFileSync(join(mnsDir, 'guardrails', 'rules.json'), JSON.stringify({
      version: 1,
      rules: [{ id: 'my-rule', action: 'ask', tool: 'Bash', pattern: 'old', reason: 'old reason' }],
    }));

    const rule = { id: 'my-rule', action: 'deny', tool: 'Bash', pattern: 'new', reason: 'updated reason' };
    const p = makeProposal({ faculty: 'guardrails', kind: 'rule', source: 'test', payload: rule });
    writeProposal(mnsDir, p);

    const r = gate.approve(mnsDir, 'guardrails', p.id);
    assert.ok(r.ok, JSON.stringify(r));

    const data = JSON.parse(readFileSync(join(mnsDir, 'guardrails', 'rules.json'), 'utf8'));
    assert.equal(data.rules.filter((x) => x.id === 'my-rule').length, 1, 'no duplicate rule');
    assert.equal(data.rules.find((x) => x.id === 'my-rule').action, 'deny', 'updated');
  });
});

test('guardrails adapter.render: returns line and card mentioning action and pattern', () => {
  const a = registry.get('guardrails');
  const r = a.render({
    payload: { id: 'no-env', action: 'deny', tool: '*', pattern: '\\.env', reason: 'secrets' },
  });
  assert.ok(typeof r.line === 'string' && r.line.length > 0, 'line non-empty');
  assert.ok(typeof r.card === 'string' && r.card.length > 0, 'card non-empty');
  assert.ok(r.line.includes('deny'), 'line mentions action');
  assert.ok(r.line.includes('secrets'), 'line mentions reason');
});

// ---------------------------------------------------------------------------
// Instructions adapter
// ---------------------------------------------------------------------------

test('instructions adapter: registered with correct contract', () => {
  const a = registry.get('instructions');
  assert.ok(a, 'instructions adapter registered');
  assert.equal(a.name, 'instructions');
  for (const fn of ['ingest', 'validate', 'apply', 'render']) {
    assert.equal(typeof a[fn], 'function', `${fn} is a function`);
  }
});

test('instructions adapter.validate: accepts non-empty text', () => {
  const a = registry.get('instructions');
  const r = a.validate(null, { text: 'always use typescript strict mode' });
  assert.equal(r.ok, true, JSON.stringify(r));
});

test('instructions adapter.validate: rejects empty text', () => {
  const a = registry.get('instructions');
  const r = a.validate(null, { text: '' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /text/.test(e)));
});

test('instructions adapter.validate: rejects missing text', () => {
  const a = registry.get('instructions');
  const r = a.validate(null, {});
  assert.equal(r.ok, false);
});

test('instructions gate.approve: appends text to project.md', () => {
  withHome((mnsDir) => {
    ensureProposalsDir(mnsDir, 'instructions');
    const p = makeProposal({
      faculty: 'instructions', kind: 'amendment', source: 'test',
      payload: { text: 'prefer immutable data structures' },
    });
    writeProposal(mnsDir, p);

    const r = gate.approve(mnsDir, 'instructions', p.id);
    assert.ok(r.ok, JSON.stringify(r));
    assert.match(r.action, /amended instructions/);

    const projectMd = join(mnsDir, 'instructions', 'project.md');
    assert.ok(existsSync(projectMd), 'project.md created');
    const content = readFileSync(projectMd, 'utf8');
    assert.ok(content.includes('prefer immutable data structures'), 'text appended');
  });
});

test('instructions gate.approve: re-applying the same text does not duplicate', () => {
  withHome((mnsDir) => {
    mkdirSync(join(mnsDir, 'instructions', 'proposals'), { recursive: true });

    // Approve once
    const p1 = makeProposal({
      faculty: 'instructions', kind: 'amendment', source: 'test',
      payload: { text: 'use strict mode' },
    });
    writeProposal(mnsDir, p1);
    gate.approve(mnsDir, 'instructions', p1.id);

    // Approve again (different proposal id but same text)
    const p2 = makeProposal({
      faculty: 'instructions', kind: 'amendment', source: 'test2',
      payload: { text: 'use strict mode' },
    });
    writeProposal(mnsDir, p2);
    gate.approve(mnsDir, 'instructions', p2.id);

    const content = readFileSync(join(mnsDir, 'instructions', 'project.md'), 'utf8');
    const occurrences = (content.match(/use strict mode/g) || []).length;
    assert.equal(occurrences, 1, 'text not duplicated');
  });
});

test('instructions adapter.render: returns line and card with the text', () => {
  const a = registry.get('instructions');
  const r = a.render({ payload: { text: 'always run tests before commit' } });
  assert.ok(typeof r.line === 'string' && r.line.length > 0, 'line non-empty');
  assert.ok(r.card.includes('always run tests before commit'), 'card shows text');
});

// ---------------------------------------------------------------------------
// Memory adapter
// ---------------------------------------------------------------------------

test('memory adapter: registered with correct contract', () => {
  const a = registry.get('memory');
  assert.ok(a, 'memory adapter registered');
  assert.equal(a.name, 'memory');
  for (const fn of ['ingest', 'validate', 'apply', 'render']) {
    assert.equal(typeof a[fn], 'function', `${fn} is a function`);
  }
});

test('memory adapter.validate: accepts a well-formed episode', () => {
  const a = registry.get('memory');
  const r = a.validate(null, {
    id: 'mem-2026-06-11-flaky-ci',
    date: '2026-06-11',
    title: 'Flaky CI fixed by pinning node 22',
    provenance: { sessions: [], hosts: [] },
    body: '## Attempted\nStuff\n## Resulted\nFixed\n## Remember next time\nPin node.',
  });
  assert.equal(r.ok, true, JSON.stringify(r));
});

test('memory adapter.validate: rejects bad id format', () => {
  const a = registry.get('memory');
  const r = a.validate(null, {
    id: 'not-a-mem-id',
    title: 'some title',
    body: 'body',
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /id/.test(e)));
});

test('memory adapter.validate: rejects missing title', () => {
  const a = registry.get('memory');
  const r = a.validate(null, { id: 'mem-2026-06-11-test', body: 'body' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /title/.test(e)));
});

test('memory gate.approve: writes entry file with frontmatter', () => {
  withHome((mnsDir) => {
    ensureProposalsDir(mnsDir, 'memory');
    const episode = {
      id: 'mem-2026-06-11-ci-fix',
      date: '2026-06-11',
      title: 'CI fixed by pinning node 22',
      provenance: { sessions: ['ses_abc123'], hosts: ['claude-code'] },
      body: '## Attempted\nUpgraded node.\n## Resulted\nCI green.\n## Remember next time\nPin node version.',
    };
    const p = makeProposal({ faculty: 'memory', kind: 'episode', source: 'test', payload: episode });
    writeProposal(mnsDir, p);

    const r = gate.approve(mnsDir, 'memory', p.id);
    assert.ok(r.ok, JSON.stringify(r));
    assert.match(r.action, /mem-2026-06-11-ci-fix/);

    const entryPath = join(mnsDir, 'memory', 'entries', 'mem-2026-06-11-ci-fix.md');
    assert.ok(existsSync(entryPath), 'entry file written');
    const content = readFileSync(entryPath, 'utf8');
    assert.ok(content.includes('status: curated'), 'frontmatter has curated status');
    assert.ok(content.includes('CI fixed by pinning node 22'), 'title in frontmatter');
    assert.ok(content.includes('## Remember next time'), 'body section present');
  });
});

test('memory adapter.validate: rejects missing id entirely', () => {
  const a = registry.get('memory');
  const r = a.validate(null, { title: 'some title', body: 'body' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /id/.test(e)));
});

test('memory adapter.render: returns line and card with title and date', () => {
  const a = registry.get('memory');
  const r = a.render({
    payload: {
      id: 'mem-2026-06-11-test',
      date: '2026-06-11',
      title: 'Test episode',
    },
  });
  assert.ok(typeof r.line === 'string' && r.line.length > 0, 'line non-empty');
  assert.ok(r.card.includes('Test episode'), 'card shows title');
});

// ---------------------------------------------------------------------------
// Scaffold: new inbox/proposals dirs for guardrails, instructions, memory
// ---------------------------------------------------------------------------

test('scaffold LAYOUT.dirs includes inbox and proposals for guardrails/instructions/memory', () => {
  const expected = [
    'agent/guardrails/inbox', 'agent/guardrails/proposals',
    'agent/instructions/inbox', 'agent/instructions/proposals',
    'agent/memory/inbox', 'agent/memory/proposals',
  ];
  for (const d of expected) {
    assert.ok(LAYOUT.dirs.includes(d), `LAYOUT.dirs includes ${d}`);
  }
});

test('applyScaffold creates new inbox/proposals dirs for all three new faculties', () => {
  withHome((_mnsDir, cwd) => {
    applyScaffold(cwd);
    for (const d of [
      'agent/guardrails/inbox', 'agent/guardrails/proposals',
      'agent/instructions/inbox', 'agent/instructions/proposals',
      'agent/memory/inbox', 'agent/memory/proposals',
    ]) {
      assert.ok(existsSync(join(cwd, d)), `${d} created by applyScaffold`);
    }
  });
});
