// The Faculty Module contract (2026-06-13 spec) — registry iteration,
// fail-soft hook invocation (try-wrap + time-box), declarative faculties
// (manifest-only folder = items + cards + schema + default digest line),
// and the manifest/overview JSON shapes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as registry from '../../zuzuu/faculty/registry.mjs';
import { CONTRACT_VERSION, normalizeManifest, validateManifest } from '../../zuzuu/faculty/module.mjs';
import { applyScaffold } from '../../zuzuu/home/scaffold.mjs';
import { computeDigest } from '../../zuzuu/digest/compose.mjs';
import { facultyManifestData, facultyOverviewData, facultyItemsData, facultySchemaData } from '../../zuzuu/commands/faculty.mjs';
import { serializeEnvelope, validateEnvelope } from '../../zuzuu/faculty/envelope.mjs';
import { FACULTIES } from '../../zuzuu/faculty/contract.mjs';

function withHome(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'zuzuu-fmodule-'));
  applyScaffold(dir, { now: 0 });
  const agentDir = join(dir, '.zuzuu');
  try { return fn(agentDir, dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** Drop a declarative `todo` faculty (manifest + schema + one item) into a home. */
function seedTodoFaculty(agentDir) {
  const dir = join(agentDir, 'todo');
  mkdirSync(join(dir, 'items'), { recursive: true });
  writeFileSync(join(dir, 'faculty.json'), JSON.stringify({
    id: 'todo',
    title: 'Todo',
    tagline: 'what to do next',
    version: '1.0.0',
    contract: 1,
    kinds: ['task'],
    itemsDir: 'items',
    schema: 'schema.json',
    hooks: { miner: false, digest: false, eval: false, gate: false },
    ui: { icon: 'check', accent: 'info', teaching: 'Tasks live here.' },
  }, null, 2));
  writeFileSync(join(dir, 'schema.json'), JSON.stringify({
    type: 'object',
    required: ['priority'],
    properties: { priority: { type: 'string', enum: ['low', 'high'] } },
  }, null, 2));
  writeFileSync(join(dir, 'items', 'ship-v2.md'), serializeEnvelope({
    id: 'ship-v2', faculty: 'todo', kind: 'task', title: 'Ship v2',
    status: 'active', created_at: '2026-06-13T00:00:00Z',
    payload: { priority: 'high' }, body: 'Ship the v2 overhaul.',
  }));
}

// ---------------------------------------------------------------------------
// registry iteration
// ---------------------------------------------------------------------------

test('registry: the five built-ins are modules — adapter + miner + manifest each', () => {
  for (const f of FACULTIES) {
    const mod = registry.BUILTIN_MODULES[f];
    assert.ok(mod, `${f} module present`);
    assert.equal(mod.manifest.id, f);
    assert.equal(mod.adapter.name, f);
    assert.equal(typeof mod.adapter.validate, 'function');
    assert.equal(typeof mod.adapter.apply, 'function');
    assert.equal(typeof mod.applyProposal, 'function', `${f} exports applyProposal`);
    assert.equal(typeof mod.validate, 'function', `${f} exports validate`);
    assert.equal(mod.miner.faculty, f);
    assert.equal(typeof mod.miner.aggregate, 'function');
    assert.equal(typeof mod.miner.propose, 'function');
    assert.ok(validateManifest(mod.manifest).ok, `${f} manifest valid`);
  }
});

test('registry: facultiesOf lists the built-ins with home manifests (seeded by scaffold)', () => {
  withHome((agentDir) => {
    const entries = registry.facultiesOf(agentDir);
    const builtins = entries.filter((e) => e.builtin);
    assert.deepEqual(builtins.map((e) => e.id), FACULTIES);
    for (const e of builtins) {
      assert.equal(e.manifestSource, 'home', `${e.id} manifest read from seeded faculty.json`);
      assert.equal(e.declarative, false);
      assert.ok(e.module, `${e.id} has module code`);
      assert.equal(e.manifest.contract, 1);
      assert.ok(e.manifest.ui.icon, `${e.id} has a ui icon`);
    }
  });
});

test('registry: adapter surface keeps the legacy order; overrides layer on top', () => {
  assert.deepEqual(registry.all().map((a) => a.name).slice(0, 5),
    ['knowledge', 'actions', 'guardrails', 'instructions', 'memory']);
  const fake = { name: 'zz-test-fake', validate: () => ({ ok: true, errors: [] }), apply: () => ({ ok: true }) };
  registry.register(fake);
  assert.equal(registry.get('zz-test-fake'), fake);
  assert.ok(registry.all().includes(fake));
});

// ---------------------------------------------------------------------------
// fail-soft hook invocation
// ---------------------------------------------------------------------------

test('invoke: a throwing hook degrades (ok:false), is recorded, never propagates', () => {
  registry.clearHookFailures();
  const entry = { id: 'boomy', module: { digestSection: () => { throw new Error('boom'); } } };
  const r = registry.invoke(entry, 'digestSection', '/nowhere');
  assert.equal(r.ok, false);
  assert.match(r.error, /boom/);
  const failures = registry.hookFailures();
  assert.equal(failures.length, 1);
  assert.equal(failures[0].faculty, 'boomy');
  assert.equal(failures[0].hook, 'digestSection');
  assert.match(failures[0].error, /boom/);
  registry.clearHookFailures();
});

test('invoke: a missing hook is {ok:false, missing:true} — not a failure', () => {
  registry.clearHookFailures();
  const r = registry.invoke({ id: 'bare', module: {} }, 'digestSection', '/nowhere');
  assert.equal(r.ok, false);
  assert.equal(r.missing, true);
  assert.equal(registry.hookFailures().length, 0, 'missing hooks are not recorded as failures');
});

test('invokeTimeboxed: sync throw caught; hung async miner times out (never rejects)', async () => {
  registry.clearHookFailures();
  const thrower = { id: 'm1', module: { aggregate: () => { throw new Error('miner-broke'); } } };
  const r1 = await registry.invokeTimeboxed(thrower, 'aggregate', [[], {}]);
  assert.equal(r1.ok, false);
  assert.match(r1.error, /miner-broke/);

  const hung = { id: 'm2', module: { aggregate: () => new Promise(() => {}) } };
  const r2 = await registry.invokeTimeboxed(hung, 'aggregate', [[], {}], { timeoutMs: 50 });
  assert.equal(r2.ok, false);
  assert.equal(r2.timedOut, true);

  const rejecting = { id: 'm3', module: { aggregate: async () => { throw new Error('async-broke'); } } };
  const r3 = await registry.invokeTimeboxed(rejecting, 'aggregate', [[], {}], { timeoutMs: 50 });
  assert.equal(r3.ok, false);
  assert.match(r3.error, /async-broke/);

  // all three recorded for doctor
  const faculties = registry.hookFailures().map((f) => f.faculty).sort();
  assert.deepEqual(faculties, ['m1', 'm2', 'm3']);
  registry.clearHookFailures();
});

test('invokeTimeboxed: default miner-class budget is 5s', () => {
  assert.equal(registry.MINER_HOOK_TIMEOUT_MS, 5000);
});

test('a broken declarative faculty.json degrades to manifestError — doctor-visible, never a throw', () => {
  withHome((agentDir) => {
    mkdirSync(join(agentDir, 'broken'), { recursive: true });
    writeFileSync(join(agentDir, 'broken', 'faculty.json'), '{ not json');
    const entries = registry.facultiesOf(agentDir);
    const broken = entries.find((e) => e.id === 'broken');
    assert.ok(broken, 'listed despite the parse error');
    assert.ok(broken.manifestError, 'carries the error');
    assert.equal(broken.module, null);
    // the digest still composes (fail-soft) and skips the broken faculty
    const { text } = computeDigest(agentDir);
    assert.ok(text.includes('# zuzuu faculty digest'));
    assert.ok(!text.includes('## Broken'));
    // the overview surfaces the degradation instead of hiding the faculty
    const o = facultyOverviewData(agentDir);
    const row = o.faculties.find((f) => f.id === 'broken');
    assert.ok(row.manifestError);
  });
});

test('an incompatible contract major is skipped (manifestError), not loaded', () => {
  withHome((agentDir) => {
    mkdirSync(join(agentDir, 'future'), { recursive: true });
    writeFileSync(join(agentDir, 'future', 'faculty.json'),
      JSON.stringify({ id: 'future', title: 'Future', contract: CONTRACT_VERSION + 1 }));
    const e = registry.facultiesOf(agentDir).find((x) => x.id === 'future');
    assert.ok(e.manifestError, 'incompatible contract flagged');
    assert.match(e.manifestError, /contract/);
  });
});

// ---------------------------------------------------------------------------
// declarative faculty — the acceptance test from the spec
// ---------------------------------------------------------------------------

test('declarative faculty: drop todo/faculty.json + schema.json → overview lists it, items validate, digest mentions it', () => {
  withHome((agentDir) => {
    seedTodoFaculty(agentDir);

    // 1) appears in facultiesOf + faculty overview
    const entry = registry.facultiesOf(agentDir).find((e) => e.id === 'todo');
    assert.ok(entry, 'todo listed');
    assert.equal(entry.declarative, true);
    assert.equal(entry.module, null, 'manifest-only — no code loaded (W4)');
    const o = facultyOverviewData(agentDir);
    const row = o.faculties.find((f) => f.id === 'todo');
    assert.ok(row, 'todo in overview');
    assert.equal(row.title, 'Todo');
    assert.equal(row.ui.icon, 'check');
    assert.equal(row.counts.items, 1);
    assert.equal(row.counts.pending, 0);
    assert.deepEqual(row.top, ['Ship v2']);

    // 2) items list + validate (envelope + the home-served schema)
    const items = facultyItemsData(agentDir, 'todo');
    assert.equal(items.count, 1);
    assert.equal(items.items[0].id, 'ship-v2');
    assert.deepEqual(items.errors, []);
    const schema = facultySchemaData(agentDir, 'todo');
    assert.equal(schema.source, 'home');
    const v = validateEnvelope({ ...items.items[0], faculty: 'knowledge' }, schema.schema);
    // payload {priority:'high'} validates against the todo schema
    assert.ok(!v.errors.some((e) => e.startsWith('payload')), JSON.stringify(v.errors));
    const bad = validateEnvelope({ ...items.items[0], faculty: 'knowledge', payload: { priority: 'nope' } }, schema.schema);
    assert.ok(bad.errors.some((e) => e.startsWith('payload')), 'schema enforces the enum');

    // 3) the digest mentions it (default "N item(s)" section)
    const { text, sections } = computeDigest(agentDir);
    assert.ok(text.includes('## Todo'), 'digest has the Todo section');
    assert.ok(text.includes('1 item(s)'));
    assert.equal(sections.todo.count, 1);

    // 4) manifest served back
    const m = facultyManifestData(agentDir, 'todo');
    assert.equal(m.faculty, 'todo');
    assert.equal(m.declarative, true);
    assert.equal(m.source, 'home');
    assert.equal(m.manifest.kinds[0], 'task');
  });
});

test('normalizeManifest fills every contract default from a bare {}', () => {
  const m = normalizeManifest({}, 'todo');
  assert.equal(m.id, 'todo');
  assert.equal(m.title, 'Todo');
  assert.equal(m.contract, CONTRACT_VERSION);
  assert.equal(m.itemsDir, 'items');
  assert.equal(m.schema, 'schema.json');
  assert.deepEqual(m.hooks, { miner: false, digest: false, eval: false, gate: false });
  assert.equal(m.ui.icon, 'folder');
});

// ---------------------------------------------------------------------------
// manifest / overview JSON shapes
// ---------------------------------------------------------------------------

test('faculty manifest --json shape: {faculty, source, declarative, manifest}', () => {
  withHome((agentDir) => {
    const d = facultyManifestData(agentDir, 'knowledge');
    assert.equal(d.faculty, 'knowledge');
    assert.equal(d.source, 'home'); // scaffold seeded faculty.json
    assert.equal(d.declarative, false);
    assert.equal(d.manifest.id, 'knowledge');
    assert.ok(Array.isArray(d.manifest.kinds));
    assert.equal(typeof d.manifest.ui.teaching, 'string');
    assert.equal(facultyManifestData(agentDir, 'nope'), null);
  });
});

test('faculty overview --json shape: all built-ins, counts + top-3 titles + pending, one process', () => {
  withHome((agentDir) => {
    const d = facultyOverviewData(agentDir);
    assert.ok(Array.isArray(d.faculties));
    assert.deepEqual(d.faculties.map((f) => f.id), FACULTIES, 'all five built-ins, canonical order');
    for (const f of d.faculties) {
      assert.equal(typeof f.title, 'string');
      assert.equal(typeof f.ui, 'object');
      assert.equal(typeof f.counts.items, 'number');
      assert.equal(typeof f.counts.pending, 'number');
      assert.equal(typeof f.counts.errors, 'number');
      assert.ok(Array.isArray(f.top));
      assert.ok(f.top.length <= 3, 'top is capped at 3');
    }
    // seeded home: guardrails has 3 rule items, instructions has steering
    const g = d.faculties.find((f) => f.id === 'guardrails');
    assert.equal(g.counts.items, 3);
    assert.equal(g.top.length, 3);
    const i = d.faculties.find((f) => f.id === 'instructions');
    assert.equal(i.counts.items, 1);
  });
});

// ---------------------------------------------------------------------------
// doctor surfaces degradation
// ---------------------------------------------------------------------------

test('doctor facultyModuleHealth: throwing hook + broken manifest both reported as degraded', async () => {
  const { facultyModuleHealth } = await import('../../zuzuu/commands/doctor.mjs');
  withHome((agentDir) => {
    registry.clearHookFailures();
    // a broken declarative manifest…
    mkdirSync(join(agentDir, 'wonky'), { recursive: true });
    writeFileSync(join(agentDir, 'wonky', 'faculty.json'), 'nope{');
    // …and a hook failure recorded through the fail-soft invoker
    registry.invoke({ id: 'knowledge', module: { digestSection: () => { throw new Error('kaput'); } } }, 'digestSection', agentDir);
    const { warnings, notes } = facultyModuleHealth(agentDir);
    assert.ok(warnings.some((w) => w.includes("faculty 'wonky'") && w.includes('items-only')), JSON.stringify(warnings));
    assert.ok(warnings.some((w) => w.includes("faculty 'knowledge' hook digestSection failed") && w.includes('kaput')), JSON.stringify(warnings));
    assert.deepEqual(notes, [], 'a broken declarative faculty is a warning, not a note');
    registry.clearHookFailures();
  });
});

test('doctor facultyModuleHealth: healthy declarative faculty is an informational note', async () => {
  const { facultyModuleHealth } = await import('../../zuzuu/commands/doctor.mjs');
  withHome((agentDir) => {
    registry.clearHookFailures();
    seedTodoFaculty(agentDir);
    const { warnings, notes } = facultyModuleHealth(agentDir);
    assert.deepEqual(warnings, []);
    assert.ok(notes.some((n) => n.includes('declarative faculties: todo')));
  });
});
