import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEnvelope, serializeEnvelope, validateEnvelope, deriveTitle, PAYLOAD_SCHEMAS, FACULTY_KINDS } from '../../zuzuu/faculty/envelope.mjs';

// ── round-trip ──────────────────────────────────────────────────────────────

const KNOWLEDGE_ITEM = {
  id: 'test-command',
  faculty: 'knowledge',
  kind: 'command',
  title: 'The test command',
  status: 'active',
  created_at: '2026-06-12T00:00:00Z',
  provenance: [{ session: 'ses_1', ref: 'occurrences=3' }],
  payload: {
    type: 'command',
    attributes: { command: 'npm test', domain: 'testing' },
    relations: [{ type: 'relates-to', target: 'ci-pipeline', commentary: 'runs there' }],
  },
  body: 'The test suite runs with npm test.',
};

test('envelope round-trip: parse(serialize(x)) preserves everything', () => {
  const { ok, item, errors } = parseEnvelope(serializeEnvelope(KNOWLEDGE_ITEM));
  assert.deepEqual(errors, []);
  assert.ok(ok);
  assert.deepEqual(item, KNOWLEDGE_ITEM);
});

test('envelope round-trip survives regex backslashes and special chars (guardrails)', () => {
  const rule = {
    id: 'no-root-wipe',
    faculty: 'guardrails',
    kind: 'rule',
    title: 'No root wipe',
    status: 'active',
    created_at: '2026-06-12T00:00:00Z',
    provenance: [],
    payload: { action: 'deny', tool: 'Bash', pattern: 'rm\\s+-[a-z]*r[a-z]*\\s+/(\\s|$)', reason: 'destructive: root delete' },
    body: '',
  };
  const text = serializeEnvelope(rule);
  const { ok, item } = parseEnvelope(text);
  assert.ok(ok);
  assert.equal(item.payload.pattern, rule.payload.pattern, 'backslashes exact through quoting');
  assert.equal(item.payload.reason, rule.payload.reason);
  assert.ok(new RegExp(item.payload.pattern, 'i').test('rm -rf / '), 'pattern still matches after round-trip');
});

test('envelope round-trip: scalar lists (memory sessions/hosts/tags)', () => {
  const mem = {
    id: 'mem-2026-06-11-flaky-ci',
    faculty: 'memory',
    kind: 'episode',
    title: 'Flaky CI fixed by pinning node 22',
    status: 'active',
    created_at: '2026-06-11',
    provenance: [],
    payload: { sessions: ['ses_abc123', 'ses_def456'], hosts: ['claude-code'], tags: ['ci', 'flaky-test'] },
    body: '## Attempted\nPinned node.\n## Remember next time\nPin early.',
  };
  const { ok, item } = parseEnvelope(serializeEnvelope(mem));
  assert.ok(ok);
  assert.deepEqual(item, mem);
});

test('parseEnvelope: structural errors collected, never thrown', () => {
  assert.equal(parseEnvelope('no frontmatter').ok, false);
  const noId = parseEnvelope('---\nfaculty: memory\nkind: episode\n---\nbody');
  assert.equal(noId.ok, false);
  assert.ok(noId.errors.some((e) => /missing id/.test(e)));
  const rogue = parseEnvelope('---\nid: x\nfaculty: memory\nkind: episode\n  rogue: indent\n---\n');
  assert.equal(rogue.ok, false);
  assert.ok(rogue.errors.some((e) => /unexpected indented/.test(e)));
});

// ── validation per faculty schema ───────────────────────────────────────────

test('validateEnvelope: envelope field errors', () => {
  const base = { ...KNOWLEDGE_ITEM };
  assert.ok(validateEnvelope(base, PAYLOAD_SCHEMAS.knowledge).ok);
  assert.ok(!validateEnvelope({ ...base, id: 'Bad Id!' }).ok);
  assert.ok(!validateEnvelope({ ...base, faculty: 'vibes' }).ok);
  assert.ok(!validateEnvelope({ ...base, title: '' }).ok);
  assert.ok(!validateEnvelope({ ...base, status: 'pending' }).ok);
  assert.ok(!validateEnvelope({ ...base, created_at: 'yesterday' }).ok);
});

test('validateEnvelope: kind is per-faculty (knowledge open / others pinned)', () => {
  // knowledge kinds are registry-governed → any slug passes the envelope check
  assert.ok(validateEnvelope({ ...KNOWLEDGE_ITEM, kind: 'decision', payload: { type: 'decision' } }, PAYLOAD_SCHEMAS.knowledge).ok);
  const mem = { id: 'mem-x', faculty: 'memory', kind: 'fact', title: 't', status: 'active', created_at: '2026-06-12', payload: {}, body: '' };
  const v = validateEnvelope(mem, PAYLOAD_SCHEMAS.memory);
  assert.ok(!v.ok);
  assert.ok(v.errors.some((e) => /episode/.test(e)));
  assert.deepEqual(FACULTY_KINDS.guardrails, ['rule']);
});

test('validateEnvelope: guardrails payload schema (enum + required)', () => {
  const rule = (payload) => ({ id: 'r1', faculty: 'guardrails', kind: 'rule', title: 'r', status: 'active', created_at: '2026-06-12', payload, body: '' });
  assert.ok(validateEnvelope(rule({ action: 'deny', tool: '*', pattern: 'x', reason: 'why' }), PAYLOAD_SCHEMAS.guardrails).ok);
  const badAction = validateEnvelope(rule({ action: 'explode', pattern: 'x', reason: 'why' }), PAYLOAD_SCHEMAS.guardrails);
  assert.ok(!badAction.ok);
  assert.ok(badAction.errors.some((e) => /deny, ask, allow/.test(e)));
  const noReason = validateEnvelope(rule({ action: 'deny', pattern: 'x' }), PAYLOAD_SCHEMAS.guardrails);
  assert.ok(!noReason.ok);
  assert.ok(noReason.errors.some((e) => /reason/.test(e)));
});

test('validateEnvelope: actions payload schema rejects path-escaping exec', () => {
  const act = (payload) => ({ id: 'greet', faculty: 'actions', kind: 'script', title: 'g', status: 'active', created_at: '2026-06-12', payload, body: 'x' });
  assert.ok(validateEnvelope(act({ exec: 'run.mjs', args: { name: 'world' } }), PAYLOAD_SCHEMAS.actions).ok);
  assert.ok(!validateEnvelope(act({ exec: '../../etc/passwd' }), PAYLOAD_SCHEMAS.actions).ok);
  assert.ok(!validateEnvelope(act({ exec: 'run.mjs', kindx: 1 }), { ...PAYLOAD_SCHEMAS.actions, required: ['exec', 'missing'] }).ok);
});

test('deriveTitle: first body line, de-markdowned, falls back to id', () => {
  assert.equal(deriveTitle('## The fact\nmore', 'x'), 'The fact');
  assert.equal(deriveTitle('', 'fallback-id'), 'fallback-id');
});
