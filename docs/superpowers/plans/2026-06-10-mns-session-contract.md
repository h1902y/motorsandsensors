# mns Session Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Claude Code session in an mns project open *grounded* — the SessionStart hook injects a deterministic, token-budgeted faculty digest — and rewrite the steering block into a ground/cite/harvest contract, plus fix first-run paper cuts.

**Architecture:** A new pure module `mns/digest.mjs` computes a grounding brief by reusing existing faculty read APIs (`allItems`, `listProposals`, `loadRules`, instructions file). A new `mns digest` CLI command exposes it. The existing `mns hook SessionStart` path (`mns/commands/hook.mjs`) additionally emits the digest as Claude Code's `additionalContext` JSON — fail-open, exit 0, never disturbing the existing capture/live-record side effects. The faculty block in `mns/inject.mjs` bumps v3→v4 (the three-ritual contract). Polish touches `doctor.mjs`, `status.mjs`, `knowledge.mjs` (recall).

**Tech Stack:** Node ≥ 22, ES modules, zero runtime deps. Tests are `node:test` + `node:assert/strict`, run via `npm test`. Temp-dir test pattern (`mkdtempSync` + `rmSync`) per `tests/unit/scaffold.test.mjs`.

---

## Conventions for every task

- **Zero deps.** Only `node:*` builtins. No new packages.
- **Run a single test file:** `node --test tests/unit/<file>.test.mjs`. Run all: `npm test`.
- **Commit message trailer** (project convention — keep it):
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```
- **Fail-open discipline** (load-bearing): anything on the hook path must `try/catch` and degrade to silence; the hook always exits 0.
- The digest is **pure** (no `console.log`, no `process.exit`) — it returns a string/object. The CLI command and the hook do the I/O.

---

## File structure

| File | Responsibility | Action |
|---|---|---|
| `mns/digest.mjs` | Pure digest computation: read faculties → budgeted brief (string + structured) | **Create** |
| `mns/commands/digest.mjs` | `mns digest [--json] [--budget N]` CLI wrapper | **Create** |
| `bin/mns.mjs` | Route `digest` command; help text | **Modify** |
| `mns/commands/hook.mjs` | `SessionStart` also emits digest as `additionalContext` (fail-open) | **Modify** |
| `mns/inject.mjs` | Faculty block v3 → v4 (ground/cite/harvest contract) | **Modify** |
| `mns/commands/doctor.mjs` | Git-absence neutral; no "all good" under warnings | **Modify** |
| `mns/commands/status.mjs` | Lead with this project; machine inventory below | **Modify** |
| `mns/commands/knowledge.mjs` | `recall` empty-state: no-items vs no-matches | **Modify** |
| `tests/unit/digest.test.mjs` | Digest computation + budget + json shape | **Create** |
| `tests/unit/hook-sessionstart.test.mjs` | Hook emits digest / silent on error / exit 0 | **Create** |
| `tests/unit/inject.test.mjs` | v4 block assertions | **Modify** |

---

## Task 1: Digest core — empty home yields the interview directive

**Files:**
- Create: `mns/digest.mjs`
- Test: `tests/unit/digest.test.mjs`

The digest reads a faculty home rooted at an `.mns` dir (the `mnsDir` argument, matching `allItems(mnsDir)` etc.). For Task 1 we implement only the **Instructions** section: emit the active `instructions/project.md`, OR, when it is still the scaffold placeholder (or missing/empty), emit the interview directive.

Placeholder detection: the seed (`mns/scaffold.mjs` `PROJECT_SEED`) contains the marker `<!-- Fill in:`. Treat the instructions as "empty" when the file is missing, blank after stripping, or still contains that marker.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/digest.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeDigest } from '../../mns/digest.mjs';

// Build a throwaway .mns home; return its path (the mnsDir).
function withHome(fn, seed = {}) {
  const root = mkdtempSync(join(tmpdir(), 'mns-digest-'));
  const mns = join(root, '.mns');
  mkdirSync(join(mns, 'knowledge', 'items'), { recursive: true });
  mkdirSync(join(mns, 'knowledge', 'proposals'), { recursive: true });
  mkdirSync(join(mns, 'instructions'), { recursive: true });
  mkdirSync(join(mns, 'guardrails'), { recursive: true });
  if (seed.project != null) writeFileSync(join(mns, 'instructions', 'project.md'), seed.project);
  if (seed.rules != null) writeFileSync(join(mns, 'guardrails', 'rules.json'), seed.rules);
  try {
    return fn(mns);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('empty instructions → interview directive', () => {
  withHome((mns) => {
    const d = computeDigest(mns);
    assert.match(d.text, /steering is empty/i);
    assert.match(d.text, /interview/i);
    assert.equal(d.sections.instructions.empty, true);
  }, { project: '# Project steering\n\n<!-- Fill in: what this project is -->\n' });
});

test('filled instructions → steering text appears, not the directive', () => {
  withHome((mns) => {
    const d = computeDigest(mns);
    assert.match(d.text, /Ship daily\./);
    assert.doesNotMatch(d.text, /steering is empty/i);
    assert.equal(d.sections.instructions.empty, false);
  }, { project: '# Project steering\n\nShip daily. Tests before merge.\n' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/digest.test.mjs`
Expected: FAIL — `Cannot find module '../../mns/digest.mjs'`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// mns/digest.mjs
// The grounding digest — a pure, deterministic, zero-network, no-model brief of
// the faculty home, injected at session start. Returns { text, sections }.
// I/O-free: callers (the CLI + the SessionStart hook) handle output. Every
// reader is wrapped so a single broken faculty never sinks the whole digest.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PLACEHOLDER_MARK = '<!-- Fill in:';

/** Read instructions/project.md; classify empty vs steering text. */
function readInstructions(mnsDir) {
  const path = join(mnsDir, 'instructions', 'project.md');
  let raw = '';
  try {
    if (existsSync(path)) raw = readFileSync(path, 'utf8');
  } catch { /* unreadable → treat as empty */ }
  const stripped = raw.replace(/^#.*$/m, '').trim();
  const empty = !stripped || raw.includes(PLACEHOLDER_MARK);
  return { empty, text: empty ? '' : raw.trim() };
}

const INTERVIEW = [
  'Project steering is empty. Before substantive work, interview your human',
  '(what is this project, its conventions, its priorities), draft',
  '.mns/instructions/project.md from their answers, and get their approval.',
].join(' ');

/**
 * Compute the digest for a faculty home.
 * @param {string} mnsDir  path to the .mns directory
 * @returns {{ text: string, sections: object }}
 */
export function computeDigest(mnsDir) {
  const sections = {};
  const lines = ['# mns faculty digest', ''];

  const instr = readInstructions(mnsDir);
  sections.instructions = instr;
  lines.push('## Instructions');
  lines.push(instr.empty ? INTERVIEW : instr.text);
  lines.push('');

  return { text: lines.join('\n').trimEnd() + '\n', sections };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/unit/digest.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add mns/digest.mjs tests/unit/digest.test.mjs
git commit -m "feat(digest): instructions section — interview directive when empty

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 2: Digest — knowledge, proposals, guardrails sections

**Files:**
- Modify: `mns/digest.mjs`
- Test: `tests/unit/digest.test.mjs`

Add three more sections, reusing existing read APIs: `allItems(mnsDir)` (`mns/knowledge/items.mjs`), `listProposals(mnsDir)` (`mns/knowledge/proposals.mjs`), `loadRules(path)` (`mns/guardrails.mjs`). Knowledge lists top-N items (default 5) by salience = newest `created_at` first (cheap, explainable; semantic ranking is a later rung).

- [ ] **Step 1: Write the failing test** (append to `tests/unit/digest.test.mjs`)

```javascript
import { writeItem } from '../../mns/knowledge/items.mjs';
import { createProposal } from '../../mns/knowledge/proposals.mjs';

const FILLED = '# Project steering\n\nShip daily.\n';
const RULES = JSON.stringify({
  version: 1,
  rules: [{ id: 'no-secret-reads', action: 'deny', tool: '*', pattern: '\\.env', reason: 'secrets' }],
});

test('knowledge section lists items newest-first, capped', () => {
  withHome((mns) => {
    writeItem(mns, { id: 'older', type: 'fact', created_at: '2026-06-01T00:00:00Z', status: 'active', attributes: {}, relations: [], provenance: [], body: 'older fact' });
    writeItem(mns, { id: 'newer', type: 'command', created_at: '2026-06-09T00:00:00Z', status: 'active', attributes: {}, relations: [], provenance: [], body: 'newer fact' });
    const d = computeDigest(mns, { knowledgeLimit: 5 });
    assert.equal(d.sections.knowledge.count, 2);
    // newest first
    assert.ok(d.text.indexOf('newer') < d.text.indexOf('older'));
    assert.match(d.text, /## Knowledge/);
  }, { project: FILLED });
});

test('proposals + guardrails sections reflect state', () => {
  withHome((mns) => {
    createProposal(mns, { candidate: { type: 'fact', body: 'releases must be tagged' }, source: 'test', evidence: {} });
    const d = computeDigest(mns);
    assert.equal(d.sections.proposals.pending, 1);
    assert.match(d.text, /mns review/);
    assert.equal(d.sections.guardrails.count, 1);
    assert.match(d.text, /enforced/i);
  }, { project: FILLED, rules: RULES });
});

test('a broken faculty does not sink the digest (fail-soft)', () => {
  withHome((mns) => {
    // malformed rules.json → guardrails section degrades, others still render
    const d = computeDigest(mns);
    assert.match(d.text, /## Instructions/);
    assert.match(d.text, /## Knowledge/);
  }, { project: FILLED, rules: '{ not json' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/digest.test.mjs`
Expected: FAIL — `d.sections.knowledge` is undefined.

- [ ] **Step 3: Write minimal implementation** (edit `mns/digest.mjs`)

Add imports at the top, below the existing `node:` imports:

```javascript
import { allItems } from './knowledge/items.mjs';
import { listProposals } from './knowledge/proposals.mjs';
import { loadRules } from './guardrails.mjs';
```

Add these helpers above `computeDigest`:

```javascript
function knowledgeSection(mnsDir, limit) {
  try {
    const { items } = allItems(mnsDir);
    const ranked = [...items]
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, limit);
    return { count: items.length, shown: ranked.map((i) => ({ id: i.id, type: i.type, body: i.body })) };
  } catch {
    return { count: 0, shown: [] };
  }
}

function proposalsSection(mnsDir) {
  try {
    return { pending: listProposals(mnsDir).length };
  } catch {
    return { pending: 0 };
  }
}

function guardrailsSection(mnsDir) {
  try {
    const loaded = loadRules(join(mnsDir, 'guardrails', 'rules.json'));
    return { ok: loaded.ok, count: loaded.ok ? loaded.rules.length : 0 };
  } catch {
    return { ok: false, count: 0 };
  }
}
```

Change `computeDigest`'s signature and body to fold in the new sections (replace the existing function):

```javascript
export function computeDigest(mnsDir, { knowledgeLimit = 5 } = {}) {
  const sections = {};
  const lines = ['# mns faculty digest', ''];

  const instr = readInstructions(mnsDir);
  sections.instructions = instr;
  lines.push('## Instructions');
  lines.push(instr.empty ? INTERVIEW : instr.text);
  lines.push('');

  const knowledge = knowledgeSection(mnsDir, knowledgeLimit);
  sections.knowledge = knowledge;
  lines.push('## Knowledge');
  if (!knowledge.count) lines.push('(no items yet — propose facts to knowledge/inbox/)');
  else {
    lines.push(`${knowledge.count} item(s); most recent:`);
    for (const it of knowledge.shown) lines.push(`- ${it.id} · ${it.type} · ${it.body.split('\n')[0].slice(0, 80)}`);
  }
  lines.push('');

  const proposals = proposalsSection(mnsDir);
  sections.proposals = proposals;
  if (proposals.pending > 0) {
    lines.push('## Proposals');
    lines.push(`${proposals.pending} pending — remind the human to run \`mns review\`.`);
    lines.push('');
  }

  const guardrails = guardrailsSection(mnsDir);
  sections.guardrails = guardrails;
  lines.push('## Guardrails');
  lines.push(guardrails.count ? `${guardrails.count} rule(s) — the enforced gate is on; refusals are policy.` : 'no rules configured.');
  lines.push('');

  return { text: lines.join('\n').trimEnd() + '\n', sections };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/unit/digest.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add mns/digest.mjs tests/unit/digest.test.mjs
git commit -m "feat(digest): knowledge/proposals/guardrails sections, fail-soft per faculty

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 3: Digest — deterministic, priority-ordered budget truncation

**Files:**
- Modify: `mns/digest.mjs`
- Test: `tests/unit/digest.test.mjs`

A `budget` (in tokens; approximate as `chars / 4`) caps total length. Truncation is priority-ordered: Instructions and Guardrails are never dropped; the Knowledge item list truncates first (drop trailing items, then add an ellipsis line). Deterministic given the same input.

- [ ] **Step 1: Write the failing test** (append)

```javascript
test('budget truncates the knowledge list but keeps instructions + guardrails', () => {
  withHome((mns) => {
    for (let i = 0; i < 30; i++) {
      writeItem(mns, { id: `item-${String(i).padStart(2, '0')}`, type: 'fact', created_at: `2026-06-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`, status: 'active', attributes: {}, relations: [], provenance: [], body: `fact number ${i} with some descriptive text here` });
    }
    const tiny = computeDigest(mns, { budget: 80 }); // ~320-char knowledge budget
    // the variable knowledge list was truncated (not all 30 shown)...
    assert.match(tiny.text, /\(\d+ more/);
    assert.ok(tiny.sections.knowledge.shown.length < 30);
    // ...while the fixed sections survive (never dropped)...
    assert.match(tiny.text, /## Instructions/);
    assert.match(tiny.text, /## Guardrails/);
    // ...and it's a real reduction vs an unbounded digest...
    const full = computeDigest(mns, { budget: 100000, knowledgeLimit: 30 });
    assert.ok(tiny.text.length < full.text.length);
    // ...and deterministic.
    const again = computeDigest(mns, { budget: 80 });
    assert.equal(tiny.text, again.text);
  }, { project: '# Project steering\n\nShip daily.\n', rules: RULES });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/digest.test.mjs`
Expected: FAIL — text far exceeds the budget (no truncation yet).

- [ ] **Step 3: Write minimal implementation** (edit `mns/digest.mjs`)

Add a budget param and a truncation pass. Change the signature:

```javascript
export function computeDigest(mnsDir, { knowledgeLimit = 5, budget = 1500 } = {}) {
```

Replace the knowledge-list rendering block with a budget-aware loop. Keep a running `charBudget = budget * 4`. Render Instructions + Guardrails unconditionally; for the knowledge list, stop adding item lines once the running length would exceed `charBudget`, and append `- … (N more)` if any were dropped:

```javascript
  const charBudget = budget * 4;

  // ... instructions section unchanged ...

  const knowledge = knowledgeSection(mnsDir, knowledgeLimit);
  sections.knowledge = knowledge;
  lines.push('## Knowledge');
  if (!knowledge.count) {
    lines.push('(no items yet — propose facts to knowledge/inbox/)');
  } else {
    lines.push(`${knowledge.count} item(s); most recent:`);
    let shown = 0;
    for (const it of knowledge.shown) {
      const line = `- ${it.id} · ${it.type} · ${it.body.split('\n')[0].slice(0, 80)}`;
      if (lines.join('\n').length + line.length > charBudget && shown > 0) break;
      lines.push(line);
      shown++;
    }
    const dropped = knowledge.count - shown;
    if (dropped > 0) lines.push(`- … (${dropped} more — \`mns recall\`)`);
  }
  lines.push('');

  // ... proposals + guardrails sections unchanged (always rendered) ...
```

Note: Guardrails renders after Knowledge but is unconditional, so it survives truncation (the loop only bounds the knowledge item lines). This satisfies "Instructions and Guardrails never dropped."

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/unit/digest.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add mns/digest.mjs tests/unit/digest.test.mjs
git commit -m "feat(digest): priority-ordered budget truncation (deterministic)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 4: `mns digest` CLI command

**Files:**
- Create: `mns/commands/digest.mjs`
- Modify: `bin/mns.mjs`

`mns digest` prints the human-readable text; `mns digest --json` prints `{ text, sections }`; `--budget N` overrides. Resolves the home via `paths().dir` (`mns/store.mjs`).

- [ ] **Step 1: Write the command**

```javascript
// mns/commands/digest.mjs
// `mns digest [--json] [--budget N]` — print the grounding brief a session
// start would inject. Lets a human (or a hookless host) see exactly what the
// agent sees.

import { paths } from '../store.mjs';
import { computeDigest } from '../digest.mjs';

export function digest(args) {
  const mnsDir = paths().dir;
  const opts = {};
  if (args.budget) opts.budget = Number(args.budget);
  const d = computeDigest(mnsDir, opts);
  if (args.json) console.log(JSON.stringify(d, null, 2));
  else process.stdout.write(d.text);
}
```

- [ ] **Step 2: Wire the route in `bin/mns.mjs`**

Add the import alongside the other command imports (after the `knowledge` import line):

```javascript
import { digest } from '../mns/commands/digest.mjs';
```

Add the case in the `switch (cmd)` block (after the `knowledge` case):

```javascript
  case 'digest': digest(args); break;
```

Add a help line in `help()` after the `knowledge reindex|audit` entry:

```
  digest [--json] [--budget N]
                            print the session-start grounding brief
```

- [ ] **Step 3: Verify by hand in a scratch home**

Run:
```bash
D=$(mktemp -d) && (cd "$D" && git init -q && node /Users/hkc/Documents/motorsandsensors/bin/mns.mjs init >/dev/null && node /Users/hkc/Documents/motorsandsensors/bin/mns.mjs digest)
```
Expected: prints `# mns faculty digest`, an Instructions section with the **interview directive** (fresh home has the placeholder), a Knowledge "(no items yet …)" line, and a Guardrails line naming the seeded rule count (3).

- [ ] **Step 4: Verify `--json`**

Run: `cd "$D" && node /Users/hkc/Documents/motorsandsensors/bin/mns.mjs digest --json` (reuse `$D` from Step 3)
Expected: valid JSON with `text` and `sections.instructions.empty === true`.

- [ ] **Step 5: Commit**

```bash
git add mns/commands/digest.mjs bin/mns.mjs
git commit -m "feat(digest): mns digest CLI (--json, --budget)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 5: SessionStart hook emits the digest (fail-open)

**Files:**
- Modify: `mns/commands/hook.mjs`
- Test: `tests/unit/hook-sessionstart.test.mjs`

The CLI entry `runHook` (in `hook.mjs`) currently, for non-`PreToolUse` events, calls `handleHook` (which opens the live record + captures) and writes nothing to stdout. We add: on `SessionStart`, after the existing side effects, compute the digest and write the `additionalContext` JSON to stdout — wrapped so any failure emits nothing (the capture still happened). We introduce a pure helper `sessionStartContext(cwd)` so it is unit-testable without stdin/stdout.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/hook-sessionstart.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sessionStartContext } from '../../mns/commands/hook.mjs';

function withHome(fn, project) {
  const root = mkdtempSync(join(tmpdir(), 'mns-hook-'));
  const mns = join(root, '.mns');
  mkdirSync(join(mns, 'knowledge', 'items'), { recursive: true });
  mkdirSync(join(mns, 'knowledge', 'proposals'), { recursive: true });
  mkdirSync(join(mns, 'instructions'), { recursive: true });
  mkdirSync(join(mns, 'guardrails'), { recursive: true });
  writeFileSync(join(mns, 'instructions', 'project.md'), project);
  try {
    return fn(root); // pass repo root; paths() derives .mns under it
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('sessionStartContext returns the Claude additionalContext shape', () => {
  withHome((root) => {
    const out = sessionStartContext(root);
    assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
    assert.match(out.hookSpecificOutput.additionalContext, /mns faculty digest/);
    assert.match(out.hookSpecificOutput.additionalContext, /Ship daily/);
  }, '# Project steering\n\nShip daily.\n');
});

test('sessionStartContext returns null when the home is absent (fail-open)', () => {
  const root = mkdtempSync(join(tmpdir(), 'mns-nohome-'));
  try {
    // no .mns at all → digest still computes against an empty dir, but if
    // anything throws we must get null, never a throw.
    const out = sessionStartContext(root);
    assert.ok(out === null || typeof out.hookSpecificOutput === 'object');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/hook-sessionstart.test.mjs`
Expected: FAIL — `sessionStartContext` is not exported.

- [ ] **Step 3: Write minimal implementation** (edit `mns/commands/hook.mjs`)

Add imports near the top (with the other imports):

```javascript
import { paths } from '../store.mjs';
import { computeDigest } from '../digest.mjs';
```

(`paths` may already be imported — if so, don't duplicate it.)

Add the pure helper (e.g. above `runHook`):

```javascript
/**
 * Build Claude Code's SessionStart additionalContext payload from the faculty
 * digest. Returns null on ANY failure (fail-open: the session proceeds with no
 * injected context, never a broken hook).
 * @param {string} cwd  repo cwd; paths() resolves the .mns home under it
 */
export function sessionStartContext(cwd = process.cwd()) {
  try {
    const mnsDir = paths(cwd).dir;
    const { text } = computeDigest(mnsDir);
    if (!text || !text.trim()) return null;
    return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } };
  } catch {
    return null;
  }
}
```

In `runHook`, in the `else` branch that handles non-PreToolUse events, after `handleHook(...)`, emit the digest for SessionStart only. Replace:

```javascript
    } else {
      handleHook({ event, payload, host });
    }
```

with:

```javascript
    } else {
      handleHook({ event, payload, host });
      if (event === 'SessionStart') {
        const ctx = sessionStartContext();
        if (ctx) process.stdout.write(JSON.stringify(ctx));
      }
    }
```

Note: `handleHook` is already wrapped by the outer `try/catch` in `runHook`, and `sessionStartContext` swallows its own errors — so capture failures and digest failures are independent, and the hook still `process.exit(0)`s at the end.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/unit/hook-sessionstart.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: End-to-end smoke through the real binary**

Run:
```bash
D=$(mktemp -d) && cd "$D" && git init -q && node /Users/hkc/Documents/motorsandsensors/bin/mns.mjs init >/dev/null
echo '{"session_id":"smoke","transcript_path":"/nonexistent","source":"startup"}' | node /Users/hkc/Documents/motorsandsensors/bin/mns.mjs hook SessionStart; echo " [exit $?]"
```
Expected: a single line of JSON containing `"hookEventName":"SessionStart"` and `mns faculty digest`, followed by ` [exit 0]`. (The bogus transcript path makes capture a no-op via `safeCapture`; the digest still emits — proving independence.)

- [ ] **Step 6: Commit**

```bash
git add mns/commands/hook.mjs tests/unit/hook-sessionstart.test.mjs
git commit -m "feat(hook): SessionStart injects the faculty digest (fail-open, exit 0)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 6: Faculty block v4 — the ground/cite/harvest contract

**Files:**
- Modify: `mns/inject.mjs`
- Test: `tests/unit/inject.test.mjs`

Bump `BLOCK_VERSION` to 4 and rewrite `facultiesBlock` body into the three-ritual contract. The existing version-aware machinery (`BLOCK_RE` matches any `v\d+`) already upgrades v3→v4 in place; we only change the constant and the content.

- [ ] **Step 1: Write the failing test** (append to `tests/unit/inject.test.mjs`)

```javascript
test('v4 block carries the ground/cite/harvest contract', () => {
  const out = injectBlock('# proj\n');
  assert.ok(out.includes('mns:faculties:v4'), 'is v4');
  assert.match(out, /digest/i);             // ground on the digest
  assert.match(out, /from knowledge:/);     // cite in-flight
  assert.match(out, /knowledge\/inbox\//);  // harvest at close
  assert.match(out, /mns review/);
});

test('a v3 block upgrades to v4 in place, user text intact', () => {
  const v3 = injectBlock('# proj\n', facultiesBlock(3)) + '\n## after\n';
  const v4 = injectBlock(v3);
  assert.ok(v4.includes('mns:faculties:v4'));
  assert.ok(!v4.includes('mns:faculties:v3'));
  assert.ok(v4.includes('## after'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/inject.test.mjs`
Expected: FAIL — block is still v3; `from knowledge:` not present.

- [ ] **Step 3: Write minimal implementation** (edit `mns/inject.mjs`)

Change the version constant:

```javascript
export const BLOCK_VERSION = 4;
```

Replace the `facultiesBlock` return template body with the contract:

```javascript
export function facultiesBlock(version = BLOCK_VERSION) {
  return `${BEGIN(version)}
## mns — agent faculty home

This project has an mns faculty home at \`.mns/\` (managed by the mns CLI). Work to this contract:

- **Ground.** At session start you receive an *mns digest* (instructions, knowledge, proposals, guardrails). Trust it as ground truth; don't re-derive what it states or re-read faculty files it already summarized.
- **Cite in-flight.** When an answer draws on a stored fact, say \`from knowledge: <id>\`; when you follow a runbook/action, name it. Make the faculty visible.
- **Harvest at close.** Before ending, propose durable learnings as one-fact files in \`.mns/knowledge/inbox/\` (plain text is fine) — a human reviews via \`mns review\`. Never write \`items/\` directly.
- **Respect \`.mns/guardrails/\`** — hard rules, *enforced* on tool calls by the mns gate; a refusal there is policy, not preference.
- Do **not** read \`.mns/traces/\` or \`.mns/live/\` (mns observability internals).
${END}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/unit/inject.test.mjs`
Expected: PASS (all — the existing v1→v2 test still holds since `BLOCK_RE` is version-agnostic).

- [ ] **Step 5: Commit**

```bash
git add mns/inject.mjs tests/unit/inject.test.mjs
git commit -m "feat(inject): faculty block v4 — ground/cite/harvest session contract

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 7: Polish — `doctor` (git-absence neutral, honest summary)

**Files:**
- Modify: `mns/commands/doctor.mjs`
- Test: `tests/unit/doctor.test.mjs` (create)

Two fixes: (a) absence of a git repo is **neutral info**, not a ⚠ warning; (b) never print "all good" when any warning was emitted. We make `doctor` testable by extracting the tally. Minimal approach: track a `warnings` counter alongside `problems`, and gate the final line on both. The git line becomes an `info` line.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/doctor.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summaryLine } from '../../mns/commands/doctor.mjs';

test('summary: clean when no problems and no warnings', () => {
  assert.match(summaryLine(0, 0), /all good/);
});

test('summary: does not say "all good" when warnings exist', () => {
  const s = summaryLine(0, 2);
  assert.doesNotMatch(s, /all good/);
  assert.match(s, /2 warning/);
});

test('summary: reports problems', () => {
  assert.match(summaryLine(1, 0), /1 problem/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/doctor.test.mjs`
Expected: FAIL — `summaryLine` not exported.

- [ ] **Step 3: Write minimal implementation** (edit `mns/commands/doctor.mjs`)

Add the pure helper (top of file, after imports):

```javascript
/** The closing line: honest about warnings, never "all good" under them. */
export function summaryLine(problems, warnings) {
  if (problems) return `\n${problems} problem(s) found`;
  if (warnings) return `\n${warnings} warning(s) — see ⚠ above`;
  return '\nall good';
}
```

In `doctor()`: add a `let warnings = 0;` next to `let problems = 0;`, and make `warn` increment it:

```javascript
  let problems = 0;
  let warnings = 0;
  const ok = (m) => console.log(`  ✓ ${m}`);
  const info = (m) => console.log(`  · ${m}`);
  const warn = (m) => {
    console.log(`  ⚠ ${m}`);
    warnings++;
  };
```

Change the git check from `warn` to neutral `info`:

```javascript
  const { commit, branch } = gitInfo();
  if (commit) ok(`git repo on ${branch} @ ${commit.slice(0, 8)}`);
  else info('not a git repo — capture works; sessions just won’t link to a commit');
```

Replace the final line:

```javascript
  console.log(summaryLine(problems, warnings));
  process.exit(problems ? 1 : 0);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/unit/doctor.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Sanity-check the real command in a non-git dir**

Run: `D=$(mktemp -d) && cd "$D" && node /Users/hkc/Documents/motorsandsensors/bin/mns.mjs init >/dev/null && node /Users/hkc/Documents/motorsandsensors/bin/mns.mjs doctor; echo "[exit $?]"`
Expected: git line shows `·` (info, not ⚠); if `ollama`/semantic is off (a real ⚠), the summary says "N warning(s)", NOT "all good"; exit 0.

- [ ] **Step 6: Commit**

```bash
git add mns/commands/doctor.mjs tests/unit/doctor.test.mjs
git commit -m "fix(doctor): git-absence is neutral info; no 'all good' under warnings

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 8: Polish — `status` leads with this project; `recall` empty-state

**Files:**
- Modify: `mns/commands/status.mjs`
- Modify: `mns/commands/knowledge.mjs`
- Test: `tests/unit/recall-empty.test.mjs` (create)

`status`: print the recorded-sessions block (this project) FIRST, then the machine-wide host inventory below. `recall`: distinguish "no items yet" from "no matches for this query" by checking `allItems`.

- [ ] **Step 1: Write the failing test for the recall message**

We extract a pure message picker so it's testable without a DB.

```javascript
// tests/unit/recall-empty.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recallEmptyMessage } from '../../mns/commands/knowledge.mjs';

test('no items at all → points at remember', () => {
  assert.match(recallEmptyMessage({ itemCount: 0, query: 'foo' }), /no knowledge yet/i);
  assert.match(recallEmptyMessage({ itemCount: 0, query: 'foo' }), /mns remember/);
});

test('items exist but query missed → points at query/reindex', () => {
  const m = recallEmptyMessage({ itemCount: 5, query: 'foo' });
  assert.match(m, /no matches/i);
  assert.doesNotMatch(m, /no knowledge yet/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/recall-empty.test.mjs`
Expected: FAIL — `recallEmptyMessage` not exported.

- [ ] **Step 3: Implement the recall message picker** (edit `mns/commands/knowledge.mjs`)

Add the exported helper (near the top, after the `parsePair` helper):

```javascript
/** Empty-result copy for recall: distinguish "no items" from "no match". */
export function recallEmptyMessage({ itemCount, query }) {
  if (!itemCount) return '(no knowledge yet — add facts with `mns remember`)';
  return `(no matches for "${query}" — try other terms, or \`mns knowledge reindex\`)`;
}
```

In `recall`, replace the lexical empty branch (currently `if (!rows.length) return console.log('(no matches — try \`mns knowledge reindex\`?)');`) with:

```javascript
  if (!rows.length) {
    const { items } = allItems(mnsDir);
    return console.log(recallEmptyMessage({ itemCount: items.length, query }));
  }
```

(`allItems` is already imported in this file.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/unit/recall-empty.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Reorder `status` output** (edit `mns/commands/status.mjs`)

Rewrite `status()` so the project block prints first:

```javascript
export function status() {
  const { sessions } = readIndex();
  console.log(`this project — recorded sessions (.mns/sessions.json): ${sessions.length}`);
  if (!sessions.length) {
    console.log('  none yet — run `mns capture`, or just start your agent (live capture)');
  } else {
    console.log('');
    console.log('  STATUS     HOST          DUR     GIT       T/TOOLS/ERR  SESSION');
    for (const s of sessions.slice(0, 12)) {
      const dur = fmtDur(s.durationMs || 0).padStart(6);
      const git = (s.git?.commit ? s.git.commit.slice(0, 7) : '-------').padEnd(8);
      const cnt = `${s.counts?.turns ?? 0}/${s.counts?.tools ?? 0}/${s.counts?.errors ?? 0}`.padEnd(11);
      console.log(`  ${s.status.padEnd(10)} ${s.host.padEnd(13)} ${dur}  ${git}  ${cnt}  ${s.id.slice(0, 8)}`);
    }
    if (sessions.length > 12) console.log(`  … and ${sessions.length - 12} more`);
  }

  const hosts = detected();
  console.log('\nhosts detected on this machine:');
  if (!hosts.length) {
    console.log('  (none — no supported agent data found)');
  } else {
    for (const a of hosts) {
      const n = a.listSessions({ cwd: process.cwd() }).length;
      console.log(`  ● ${a.name}  (${n} session${n === 1 ? '' : 's'} available)`);
    }
  }
}
```

- [ ] **Step 6: Eyeball `status` ordering**

Run: `cd /Users/hkc/Documents/motorsandsensors && node bin/mns.mjs status | head -4`
Expected: first line begins `this project — recorded sessions`; the machine host inventory appears lower.

- [ ] **Step 7: Commit**

```bash
git add mns/commands/status.mjs mns/commands/knowledge.mjs tests/unit/recall-empty.test.mjs
git commit -m "fix(status,recall): project-first status; honest recall empty-state

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 9: Greenfield "next steps" mention the digest

**Files:**
- Modify: `mns/commands/init.mjs`

Small copy change: the greenfield `next` hint should tell the user the agent now opens grounded. Locate the `next` line in `init.mjs` (the greenfield branch prints `next : \`mns enable\` for live capture · …`).

- [ ] **Step 1: Find the line**

Run: `grep -n "next" mns/commands/init.mjs`
Expected: a line printing the post-init hint.

- [ ] **Step 2: Add the digest to the hint**

Append to that hint string (keep the existing content; add the clause):

```
 · run `mns digest` to preview the grounding your agent opens with
```

- [ ] **Step 3: Verify**

Run: `D=$(mktemp -d) && cd "$D" && git init -q && node /Users/hkc/Documents/motorsandsensors/bin/mns.mjs init | grep -i digest`
Expected: the next-steps line now mentions `mns digest`.

- [ ] **Step 4: Commit**

```bash
git add mns/commands/init.mjs
git commit -m "docs(init): greenfield next-steps mention mns digest

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 10: Full suite + dogfood measurement

**Files:** none (verification only)

- [ ] **Step 1: Run the whole suite**

Run: `cd /Users/hkc/Documents/motorsandsensors && npm test 2>&1 | tail -8`
Expected: `pass` count increased by the new tests; `fail 0`.

- [ ] **Step 2: Run the playground (no regressions)**

Run: `npm run playground 2>&1 | tail -5`
Expected: pass/skip only (exit 0 or 2 per playground); no fail.

- [ ] **Step 3: Dogfood — measure the digest token cost**

Run:
```bash
cd /Users/hkc/Documents/motorsandsensors
node bin/mns.mjs digest | wc -c
```
Expected: a character count; divide by 4 for the approximate token cost. Record this number — it is the efficiency-thesis figure (the grounding cost this repo's own faculty home injects per session). Note it in the eventual experiments/LOG.md entry (the experiment record is written separately, not in this plan).

- [ ] **Step 4: Final commit if any verification fixups were needed**

```bash
git add -A
git commit -m "test: session-contract suite green + digest cost measured

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(Skip if Step 1–3 needed no changes.)

---

## Self-review notes (coverage of Spec 1)

- **Component 1 (`mns digest`)** → Tasks 1–4 (instructions/knowledge/proposals/guardrails sections, budget, CLI; `--json`, salience newest-first, fail-soft per faculty).
- **Component 2 (SessionStart injection)** → Task 5 (exact `additionalContext` shape, fail-open, exit 0, independence from capture verified by the bogus-transcript smoke).
- **Component 3 (block v4)** → Task 6 (ground/cite/harvest; v3→v4 in-place upgrade).
- **Component 4 (polish)** → Tasks 7–9 (doctor git/summary, status order, recall empty-state, init hint).
- **Testing + dogfood** → Task 10 (suite, playground, digest cost measurement).
- **Out of scope** (SessionEnd auto-distill, `mns brief`, other-host delivery, substrate format changes) → not in any task, by design.
