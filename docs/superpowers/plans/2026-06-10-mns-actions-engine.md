# mns Actions Engine (Plan 2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Actions faculty core — author runbooks/scripts under `.mns/actions/<slug>/`, run them with `mns act <slug>` (validate inputs → run → validate outputs → structured result), list them into the session digest (progressive disclosure), and convert each manifest to MCP/OpenAI/Anthropic tool definitions.

**Architecture:** Pure modules (`schema.mjs` validator, `manifest.mjs` loader/lister, `convert.mjs` converters) + a spawn-based dispatcher (`dispatch.mjs` runs a child `runner.mjs` harness that prepares args, validates, calls the action's `main(args)`, and emits a `__MNS_ACT_RESULT__` marker). `mns act` is an agent-invoked CLI exactly like `mns recall` — the host's Bash runs it, so every call is an observable span already covered by the guardrails gate. mns never enters the agent loop.

**Tech Stack:** Node ≥ 22, ES modules, zero runtime deps (hand-rolled JSON-Schema-subset validator, `node:test`, `node:child_process`). Tests run via `npm test` / `node --test tests/unit/<file>.test.mjs`. Temp-dir test pattern (`mkdtempSync` + `rmSync`).

**Scope note:** This is Plan 2a of Spec 2 (`docs/superpowers/specs/2026-06-10-mns-actions-engine-design.md`), covering A1–A5 + A7-truncation/structured-output. The crystallization gate (A6: `actions/inbox/` → `mns review` → activate) and the trace side-channel (A7-details) are deliberately deferred to **Plan 2b** — they touch the proposals/review subsystem, which is independent of this dispatcher/validator/converter core.

---

## Conventions for every task

- **Zero deps.** Only `node:*` builtins. No new packages, no Ajv.
- **Run a single test file:** `node --test tests/unit/<file>.test.mjs`. Run all: `npm test`.
- **Commit message trailer** (exact, every commit):
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```
- **Pure modules stay pure:** `schema.mjs`, `manifest.mjs`, `convert.mjs` do **no** `console.log` / `process.exit`. The CLI (`commands/act.mjs`) and the child `runner.mjs` do I/O.
- **Slug discipline:** an action lives at `.mns/actions/<slug>/`; `<slug>` is kebab-case.
- The `.mns/actions/` directory already exists (scaffolded by `mns init`); it currently holds only `README.md`.

---

## File structure

| File | Responsibility | Action |
|---|---|---|
| `mns/actions/schema.mjs` | Pure JSON-Schema-subset validator: `validate`, `validateInputs`, `validateOutputs` | **Create** |
| `mns/actions/manifest.mjs` | Load `action.json`, classify kind, `allActions(mnsDir)` lister | **Create** |
| `mns/actions/marker.mjs` | The result-marker sentinel (side-effect-free shared constant) | **Create** |
| `mns/actions/runner.mjs` | Child harness: prepare → validate → `main(args)` → validate → emit marker | **Create** |
| `mns/actions/dispatch.mjs` | `runAction(mnsDir, slug, callerArgs)` — spawn runner, extract marker, truncate logs | **Create** |
| `mns/actions/convert.mjs` | `toMcpTool` / `toOpenAITool` / `toAnthropicTool` (pure) | **Create** |
| `mns/commands/act.mjs` | `mns act list\|show\|new\|schema\|<slug>` CLI router | **Create** |
| `bin/mns.mjs` | Route `act`; help text | **Modify** |
| `mns/digest.mjs` | Add the `## Actions` section (progressive disclosure) | **Modify** |
| `tests/unit/actions-schema.test.mjs` | Validator behavior | **Create** |
| `tests/unit/actions-manifest.test.mjs` | Manifest load + lister | **Create** |
| `tests/unit/actions-dispatch.test.mjs` | runAction happy + error paths (real fixture actions) | **Create** |
| `tests/unit/actions-convert.test.mjs` | Converter goldens | **Create** |
| `tests/unit/actions-new.test.mjs` | `mns act new` scaffold | **Create** |
| `tests/unit/digest.test.mjs` | Actions section in the digest | **Modify** |

---

## Task 1: JSON-Schema-subset validator — core (objects, scalars, required)

**Files:**
- Create: `mns/actions/schema.mjs`
- Test: `tests/unit/actions-schema.test.mjs`

A hand-rolled validator for the subset we need. `validate(schema, value)` returns an array of human-readable error strings (empty = valid). No coercion — values must already be the right type (callers pass JSON, which has real types).

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/actions-schema.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../../mns/actions/schema.mjs';

test('object: required + property types', () => {
  const schema = { type: 'object', properties: { name: { type: 'string' }, n: { type: 'integer' } }, required: ['name'] };
  assert.deepEqual(validate(schema, { name: 'a', n: 3 }), []);
  assert.equal(validate(schema, { n: 3 }).length, 1);                 // missing required name
  assert.ok(validate(schema, { name: 5 })[0].includes('string'));     // wrong type
  assert.ok(validate(schema, { name: 'a', n: 1.5 })[0].includes('integer'));
});

test('scalars: string/number/boolean', () => {
  assert.deepEqual(validate({ type: 'string' }, 'x'), []);
  assert.equal(validate({ type: 'number' }, 'x').length, 1);
  assert.equal(validate({ type: 'number' }, NaN).length, 1);
  assert.deepEqual(validate({ type: 'boolean' }, true), []);
});

test('non-object value against object schema fails cleanly', () => {
  assert.ok(validate({ type: 'object' }, 'nope')[0].includes('object'));
  assert.ok(validate({ type: 'object' }, null)[0].includes('object'));
  assert.ok(validate({ type: 'object' }, [])[0].includes('object'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/actions-schema.test.mjs`
Expected: FAIL — `Cannot find module '../../mns/actions/schema.mjs'`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// mns/actions/schema.mjs
// A hand-rolled JSON-Schema *subset* validator — zero-dep (no Ajv), matching the
// project's node-builtins-only policy. Supports: object (properties, required),
// array (items), string/number/integer/boolean scalars, enum, and basic length/
// range constraints. Returns an array of error strings ([] = valid). No coercion:
// values are expected to already carry real JSON types.

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** @returns {string[]} error messages; empty array = valid */
export function validate(schema, value, path = '$') {
  const errors = [];
  if (!schema || typeof schema !== 'object') return errors; // no schema → accept
  const type = schema.type;

  if (type === 'object') {
    if (!isPlainObject(value)) return [`${path}: expected object`];
    for (const req of schema.required ?? []) {
      if (!(req in value)) errors.push(`${path}.${req}: required`);
    }
    for (const [k, sub] of Object.entries(schema.properties ?? {})) {
      if (k in value) errors.push(...validate(sub, value[k], `${path}.${k}`));
    }
    return errors;
  }

  if (type === 'array') {
    if (!Array.isArray(value)) return [`${path}: expected array`];
    if (schema.items) value.forEach((v, i) => errors.push(...validate(schema.items, v, `${path}[${i}]`)));
    return errors;
  }

  if (type === 'string' && typeof value !== 'string') errors.push(`${path}: expected string`);
  else if (type === 'number' && (typeof value !== 'number' || Number.isNaN(value))) errors.push(`${path}: expected number`);
  else if (type === 'integer' && !Number.isInteger(value)) errors.push(`${path}: expected integer`);
  else if (type === 'boolean' && typeof value !== 'boolean') errors.push(`${path}: expected boolean`);

  return errors;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/unit/actions-schema.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add mns/actions/schema.mjs tests/unit/actions-schema.test.mjs
git commit -m "feat(actions): JSON-Schema-subset validator core (objects, scalars, required)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 2: Validator — enum, constraints, and the input/output wrappers

**Files:**
- Modify: `mns/actions/schema.mjs`
- Test: `tests/unit/actions-schema.test.mjs`

Add `enum` + basic constraints (`minLength`/`maxLength`, `minimum`/`maximum`) to `validate`, then the two wrappers: `validateInputs(schema, defaults, caller)` (merges `defaults` then `caller`, validates) and `validateOutputs(schema, value)` (rejects non-objects, then validates — the `main(args) → object` contract).

- [ ] **Step 1: Write the failing test** (append)

```javascript
import { validateInputs, validateOutputs } from '../../mns/actions/schema.mjs';

test('enum + constraints', () => {
  assert.deepEqual(validate({ type: 'string', enum: ['a', 'b'] }, 'a'), []);
  assert.ok(validate({ type: 'string', enum: ['a', 'b'] }, 'c')[0].includes('one of'));
  assert.ok(validate({ type: 'string', minLength: 2 }, 'x')[0].includes('minLength'));
  assert.ok(validate({ type: 'integer', maximum: 5 }, 9)[0].includes('maximum'));
});

test('validateInputs merges defaults then caller, then validates', () => {
  const schema = { type: 'object', properties: { a: { type: 'string' }, b: { type: 'integer' } }, required: ['a', 'b'] };
  const r = validateInputs(schema, { b: 1 }, { a: 'hi' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.args, { b: 1, a: 'hi' });
  const bad = validateInputs(schema, {}, { a: 'hi' }); // b missing
  assert.equal(bad.ok, false);
  assert.ok(bad.error.includes('b'));
});

test('validateOutputs requires an object, then validates', () => {
  const schema = { type: 'object', properties: { ok: { type: 'boolean' } } };
  assert.equal(validateOutputs(schema, { ok: true }).ok, true);
  assert.equal(validateOutputs(schema, 'nope').ok, false);
  assert.equal(validateOutputs(schema, null).ok, false);
  assert.ok(validateOutputs(schema, { ok: 'x' }).error.includes('boolean'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/actions-schema.test.mjs`
Expected: FAIL — `validateInputs` not exported; enum/constraint assertions fail.

- [ ] **Step 3: Write minimal implementation** (edit `mns/actions/schema.mjs`)

In `validate`, before the final `return errors;` of the scalar block (i.e. after the scalar type checks, still inside `validate`), add enum + constraints. Replace the scalar section:

```javascript
  if (type === 'string' && typeof value !== 'string') errors.push(`${path}: expected string`);
  else if (type === 'number' && (typeof value !== 'number' || Number.isNaN(value))) errors.push(`${path}: expected number`);
  else if (type === 'integer' && !Number.isInteger(value)) errors.push(`${path}: expected integer`);
  else if (type === 'boolean' && typeof value !== 'boolean') errors.push(`${path}: expected boolean`);

  return errors;
}
```

with:

```javascript
  if (type === 'string' && typeof value !== 'string') errors.push(`${path}: expected string`);
  else if (type === 'number' && (typeof value !== 'number' || Number.isNaN(value))) errors.push(`${path}: expected number`);
  else if (type === 'integer' && !Number.isInteger(value)) errors.push(`${path}: expected integer`);
  else if (type === 'boolean' && typeof value !== 'boolean') errors.push(`${path}: expected boolean`);

  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: must be one of ${schema.enum.join(', ')}`);
  if (typeof value === 'string') {
    if (schema.minLength != null && value.length < schema.minLength) errors.push(`${path}: shorter than minLength ${schema.minLength}`);
    if (schema.maxLength != null && value.length > schema.maxLength) errors.push(`${path}: longer than maxLength ${schema.maxLength}`);
  }
  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) errors.push(`${path}: below minimum ${schema.minimum}`);
    if (schema.maximum != null && value > schema.maximum) errors.push(`${path}: above maximum ${schema.maximum}`);
  }

  return errors;
}
```

Then append the two wrappers at the end of the file:

```javascript
/**
 * Validate caller inputs against the manifest `inputs` schema.
 * Merges default_args then caller args (caller wins).
 * @returns {{ok:true,args:object} | {ok:false,error:string,errors:string[]}}
 */
export function validateInputs(schema, defaults = {}, caller = {}) {
  const args = { ...(defaults ?? {}), ...(caller ?? {}) };
  const errors = validate(schema ?? { type: 'object' }, args);
  return errors.length ? { ok: false, error: errors[0], errors } : { ok: true, args };
}

/**
 * Validate an action's return value against the manifest `outputs` schema.
 * Enforces the main(args) → object contract first.
 * @returns {{ok:true,value:object} | {ok:false,error:string,errors?:string[]}}
 */
export function validateOutputs(schema, value) {
  if (!isPlainObject(value)) return { ok: false, error: 'action output must be a JSON object' };
  const errors = validate(schema ?? { type: 'object' }, value);
  return errors.length ? { ok: false, error: errors[0], errors } : { ok: true, value };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/unit/actions-schema.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add mns/actions/schema.mjs tests/unit/actions-schema.test.mjs
git commit -m "feat(actions): validator enum/constraints + validateInputs/validateOutputs

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 3: Manifest loader + the `allActions` lister

**Files:**
- Create: `mns/actions/manifest.mjs`
- Test: `tests/unit/actions-manifest.test.mjs`

`loadManifest(mnsDir, slug)` reads `.mns/actions/<slug>/action.json` → object (or `null` if absent/unparseable). `allActions(mnsDir)` walks `.mns/actions/`, returns one entry per action dir: `{ slug, kind, title, promptSnippet }`. **Kind:** `script` if the dir has `run.mjs`, else `runbook` if it has `SKILL.md`, else skipped. For a runbook, `title`/`promptSnippet` come from the SKILL.md frontmatter (`name:` / `description:`) if present, else the slug. Skip the scaffolded `README.md` (not an action).

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/actions-manifest.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadManifest, allActions } from '../../mns/actions/manifest.mjs';

function withActions(fn) {
  const root = mkdtempSync(join(tmpdir(), 'mns-act-'));
  const mns = join(root, '.mns');
  const A = join(mns, 'actions');
  mkdirSync(A, { recursive: true });
  writeFileSync(join(A, 'README.md'), '# actions'); // must be ignored
  // a script action
  mkdirSync(join(A, 'run-tests'), { recursive: true });
  writeFileSync(join(A, 'run-tests', 'action.json'), JSON.stringify({
    slug: 'run-tests', title: 'Run tests', description: 'runs the suite',
    promptSnippet: 'run the test suite', inputs: { type: 'object' }, outputs: { type: 'object' },
  }));
  writeFileSync(join(A, 'run-tests', 'run.mjs'), 'export async function main(){ return { ok: true }; }');
  // a runbook action
  mkdirSync(join(A, 'deploy'), { recursive: true });
  writeFileSync(join(A, 'deploy', 'SKILL.md'), '---\nname: Deploy\ndescription: how to ship\n---\nsteps...');
  try {
    return fn(mns);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('loadManifest reads action.json or returns null', () => {
  withActions((mns) => {
    const m = loadManifest(mns, 'run-tests');
    assert.equal(m.slug, 'run-tests');
    assert.equal(m.promptSnippet, 'run the test suite');
    assert.equal(loadManifest(mns, 'nope'), null);
    assert.equal(loadManifest(mns, 'deploy'), null); // runbook has no action.json
  });
});

test('allActions lists scripts and runbooks, ignores README', () => {
  withActions((mns) => {
    const list = allActions(mns).sort((a, b) => a.slug.localeCompare(b.slug));
    assert.equal(list.length, 2);
    assert.deepEqual(list.map((a) => a.slug), ['deploy', 'run-tests']);
    const rt = list.find((a) => a.slug === 'run-tests');
    assert.equal(rt.kind, 'script');
    assert.equal(rt.promptSnippet, 'run the test suite');
    const dp = list.find((a) => a.slug === 'deploy');
    assert.equal(dp.kind, 'runbook');
    assert.equal(dp.title, 'Deploy');
    assert.equal(dp.promptSnippet, 'how to ship');
  });
});

test('allActions on a home with no actions dir returns []', () => {
  const root = mkdtempSync(join(tmpdir(), 'mns-empty-'));
  try {
    assert.deepEqual(allActions(join(root, '.mns')), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/actions-manifest.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```javascript
// mns/actions/manifest.mjs
// Reads the Actions faculty off disk: one action per dir under .mns/actions/.
// Two kinds — `script` (has run.mjs + action.json) and `runbook` (SKILL.md prose).
// Pure-ish: filesystem reads only, no logging, no process control.

import { join } from 'node:path';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';

export const actionsDir = (mnsDir) => join(mnsDir, 'actions');
const actionDir = (mnsDir, slug) => join(actionsDir(mnsDir), slug);

/** Read action.json for a slug → object, or null if absent/unparseable. */
export function loadManifest(mnsDir, slug) {
  const path = join(actionDir(mnsDir, slug), 'action.json');
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** Pull `name` / `description` from a SKILL.md YAML-ish frontmatter (best-effort). */
function skillFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  const fm = {};
  if (m) {
    for (const line of m[1].split('\n')) {
      const kv = line.match(/^(\w+):\s*(.*)$/);
      if (kv) fm[kv[1]] = kv[2].trim();
    }
  }
  return fm;
}

/**
 * List every action under .mns/actions/ as {slug, kind, title, promptSnippet}.
 * `script` = dir has run.mjs; `runbook` = dir has SKILL.md; other dirs/files skipped.
 */
export function allActions(mnsDir) {
  const dir = actionsDir(mnsDir);
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const d = join(dir, name);
    let isDir = false;
    try { isDir = statSync(d).isDirectory(); } catch { /* skip */ }
    if (!isDir) continue; // ignores README.md and any stray files
    if (existsSync(join(d, 'run.mjs'))) {
      const man = loadManifest(mnsDir, name) ?? {};
      out.push({ slug: name, kind: 'script', title: man.title ?? name, promptSnippet: man.promptSnippet ?? man.description ?? name });
    } else if (existsSync(join(d, 'SKILL.md'))) {
      const fm = skillFrontmatter(readFileSync(join(d, 'SKILL.md'), 'utf8'));
      out.push({ slug: name, kind: 'runbook', title: fm.name ?? name, promptSnippet: fm.description ?? name });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/unit/actions-manifest.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add mns/actions/manifest.mjs tests/unit/actions-manifest.test.mjs
git commit -m "feat(actions): manifest loader + allActions lister (script vs runbook)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 4: The runner harness + dispatcher (happy path)

**Files:**
- Create: `mns/actions/marker.mjs`
- Create: `mns/actions/runner.mjs`
- Create: `mns/actions/dispatch.mjs`
- Test: `tests/unit/actions-dispatch.test.mjs`

`runner.mjs` is the child harness, spawned by the dispatcher. It receives a single JSON payload on argv, dynamic-imports the action's `run.mjs`, runs optional `prepareArguments`, validates inputs, calls `main(args)`, validates outputs, and prints `__MNS_ACT_RESULT__<json>` on its own line. `dispatch.runAction(mnsDir, slug, callerArgs)` spawns it, extracts the marker, and returns the parsed result plus the script's other stdout as `logs`. (Spawning a child isolates the action's `process.exit`/throws from the `mns` process and is the `_labs`-proven marker pattern.)

**Important:** `runner.mjs` executes its harness logic at module top-level (it's only ever *spawned*, never imported). So the shared `MARKER` constant lives in its own side-effect-free module `marker.mjs` — `dispatch.mjs` and `commands/act.mjs` import `MARKER` from there, never from `runner.mjs` (importing `runner.mjs` would run the harness).

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/actions-dispatch.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAction } from '../../mns/actions/dispatch.mjs';

// Create an action dir with a manifest + run.mjs body; return the .mns path.
function withAction(slug, manifest, runBody, fn) {
  const root = mkdtempSync(join(tmpdir(), 'mns-disp-'));
  const dir = join(root, '.mns', 'actions', slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'action.json'), JSON.stringify({ slug, ...manifest }));
  writeFileSync(join(dir, 'run.mjs'), runBody);
  try {
    return fn(join(root, '.mns'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('happy path: validates, runs main, returns structured value', async () => {
  await withAction(
    'greet',
    { inputs: { type: 'object', properties: { who: { type: 'string' } }, required: ['who'] },
      outputs: { type: 'object', properties: { msg: { type: 'string' } } } },
    `export async function main(args) { console.log('side log'); return { msg: 'hi ' + args.who }; }`,
    async (mns) => {
      const r = await runAction(mns, 'greet', { who: 'sam' });
      assert.equal(r.ok, true);
      assert.deepEqual(r.value, { msg: 'hi sam' });
      assert.match(r.logs, /side log/); // the script's own stdout is captured separately from the result
    },
  );
});

test('default_args fill in when caller omits them', async () => {
  await withAction(
    'greet2',
    { default_args: { who: 'world' },
      inputs: { type: 'object', properties: { who: { type: 'string' } }, required: ['who'] },
      outputs: { type: 'object' } },
    `export async function main(args) { return { who: args.who }; }`,
    async (mns) => {
      const r = await runAction(mns, 'greet2', {});
      assert.equal(r.ok, true);
      assert.deepEqual(r.value, { who: 'world' });
    },
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/actions-dispatch.test.mjs`
Expected: FAIL — `mns/actions/dispatch.mjs` not found.

- [ ] **Step 3a: Write the shared marker module**

```javascript
// mns/actions/marker.mjs
// The result-marker sentinel, in its own module so importing it has NO side
// effects (runner.mjs runs harness logic at top-level and must never be imported).
export const MARKER = '__MNS_ACT_RESULT__';
```

- [ ] **Step 3b: Write the runner harness**

```javascript
// mns/actions/runner.mjs
// The child harness spawned by dispatch.runAction. NOT imported by anything —
// it's executed: `node runner.mjs <payloadJson>`. It runs the action in its own
// process (isolating process.exit/throw), then prints exactly one result marker.
//
// payload = { runPath, inputs, outputs, default_args, args }
// stdout: the action's own logs, then a final line `__MNS_ACT_RESULT__<json>`.

import { pathToFileURL } from 'node:url';
import { validateInputs, validateOutputs } from './schema.mjs';
import { MARKER } from './marker.mjs';

function emit(obj) {
  process.stdout.write('\n' + MARKER + JSON.stringify(obj) + '\n');
}

const payload = JSON.parse(process.argv[2] || '{}');
try {
  const mod = await import(pathToFileURL(payload.runPath).href);
  if (typeof mod.main !== 'function') {
    emit({ ok: false, error: 'not_runnable', detail: 'run.mjs must export an async main(args)' });
  } else {
    // prepareArguments (optional, pi pattern) folds legacy args forward BEFORE validation
    let merged = { ...(payload.default_args ?? {}), ...(payload.args ?? {}) };
    if (typeof mod.prepareArguments === 'function') merged = mod.prepareArguments(merged);
    const vi = validateInputs(payload.inputs, {}, merged);
    if (!vi.ok) {
      emit({ ok: false, error: 'invalid_input', detail: vi.error });
    } else {
      const result = await mod.main(vi.args);
      const vo = validateOutputs(payload.outputs, result);
      if (!vo.ok) emit({ ok: false, error: 'invalid_output', detail: vo.error });
      else emit({ ok: true, value: vo.value });
    }
  }
} catch (e) {
  emit({ ok: false, error: 'script_error', detail: String((e && e.message) || e) });
}
```

- [ ] **Step 4: Write the dispatcher**

```javascript
// mns/actions/dispatch.mjs
// runAction spawns the runner harness (a fresh node process — isolation + the
// _labs marker pattern), extracts the single result marker from stdout, and
// returns { ok, value|error, detail?, logs }. mns act is itself spawned by the
// host's Bash, so this is observe-not-drive: a CLI the agent calls, never a loop.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { loadManifest, actionsDir } from './manifest.mjs';
import { MARKER } from './marker.mjs';

const MAX_DEPTH = 8;
const MAX_BYTES = 50_000;
const MAX_LINES = 2000;
const runnerPath = join(dirname(fileURLToPath(import.meta.url)), 'runner.mjs');

/** Head-truncate noisy logs before they reach the agent (pi convention). */
function truncate(s) {
  let out = s;
  if (out.length > MAX_BYTES) out = out.slice(0, MAX_BYTES) + '\n…[truncated]';
  const lines = out.split('\n');
  if (lines.length > MAX_LINES) out = lines.slice(0, MAX_LINES).join('\n') + '\n…[truncated]';
  return out;
}

/** Split captured stdout into {logs, marker-object}. */
function parseOutput(stdout) {
  const lines = stdout.split('\n');
  let parsed = null;
  const logLines = [];
  for (const line of lines) {
    const i = line.indexOf(MARKER);
    if (i !== -1) {
      try { parsed = JSON.parse(line.slice(i + MARKER.length)); } catch { /* keep last good */ }
    } else {
      logLines.push(line);
    }
  }
  return { parsed, logs: truncate(logLines.join('\n').trim()) };
}

/**
 * Run an action by slug. Returns:
 *   { ok:true, value, logs } | { ok:false, error, detail?, logs }
 * error ∈ depth_exceeded | not_found | not_runnable | invalid_input |
 *         invalid_output | script_error | no_result
 */
export function runAction(mnsDir, slug, callerArgs = {}) {
  const depth = Number(process.env.MNS_ACT_DEPTH || 0);
  if (depth >= MAX_DEPTH) return { ok: false, error: 'depth_exceeded', detail: `depth ${depth} ≥ ${MAX_DEPTH}`, logs: '' };

  const manifest = loadManifest(mnsDir, slug);
  if (!manifest) return { ok: false, error: 'not_found', detail: `no action '${slug}' (missing action.json)`, logs: '' };

  const runPath = join(actionsDir(mnsDir), slug, 'run.mjs');
  if (!existsSync(runPath)) return { ok: false, error: 'not_runnable', detail: `'${slug}' has no run.mjs`, logs: '' };

  const payload = JSON.stringify({
    runPath,
    inputs: manifest.inputs ?? { type: 'object' },
    outputs: manifest.outputs ?? { type: 'object' },
    default_args: manifest.default_args ?? {},
    args: callerArgs ?? {},
  });

  const res = spawnSync(process.execPath, [runnerPath, payload], {
    cwd: mnsDir,
    encoding: 'utf8',
    env: { ...process.env, MNS_ACT_DEPTH: String(depth + 1) },
    maxBuffer: 64 * 1024 * 1024,
  });

  const { parsed, logs } = parseOutput((res.stdout || '') + (res.stderr ? '\n' + res.stderr : ''));
  if (!parsed) return { ok: false, error: 'no_result', detail: 'action emitted no result marker', logs };
  return { ...parsed, logs };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/unit/actions-dispatch.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add mns/actions/marker.mjs mns/actions/runner.mjs mns/actions/dispatch.mjs tests/unit/actions-dispatch.test.mjs
git commit -m "feat(actions): runner harness + dispatcher happy path (spawn, marker, defaults)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 5: Dispatcher — error paths, depth cap, prepareArguments, throw-to-fail

**Files:**
- Test: `tests/unit/actions-dispatch.test.mjs` (add cases; no production change expected — the runner/dispatcher already implement these)

This task **verifies** the contracts already coded in Task 4 (it is test-first against existing behavior; if a test fails, fix the runner/dispatcher accordingly). Covers: `not_found`, `not_runnable`, `invalid_input`, `invalid_output`, throw-to-fail (`script_error`), `prepareArguments` fold-forward, and result-marker survival amid interleaved logging.

- [ ] **Step 1: Write the tests** (append to `tests/unit/actions-dispatch.test.mjs`)

```javascript
test('invalid_input: missing required arg, action never runs', async () => {
  await withAction(
    'needs',
    { inputs: { type: 'object', properties: { x: { type: 'integer' } }, required: ['x'] }, outputs: { type: 'object' } },
    `export async function main() { return { ran: true }; }`,
    async (mns) => {
      const r = await runAction(mns, 'needs', {});
      assert.equal(r.ok, false);
      assert.equal(r.error, 'invalid_input');
    },
  );
});

test('invalid_output: main returns a non-object / schema mismatch', async () => {
  await withAction(
    'badout',
    { inputs: { type: 'object' }, outputs: { type: 'object', properties: { n: { type: 'integer' } } } },
    `export async function main() { return { n: 'not-an-int' }; }`,
    async (mns) => {
      const r = await runAction(mns, 'badout', {});
      assert.equal(r.ok, false);
      assert.equal(r.error, 'invalid_output');
    },
  );
});

test('throw-to-fail: a throwing action becomes script_error', async () => {
  await withAction(
    'boom',
    { inputs: { type: 'object' }, outputs: { type: 'object' } },
    `export async function main() { throw new Error('kaboom'); }`,
    async (mns) => {
      const r = await runAction(mns, 'boom', {});
      assert.equal(r.ok, false);
      assert.equal(r.error, 'script_error');
      assert.match(r.detail, /kaboom/);
    },
  );
});

test('not_found and not_runnable', async () => {
  await withAction('x', { inputs: { type: 'object' }, outputs: { type: 'object' } },
    `export async function main(){ return {}; }`,
    async (mns) => {
      assert.equal((await runAction(mns, 'nope', {})).error, 'not_found');
    });
});

test('prepareArguments folds legacy args before validation', async () => {
  await withAction(
    'legacy',
    { inputs: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }, outputs: { type: 'object' } },
    `export function prepareArguments(a){ return a.fullName ? { name: a.fullName } : a; }
     export async function main(args){ return { name: args.name }; }`,
    async (mns) => {
      const r = await runAction(mns, 'legacy', { fullName: 'Ada' }); // legacy key, no `name`
      assert.equal(r.ok, true);
      assert.deepEqual(r.value, { name: 'Ada' });
    },
  );
});

test('result marker survives a script that prints the marker-looking text in logs', async () => {
  await withAction(
    'noisy',
    { inputs: { type: 'object' }, outputs: { type: 'object', properties: { done: { type: 'boolean' } } } },
    `export async function main(){ console.log('lots'); console.log('of'); console.log('logs'); return { done: true }; }`,
    async (mns) => {
      const r = await runAction(mns, 'noisy', {});
      assert.equal(r.ok, true);
      assert.deepEqual(r.value, { done: true });
      assert.match(r.logs, /lots\nof\nlogs/);
    },
  );
});
```

- [ ] **Step 2: Run tests**

Run: `node --test tests/unit/actions-dispatch.test.mjs`
Expected: PASS (8 tests total). If any fail, the runner/dispatcher from Task 4 needs the corresponding fix — make it and re-run.

- [ ] **Step 3: Depth-cap test (separate, sets the env var)**

Append:

```javascript
import { runAction as runAction2 } from '../../mns/actions/dispatch.mjs';

test('depth cap: MNS_ACT_DEPTH at the limit refuses', async () => {
  await withAction('deep', { inputs: { type: 'object' }, outputs: { type: 'object' } },
    `export async function main(){ return {}; }`,
    async (mns) => {
      const prev = process.env.MNS_ACT_DEPTH;
      process.env.MNS_ACT_DEPTH = '8';
      try {
        const r = runAction2(mns, 'deep', {});
        assert.equal(r.ok, false);
        assert.equal(r.error, 'depth_exceeded');
      } finally {
        if (prev === undefined) delete process.env.MNS_ACT_DEPTH; else process.env.MNS_ACT_DEPTH = prev;
      }
    });
});
```

Run: `node --test tests/unit/actions-dispatch.test.mjs`
Expected: PASS (9 tests).

- [ ] **Step 4: Commit**

```bash
git add tests/unit/actions-dispatch.test.mjs mns/actions/dispatch.mjs mns/actions/runner.mjs
git commit -m "test(actions): dispatcher error paths, depth cap, prepareArguments, marker survival

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 6: Manifest → tool-definition converters (MCP / OpenAI / Anthropic)

**Files:**
- Create: `mns/actions/convert.mjs`
- Test: `tests/unit/actions-convert.test.mjs`

Pure converters (the `_labs` `tool-definition.ts` pattern). The manifest's `inputs` JSON Schema maps directly to each format's parameter schema.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/actions-convert.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMcpTool, toOpenAITool, toAnthropicTool } from '../../mns/actions/convert.mjs';

const MANIFEST = {
  slug: 'greet', title: 'Greet', description: 'say hi',
  inputs: { type: 'object', properties: { who: { type: 'string' } }, required: ['who'] },
  outputs: { type: 'object', properties: { msg: { type: 'string' } } },
};

test('toMcpTool: name/description/inputSchema/outputSchema', () => {
  const t = toMcpTool(MANIFEST);
  assert.equal(t.name, 'greet');
  assert.equal(t.description, 'say hi');
  assert.deepEqual(t.inputSchema, MANIFEST.inputs);
  assert.deepEqual(t.outputSchema, MANIFEST.outputs);
});

test('toOpenAITool: function wrapper', () => {
  const t = toOpenAITool(MANIFEST);
  assert.equal(t.type, 'function');
  assert.equal(t.function.name, 'greet');
  assert.equal(t.function.description, 'say hi');
  assert.deepEqual(t.function.parameters, MANIFEST.inputs);
});

test('toAnthropicTool: name/description/input_schema', () => {
  const t = toAnthropicTool(MANIFEST);
  assert.equal(t.name, 'greet');
  assert.equal(t.description, 'say hi');
  assert.deepEqual(t.input_schema, MANIFEST.inputs);
});

test('description falls back to title then slug; inputs default to empty object schema', () => {
  const bare = { slug: 'x' };
  assert.equal(toMcpTool(bare).description, 'x');
  assert.deepEqual(toMcpTool(bare).inputSchema, { type: 'object' });
  assert.equal(toAnthropicTool({ slug: 'y', title: 'Y' }).description, 'Y');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/actions-convert.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```javascript
// mns/actions/convert.mjs
// Pure manifest → tool-definition converters (the _labs tool-definition pattern).
// The manifest's `inputs` JSON Schema is already the right shape for each format,
// so conversion is a thin re-wrap. This is the bridge to DESIGN §6 "Actions over
// MCP": author the manifest once for `mns act`, get an MCP/OpenAI/Anthropic tool
// definition for free (Stage 2 / OpenCode).

const desc = (m) => m.description ?? m.title ?? m.slug;
const inputs = (m) => m.inputs ?? { type: 'object' };

export function toMcpTool(m) {
  const t = { name: m.slug, description: desc(m), inputSchema: inputs(m) };
  if (m.outputs) t.outputSchema = m.outputs;
  return t;
}

export function toOpenAITool(m) {
  return { type: 'function', function: { name: m.slug, description: desc(m), parameters: inputs(m) } };
}

export function toAnthropicTool(m) {
  return { name: m.slug, description: desc(m), input_schema: inputs(m) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/unit/actions-convert.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add mns/actions/convert.mjs tests/unit/actions-convert.test.mjs
git commit -m "feat(actions): manifest → MCP/OpenAI/Anthropic tool-definition converters

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 7: `mns act` CLI — list / show / run routing

**Files:**
- Create: `mns/commands/act.mjs`
- Modify: `bin/mns.mjs`

`mns act` with no subcommand or `list` → the index. `mns act show <slug>` → full manifest (script) or SKILL.md (runbook). `mns act <slug> [--args JSON]` → run it: print the script's logs, then a result marker line for the agent, then a one-line human summary. (`new` and `schema` subcommands land in Task 8.) Reserved subcommands: `list`, `show`, `new`, `schema` — anything else is treated as a slug to run.

- [ ] **Step 1: Create `mns/commands/act.mjs`**

```javascript
// mns/commands/act.mjs
// `mns act` — the Actions faculty CLI. The host's Bash invokes this, so each run
// is an observable span already covered by the guardrails gate. Subcommands:
//   mns act [list]            the index (slug · kind · snippet)
//   mns act show <slug>       full manifest (script) or SKILL.md (runbook)
//   mns act <slug> [--args J] run a script action
//   mns act new <slug>        scaffold (Task 8)
//   mns act schema <slug>     convert to a tool definition (Task 8)

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from '../store.mjs';
import { allActions, loadManifest, actionsDir } from '../actions/manifest.mjs';
import { runAction } from '../actions/dispatch.mjs';
import { MARKER } from '../actions/marker.mjs';
import { newAction, schema as schemaCmd } from './act-author.mjs';

const RESERVED = new Set(['list', 'show', 'new', 'schema']);

function list(mnsDir) {
  const actions = allActions(mnsDir);
  if (!actions.length) return console.log('no actions yet — scaffold one with `mns act new <slug>`');
  for (const a of actions.sort((x, y) => x.slug.localeCompare(y.slug))) {
    console.log(`  ${a.slug}  [${a.kind}]  ${a.promptSnippet}`);
  }
}

function show(mnsDir, slug) {
  if (!slug) { console.error('usage: mns act show <slug>'); process.exit(1); }
  const man = loadManifest(mnsDir, slug);
  if (man) return console.log(JSON.stringify(man, null, 2));
  const skill = join(actionsDir(mnsDir), slug, 'SKILL.md');
  if (existsSync(skill)) return process.stdout.write(readFileSync(skill, 'utf8'));
  console.error(`no action '${slug}'`);
  process.exit(1);
}

function run(mnsDir, slug, args) {
  let callerArgs = {};
  if (args.args) {
    try { callerArgs = JSON.parse(args.args); }
    catch { console.error('--args must be valid JSON'); process.exit(1); }
  }
  const r = runAction(mnsDir, slug, callerArgs);
  if (r.logs) process.stdout.write(r.logs + '\n');
  // structured result for the agent to parse, on its own marker line
  console.log(MARKER + JSON.stringify(r.ok ? { ok: true, value: r.value } : { ok: false, error: r.error, detail: r.detail }));
  // human summary
  if (r.ok) console.log(`✓ ${slug} ok`);
  else console.error(`✗ ${slug}: ${r.error}${r.detail ? ` — ${r.detail}` : ''}`);
  process.exit(r.ok ? 0 : 1);
}

export function act(args) {
  const mnsDir = paths().dir;
  const sub = args._[0];
  if (!sub || sub === 'list') return list(mnsDir);
  if (sub === 'show') return show(mnsDir, args._[1]);
  if (sub === 'new') return newAction(mnsDir, args._[1]);
  if (sub === 'schema') return schemaCmd(mnsDir, args._[1], args);
  if (RESERVED.has(sub)) { console.error(`unknown: mns act ${sub}`); process.exit(1); }
  return run(mnsDir, sub, args); // sub is a slug to run
}
```

NOTE: this imports `./act-author.mjs` (created in Task 8). To keep Task 7 runnable on its own, create a **temporary stub** now and replace it in Task 8:

Create `mns/commands/act-author.mjs`:
```javascript
// mns/commands/act-author.mjs — `mns act new` + `mns act schema` (filled in Task 8).
export function newAction() { console.error('mns act new: not yet implemented'); process.exit(1); }
export function schema() { console.error('mns act schema: not yet implemented'); process.exit(1); }
```

- [ ] **Step 2: Wire the route in `bin/mns.mjs`**

Add the import after the `digest` import line:
```javascript
import { act } from '../mns/commands/act.mjs';
```
Add the case after the `digest` case in `switch (cmd)`:
```javascript
  case 'act': act(args); break;
```
Add a help entry after the `digest` help line:
```
  act [list|show <slug>|new <slug>|schema <slug>]
                            the Actions faculty — runbooks + runnable scripts
  act <slug> [--args JSON]  run a script action
```

- [ ] **Step 3: Verify by hand**

```bash
cd /Users/hkc/Documents/motorsandsensors
# list on a home with no actions:
D=$(mktemp -d) && (cd "$D" && git init -q && node /Users/hkc/Documents/motorsandsensors/bin/mns.mjs init >/dev/null && node /Users/hkc/Documents/motorsandsensors/bin/mns.mjs act list)
# create a quick action by hand and run it:
A="$D/.mns/actions/echo" && mkdir -p "$A"
printf '{"slug":"echo","promptSnippet":"echo a value","inputs":{"type":"object","properties":{"v":{"type":"string"}},"required":["v"]},"outputs":{"type":"object","properties":{"v":{"type":"string"}}}}' > "$A/action.json"
printf 'export async function main(args){ return { v: args.v }; }\n' > "$A/run.mjs"
(cd "$D" && node /Users/hkc/Documents/motorsandsensors/bin/mns.mjs act list && node /Users/hkc/Documents/motorsandsensors/bin/mns.mjs act echo --args '{"v":"hello"}'; echo "[exit $?]")
```
Expected: `list` shows `echo  [script]  echo a value`; the run prints a line `__MNS_ACT_RESULT__{"ok":true,"value":{"v":"hello"}}` and `✓ echo ok`, exit 0.

Then full suite: `npm test 2>&1 | tail -5` → fail 0.

- [ ] **Step 4: Commit**

```bash
git add mns/commands/act.mjs mns/commands/act-author.mjs bin/mns.mjs
git commit -m "feat(actions): mns act CLI — list/show/run routing (+author stub)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 8: `mns act new` (scaffold) + `mns act schema` (convert)

**Files:**
- Modify: `mns/commands/act-author.mjs` (replace the stubs)
- Test: `tests/unit/actions-new.test.mjs`

`newAction(mnsDir, slug)` scaffolds `.mns/actions/<slug>/` with a manifest stub + a `run.mjs` template (with `main` + a commented `prepareArguments`). Idempotent + no-clobber (never overwrites an existing file). `schema(mnsDir, slug, args)` prints the manifest converted to MCP (default), OpenAI (`--openai`), or Anthropic (`--anthropic`).

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/actions-new.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scaffoldAction } from '../../mns/commands/act-author.mjs';

function withHome(fn) {
  const root = mkdtempSync(join(tmpdir(), 'mns-new-'));
  mkdirSync(join(root, '.mns', 'actions'), { recursive: true });
  try { return fn(join(root, '.mns')); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('scaffoldAction creates manifest + run.mjs; manifest is valid JSON with the slug', () => {
  withHome((mns) => {
    const r = scaffoldAction(mns, 'deploy-thing');
    assert.equal(r.created.length, 2);
    const dir = join(mns, 'actions', 'deploy-thing');
    assert.ok(existsSync(join(dir, 'action.json')));
    assert.ok(existsSync(join(dir, 'run.mjs')));
    const man = JSON.parse(readFileSync(join(dir, 'action.json'), 'utf8'));
    assert.equal(man.slug, 'deploy-thing');
    assert.ok(readFileSync(join(dir, 'run.mjs'), 'utf8').includes('export async function main'));
  });
});

test('scaffoldAction is no-clobber: existing files survive', () => {
  withHome((mns) => {
    const dir = join(mns, 'actions', 'keep');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'run.mjs'), 'export async function main(){ return { mine: true }; }');
    const r = scaffoldAction(mns, 'keep');
    assert.ok(readFileSync(join(dir, 'run.mjs'), 'utf8').includes('mine: true'), 'user run.mjs untouched');
    assert.ok(r.created.includes('action.json'));   // only the missing one created
    assert.ok(!r.created.includes('run.mjs'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/actions-new.test.mjs`
Expected: FAIL — `scaffoldAction` not exported.

- [ ] **Step 3: Replace `mns/commands/act-author.mjs`**

```javascript
// mns/commands/act-author.mjs
// `mns act new <slug>` — scaffold a script action (idempotent, no-clobber).
// `mns act schema <slug> [--mcp|--openai|--anthropic]` — convert the manifest.

import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { actionsDir, loadManifest } from '../actions/manifest.mjs';
import { toMcpTool, toOpenAITool, toAnthropicTool } from '../actions/convert.mjs';

function manifestStub(slug) {
  return JSON.stringify({
    slug,
    title: slug,
    description: 'what this action does',
    promptSnippet: `one line the digest shows for ${slug}`,
    inputs: { type: 'object', properties: {}, required: [] },
    outputs: { type: 'object', properties: {} },
    default_args: {},
    requires: [],
  }, null, 2) + '\n';
}

const RUN_TEMPLATE = `// run.mjs — implement the action. Export async main(args) → a JSON object.
// Optional: export prepareArguments(args) to fold legacy args before validation.

// export function prepareArguments(args) { return args; }

export async function main(args) {
  // args is validated against action.json "inputs"; return must match "outputs".
  return { ok: true };
}
`;

/** Scaffold .mns/actions/<slug>/ — returns { created: string[] }. No-clobber. */
export function scaffoldAction(mnsDir, slug) {
  const dir = join(actionsDir(mnsDir), slug);
  mkdirSync(dir, { recursive: true });
  const created = [];
  const write = (name, body) => {
    const p = join(dir, name);
    if (!existsSync(p)) { writeFileSync(p, body); created.push(name); }
  };
  write('action.json', manifestStub(slug));
  write('run.mjs', RUN_TEMPLATE);
  return { created };
}

export function newAction(mnsDir, slug) {
  if (!slug) { console.error('usage: mns act new <slug>'); process.exit(1); }
  const { created } = scaffoldAction(mnsDir, slug);
  if (created.length) console.log(`scaffolded action '${slug}' → ${created.join(', ')} in .mns/actions/${slug}/`);
  else console.log(`action '${slug}' already complete — nothing to do`);
}

export function schema(mnsDir, slug, args = {}) {
  if (!slug) { console.error('usage: mns act schema <slug> [--mcp|--openai|--anthropic]'); process.exit(1); }
  const man = loadManifest(mnsDir, slug);
  if (!man) { console.error(`no action '${slug}' (missing action.json)`); process.exit(1); }
  const def = args.openai ? toOpenAITool(man) : args.anthropic ? toAnthropicTool(man) : toMcpTool(man);
  console.log(JSON.stringify(def, null, 2));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/unit/actions-new.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Verify the CLI end-to-end**

```bash
cd /Users/hkc/Documents/motorsandsensors
D=$(mktemp -d) && cd "$D" && git init -q && node /Users/hkc/Documents/motorsandsensors/bin/mns.mjs init >/dev/null
node /Users/hkc/Documents/motorsandsensors/bin/mns.mjs act new sample
node /Users/hkc/Documents/motorsandsensors/bin/mns.mjs act schema sample          # MCP shape
node /Users/hkc/Documents/motorsandsensors/bin/mns.mjs act schema sample --openai  # OpenAI shape
```
Expected: `new` reports it scaffolded `action.json, run.mjs`; `schema` prints valid JSON (`name: "sample"` for MCP; `type: "function"` for `--openai`).

Then full suite: `cd /Users/hkc/Documents/motorsandsensors && npm test 2>&1 | tail -5` → fail 0.

- [ ] **Step 6: Commit**

```bash
git add mns/commands/act-author.mjs tests/unit/actions-new.test.mjs
git commit -m "feat(actions): mns act new (scaffold, no-clobber) + mns act schema (convert)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 9: Wire the Actions section into the session digest

**Files:**
- Modify: `mns/digest.mjs`
- Test: `tests/unit/digest.test.mjs`

Spec 1 left a deferred-NOTE for this. Add an `## Actions` section: progressive disclosure — only `slug · promptSnippet` per action, never bodies. Place it after Knowledge and before Proposals; budget-bound the list the same way as Knowledge (always show ≥1 if any, ellipsis for the rest). `sections.actions = { count, shown:[{slug,kind,promptSnippet}] }`. When there are no actions, omit the section entirely (like Proposals when zero) to avoid noise.

- [ ] **Step 1: Write the failing test** (append to `tests/unit/digest.test.mjs`)

```javascript
import { mkdirSync as _mkdir, writeFileSync as _write } from 'node:fs';

test('digest Actions section lists slug · snippet (progressive disclosure)', () => {
  withHome((mns) => {
    const a = join(mns, 'actions', 'run-tests');
    _mkdir(a, { recursive: true });
    _write(join(a, 'action.json'), JSON.stringify({ slug: 'run-tests', promptSnippet: 'run the suite', inputs: { type: 'object' }, outputs: { type: 'object' } }));
    _write(join(a, 'run.mjs'), 'export async function main(){ return {}; }');
    const d = computeDigest(mns);
    assert.match(d.text, /## Actions/);
    assert.match(d.text, /run-tests · run the suite/);
    assert.equal(d.sections.actions.count, 1);
  }, { project: '# Project steering\n\nShip daily.\n' });
});

test('digest omits the Actions section when there are none', () => {
  withHome((mns) => {
    const d = computeDigest(mns);
    assert.doesNotMatch(d.text, /## Actions/);
  }, { project: '# Project steering\n\nShip daily.\n' });
});
```

NOTE: the `withHome` helper in `digest.test.mjs` already creates `knowledge/`, `instructions/`, `guardrails/` under `.mns` but **not** `actions/`. The first test above creates the action dir itself with `_mkdir(..., { recursive: true })`, so it works regardless. Keep using the existing `withHome`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/digest.test.mjs`
Expected: FAIL — no `## Actions`; `sections.actions` undefined.

- [ ] **Step 3: Implement in `mns/digest.mjs`**

Add the import with the other `./knowledge/...` imports:
```javascript
import { allActions } from './actions/manifest.mjs';
```
Add a fail-soft section helper next to the others (e.g. after `proposalsSection`):
```javascript
function actionsSection(mnsDir, limit) {
  try {
    const list = allActions(mnsDir);
    return { count: list.length, shown: list.slice(0, limit).map((a) => ({ slug: a.slug, kind: a.kind, promptSnippet: a.promptSnippet })) };
  } catch {
    return { count: 0, shown: [] };
  }
}
```
Then remove the deferred NOTE comment (the `// NOTE: the Actions index section is intentionally deferred…` lines) and, **after the Knowledge block and before the Proposals block**, render the section (budget-bound, like Knowledge):
```javascript
  const actions = actionsSection(mnsDir, knowledgeLimit);
  sections.actions = actions;
  if (actions.count) {
    lines.push('## Actions');
    lines.push(`${actions.count} available; run with \`mns act <slug>\`:`);
    let shownA = 0;
    for (const a of actions.shown) {
      const line = `- ${a.slug} · ${a.promptSnippet}`;
      if (lines.join('\n').length + line.length > charBudget && shownA > 0) break;
      lines.push(line);
      shownA++;
    }
    const droppedA = actions.count - shownA;
    if (droppedA > 0) lines.push(`- … (${droppedA} more — \`mns act list\`)`);
    lines.push('');
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/unit/digest.test.mjs`
Expected: PASS (all digest tests, incl. the 2 new).

- [ ] **Step 5: Commit**

```bash
git add mns/digest.mjs tests/unit/digest.test.mjs
git commit -m "feat(digest): Actions section — progressive disclosure (slug · snippet)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 10: Real-wire dogfood + full verification

**Files:**
- Create: `.mns/actions/run-tests/action.json`, `.mns/actions/run-tests/run.mjs` (a real action in THIS repo)

Author one real action, run it through the real binary, and confirm the structured result + that it appears in this repo's digest. Then run the whole suite and the playground.

- [ ] **Step 1: Scaffold a real action via the CLI**

```bash
cd /Users/hkc/Documents/motorsandsensors
node bin/mns.mjs act new run-tests
```
Expected: scaffolds `.mns/actions/run-tests/{action.json,run.mjs}`.

- [ ] **Step 2: Make it a meaningful action**

Overwrite `.mns/actions/run-tests/action.json`:
```json
{
  "slug": "run-tests",
  "title": "Run the mns test suite",
  "description": "Runs `npm test` and reports pass/fail counts.",
  "promptSnippet": "run the hermetic test suite (npm test)",
  "inputs": { "type": "object", "properties": {}, "required": [] },
  "outputs": { "type": "object", "properties": { "ok": { "type": "boolean" }, "summary": { "type": "string" } }, "required": ["ok"] },
  "default_args": {},
  "requires": []
}
```
Overwrite `.mns/actions/run-tests/run.mjs`:
```javascript
import { spawnSync } from 'node:child_process';

export async function main() {
  const r = spawnSync('npm', ['test'], { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(/pass (\d+)[\s\S]*?fail (\d+)/);
  const ok = r.status === 0;
  return { ok, summary: m ? `pass ${m[1]} / fail ${m[2]}` : (ok ? 'passed' : 'failed') };
}
```

- [ ] **Step 3: Run it through the real binary and inspect the marker**

```bash
cd /Users/hkc/Documents/motorsandsensors
node bin/mns.mjs act run-tests
```
Expected: the npm test logs, then a line `__MNS_ACT_RESULT__{"ok":true,"value":{"ok":true,"summary":"pass NNN / fail 0"}}`, then `✓ run-tests ok`, exit 0.

- [ ] **Step 4: Confirm it surfaces in this repo's digest**

```bash
node bin/mns.mjs digest | grep -A2 '## Actions'
```
Expected: `## Actions` with `- run-tests · run the hermetic test suite (npm test)`.

- [ ] **Step 5: Full suite + playground + list**

```bash
npm test 2>&1 | tail -5            # fail 0 (incl. all new actions tests)
npm run playground 2>&1 | tail -5  # pass/skip only, no fail
node bin/mns.mjs act list          # run-tests listed
```

- [ ] **Step 6: Commit**

```bash
git add .mns/actions/run-tests
git commit -m "feat(actions): dogfood — a real run-tests action, served into the digest

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Self-review notes (coverage of Spec 2a)

- **A1 (two kinds, one home)** → Task 3 (`allActions` distinguishes script vs runbook).
- **A2 (manifest, JSON-Schema single truth, zero-dep validator)** → Tasks 1–2 (validator), Task 3 (loader).
- **A3 (`mns act` dispatcher: validate→run→marker→validate; throw-to-fail; depth cap; prepareArguments)** → Tasks 4–5 (dispatch/runner), Task 7 (CLI run).
- **A4 (progressive disclosure into the digest)** → Task 9 (slug · snippet only, budget-bound).
- **A5 (MCP/OpenAI/Anthropic converters)** → Task 6, exposed via `mns act schema` in Task 8.
- **A3 authoring (`mns act new`)** → Task 8.
- **A7 (truncation + structured output)** → Task 4 (`truncate`), Task 7 (marker result line).
- **Dogfood** → Task 10.
- **Deferred to Plan 2b (by design):** A6 (the `actions/inbox/` → `mns review` → activate crystallization gate) and A7's trace side-channel (`details` → jsonl). Not in any task here.
