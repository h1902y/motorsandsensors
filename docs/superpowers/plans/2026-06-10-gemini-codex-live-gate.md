# Gemini + Codex Live Capture + Gate — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `mns enable --host gemini-cli` / `--host codex` installs each host's native lifecycle + pre-tool hooks so live capture is invisible and the guardrails gate enforces `rules.json` on tool calls — wired from the real Phase-0 captures, not docs.

**Architecture:** Design B unchanged — hooks are signals that re-capture the transcript via the existing adapters; they never build spans. All three hosts (Claude/Gemini/Codex) deliver hook payloads as **stdin JSON** in the **same `{hooks:{Event:[{hooks:[{type,command}]}]}}` config shape**, so the existing `addHooks`/`removeHooks` generalize; only event names, the target file, the capture `ref`, and the gate's block-response format differ per host. Codex's block schema is **identical to Claude's** (reused as-is); Gemini's is `{decision:"deny",reason}`.

**Tech Stack:** Node ≥ 22, ES modules, zero deps, `node:test`. Golden fixtures: `tests/fixtures/hooks/{gemini-cli,codex}.probe.jsonl` (real captures).

---

## Real-wire facts (from Phase-0 captures — the source of truth)

**Gemini CLI** (`tests/fixtures/hooks/gemini-cli.probe.jsonl`) — fires headless + interactive; project `.gemini/settings.json` honored:
- Events: `SessionStart` (open), `BeforeAgent`/`AfterAgent` (turn), `BeforeTool` (gate), `AfterTool`, `SessionEnd` (clean end).
- stdin JSON: `{session_id, transcript_path, cwd, hook_event_name, timestamp, …}`; `BeforeTool` adds `tool_name`, `tool_input`.
- `transcript_path` = `~/.gemini/tmp/<proj>/chats/session-*.json`; the existing adapter parses `~/.gemini/tmp/<proj>/logs.json` filtered by `sessionId` → derive `logs.json = join(dirname(dirname(transcript_path)), 'logs.json')`.
- Block: stdout JSON `{decision:"deny", reason}` (exit 0).

**Codex** (`tests/fixtures/hooks/codex.probe.jsonl`) — **interactive only** (exec fires nothing); repo-local `.codex/hooks.json` honored interactively:
- Events: `SessionStart` (open), `UserPromptSubmit`/`Stop` (turn), `PreToolUse` (gate), `PostToolUse`. No clean end → staleness reconcile (like Claude).
- stdin JSON: `{session_id, turn_id, transcript_path, cwd, hook_event_name, model, permission_mode, …}`; `PreToolUse` adds `tool_name` (`"Bash"`), `tool_input` (`{command}`), `tool_use_id`.
- `transcript_path` = `~/.codex/sessions/.../rollout-*.jsonl` — the codex adapter's `parse(ref)` takes this path **directly**.
- Block: `{hookSpecificOutput:{permissionDecision:"deny",…}}` — identical to Claude.

---

## Conventions for every task

- Zero deps (`node:*` only). Run one test: `node --test tests/unit/<f>.test.mjs`. All: `npm test`.
- Commit trailer (exact): `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Use explicit `git add <files>` (an unrelated CLAUDE.md edit is in the tree — never `git add -A`).
- Hooks must never break the host: commands keep the `|| true` wrapper; the gate fails open (no output = host's normal flow).

---

## File structure

| File | Responsibility | Action |
|---|---|---|
| `mns/commands/hook.mjs` | event sets (+AfterAgent/UserPromptSubmit); per-host stdin parse + ref; gate routes BeforeTool/PreToolUse with per-host serializer | **Modify** |
| `mns/guardrails.mjs` | add `toGeminiDecision(verdict)` (the `{decision,reason}` block shape) | **Modify** |
| `mns/live/install.mjs` | generalize hook add/remove (hooks-only) so Gemini/Codex reuse it; keep Claude deny-rules separate | **Modify** |
| `mns/commands/enable.mjs` | `--host gemini-cli` (project `.gemini/settings.json`) + `--host codex` (repo `.codex/hooks.json`) branches + disable | **Modify** |
| `mns/scaffold.mjs` | gitignore the generated `.gemini/settings.json` + `.codex/hooks.json` | **Modify** |
| `tests/unit/hook-hosts.test.mjs` | gemini/codex event routing + ref + gate serializer, against the golden fixtures | **Create** |
| `tests/unit/install-hosts.test.mjs` | per-host hook config shape (add/remove idempotent) | **Create** |

---

## Task 1: Gemini decision serializer

**Files:**
- Modify: `mns/guardrails.mjs`
- Test: `tests/unit/guardrails.test.mjs`

The gate verdict (`{action:'deny'|'ask', rule, reason}`) is host-agnostic; Codex/Claude use `toPreToolUseDecision` (hookSpecificOutput). Gemini needs `{decision:"deny", reason}`. Add `toGeminiDecision`. Gemini has no "ask" decision → map `ask` to defer (null, let Gemini's own approval prompt happen); `deny` → block.

- [ ] **Step 1: Write the failing test** (append to `tests/unit/guardrails.test.mjs`)

```javascript
import { toGeminiDecision } from '../../mns/guardrails.mjs';

test('toGeminiDecision: deny → {decision:deny,reason}; ask/allow → null (defer)', () => {
  assert.deepEqual(
    toGeminiDecision({ action: 'deny', rule: 'no-secret-reads', reason: 'secrets' }),
    { decision: 'deny', reason: 'guardrail no-secret-reads: secrets' },
  );
  assert.equal(toGeminiDecision({ action: 'ask', rule: 'r', reason: 'x' }), null);
  assert.equal(toGeminiDecision({ action: 'allow', rule: 'r', reason: 'x' }), null);
  assert.equal(toGeminiDecision(null), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/guardrails.test.mjs`
Expected: FAIL — `toGeminiDecision` not exported.

- [ ] **Step 3: Implement** (add to `mns/guardrails.mjs`, after `toPreToolUseDecision`)

```javascript
/**
 * Gemini CLI block shape: stdout JSON { decision: "deny", reason } (exit 0).
 * Gemini has no "ask" decision → defer (null) so its own approval flow runs.
 * Only an explicit deny blocks. (Verified block format — see Phase-0 research.)
 */
export function toGeminiDecision(verdict) {
  if (!verdict || verdict.action !== 'deny') return null;
  return { decision: 'deny', reason: `guardrail ${verdict.rule}: ${verdict.reason}` };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/unit/guardrails.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mns/guardrails.mjs tests/unit/guardrails.test.mjs
git commit -m "feat(guardrails): toGeminiDecision serializer ({decision:deny,reason})

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 2: Hook event mapping + per-host payload/ref (capture)

**Files:**
- Modify: `mns/commands/hook.mjs`
- Test: `tests/unit/hook-hosts.test.mjs`

Add Gemini/Codex turn events to the sets, parse their stdin payload in `runHook`, and build the right capture `ref` per host in `handleHook`. (`SessionStart`/`Stop`/`SessionEnd` names are already mapped; only `AfterAgent` (gemini turn) and `UserPromptSubmit` (codex turn) are new.)

- [ ] **Step 1: Write the failing test** (`tests/unit/hook-hosts.test.mjs`)

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { geminiRef } from '../../mns/commands/hook.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fx = (h) => readFileSync(join(here, '..', 'fixtures', 'hooks', `${h}.probe.jsonl`), 'utf8')
  .trim().split('\n').map((l) => JSON.parse(l)).map((r) => JSON.parse(r.stdin));

test('geminiRef derives logs.json + sessionId from a real BeforeTool payload', () => {
  const beforeTool = fx('gemini-cli').find((p) => p.hook_event_name === 'BeforeTool');
  const ref = geminiRef(beforeTool);
  assert.equal(ref.sessionId, beforeTool.session_id);
  assert.ok(ref.file.endsWith('/logs.json'), ref.file);
  // logs.json sits two dirs up from .../chats/session-*.json
  assert.ok(ref.file.includes('/.gemini/tmp/'), ref.file);
  assert.ok(!ref.file.includes('/chats/'), 'derived logs.json, not the chats transcript');
});

test('real codex PreToolUse payload carries tool_name + tool_input for the gate', () => {
  const pre = fx('codex').find((p) => p.hook_event_name === 'PreToolUse');
  assert.equal(pre.tool_name, 'Bash');
  assert.equal(pre.tool_input.command, 'ls -la');
  assert.ok(pre.transcript_path.endsWith('.jsonl'), 'codex ref is the rollout jsonl');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/hook-hosts.test.mjs`
Expected: FAIL — `geminiRef` not exported.

- [ ] **Step 3: Implement** (`mns/commands/hook.mjs`)

(a) Add `AfterAgent` (gemini turn) and `UserPromptSubmit` (codex turn) to `TURN`. Update the comment. The sets become:

```javascript
// Claude: SessionStart/Stop/SessionEnd · OpenCode: session.created/idle/deleted
// Gemini: SessionStart/AfterAgent/SessionEnd · Codex: SessionStart/UserPromptSubmit/Stop (no clean end)
const OPEN = new Set(['SessionStart', 'session.created']);
const TURN = new Set(['Stop', 'session.idle', 'AfterAgent', 'UserPromptSubmit']);
const END = new Set(['SessionEnd', 'session.deleted']);
```

(b) `hook.mjs` already imports `join` from `node:path` (`import { join } from 'node:path'`). Extend that import to also bring `dirname`:
```javascript
import { join, dirname } from 'node:path';
```
Then add a `geminiRef` helper (exported for tests) near the top, after the sets:

```javascript
/** Gemini's adapter reads logs.json filtered by sessionId; derive it from the
 *  hook's transcript_path (~/.gemini/tmp/<proj>/chats/session-*.json → ../../logs.json). */
export function geminiRef(payload = {}) {
  const tp = payload.transcript_path || '';
  const projDir = dirname(dirname(tp)); // .../chats/x.json → .../<proj>
  return { file: join(projDir, 'logs.json'), sessionId: payload.session_id };
}
```

(c) In `handleHook`, replace the single-line `ref` with per-host construction:

```javascript
  const id = payload.session_id;
  if (!id) return { event, skipped: 'no session_id' };
  let ref;
  if (host === 'opencode') ref = id;                 // adapter reads its DB by id
  else if (host === 'gemini-cli') ref = geminiRef(payload);
  else ref = payload.transcript_path;                 // claude-code, codex: the transcript/rollout file
  const adapter = byName(host);
```

(d) In `runHook`, read stdin JSON for all stdin-delivering hosts (claude-code, gemini-cli, codex), keep opencode on `--session`. Change:

```javascript
  let payload = {};
  if (host === 'claude-code') {
    try { payload = JSON.parse(readFileSync(0, 'utf8')); } catch { /* no/garbage stdin */ }
  } else { payload = { session_id: session }; }
```
to:
```javascript
  let payload = {};
  if (host === 'opencode') {
    payload = { session_id: session };
  } else {
    // claude-code, gemini-cli, codex all pipe a JSON payload on fd 0
    try { payload = JSON.parse(readFileSync(0, 'utf8')); } catch { /* no/garbage stdin */ }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/unit/hook-hosts.test.mjs`
Expected: PASS (2 tests). Then `npm test 2>&1 | tail -5` → fail 0 (claude/opencode hook tests unbroken).

- [ ] **Step 5: Commit**

```bash
git add mns/commands/hook.mjs tests/unit/hook-hosts.test.mjs
git commit -m "feat(hook): gemini/codex event mapping + stdin parse + per-host capture ref

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 3: Gate routing for BeforeTool / PreToolUse with per-host serializer

**Files:**
- Modify: `mns/commands/hook.mjs`
- Test: `tests/unit/hook-hosts.test.mjs`

The gate currently fires only for Claude `PreToolUse` and always emits the Claude schema. Route Gemini `BeforeTool` + Codex `PreToolUse` too, and serialize per host (Codex → hookSpecificOutput; Gemini → `{decision:deny}`). `gateToolUse` already returns the verdict-derived decision; we make it host-aware.

- [ ] **Step 1: Write the failing test** (append to `tests/unit/hook-hosts.test.mjs`)

```javascript
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { gateDecision } from '../../mns/commands/hook.mjs';

function withRules(rules, fn) {
  const root = mkdtempSync(join(tmpdir(), 'mns-gate-'));
  mkdirSync(join(root, '.mns', 'guardrails'), { recursive: true });
  writeFileSync(join(root, '.mns', 'guardrails', 'rules.json'), JSON.stringify({ version: 1, rules }));
  try { return fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

const SECRET_RULE = { id: 'no-secret-reads', action: 'deny', tool: '*', pattern: '\\.env', reason: 'secrets' };

test('gateDecision: codex deny → hookSpecificOutput (Claude-shaped)', () => {
  withRules([SECRET_RULE], (cwd) => {
    const d = gateDecision({ host: 'codex', payload: { session_id: 's', tool_name: 'Bash', tool_input: { command: 'cat .env' } }, cwd });
    assert.equal(d.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(d.hookSpecificOutput.permissionDecisionReason, /no-secret-reads/);
  });
});

test('gateDecision: gemini deny → {decision:deny,reason}', () => {
  withRules([SECRET_RULE], (cwd) => {
    const d = gateDecision({ host: 'gemini-cli', payload: { session_id: 's', tool_name: 'read_file', tool_input: { file_path: '.env' } }, cwd });
    assert.equal(d.decision, 'deny');
    assert.match(d.reason, /no-secret-reads/);
  });
});

test('gateDecision: no match → null (fail-open) for both hosts', () => {
  withRules([SECRET_RULE], (cwd) => {
    assert.equal(gateDecision({ host: 'codex', payload: { tool_name: 'Bash', tool_input: { command: 'ls' } }, cwd }), null);
    assert.equal(gateDecision({ host: 'gemini-cli', payload: { tool_name: 'read_file', tool_input: { file_path: 'README.md' } }, cwd }), null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/hook-hosts.test.mjs`
Expected: FAIL — `gateDecision` not exported.

- [ ] **Step 3: Implement** (`mns/commands/hook.mjs`)

Add imports at top (if not present): `toGeminiDecision` alongside the existing guardrails import. Find:
```javascript
import { loadRules, evaluate, toPreToolUseDecision } from '../guardrails.mjs';
```
→
```javascript
import { loadRules, evaluate, toPreToolUseDecision, toGeminiDecision } from '../guardrails.mjs';
```

Add a host-aware `gateDecision` (exported) that wraps the existing evaluate+log, then serializes per host. Place it next to `gateToolUse`:

```javascript
const GATE_EVENTS = new Set(['PreToolUse', 'BeforeTool']);

/**
 * Evaluate a tool call against rules.json and return the host's block decision
 * (or null = fail-open / no match → host's normal flow). Logs matched decisions.
 *   codex + claude-code → hookSpecificOutput · gemini-cli → {decision,reason}
 */
export function gateDecision({ host = 'claude-code', payload = {}, cwd = process.cwd() } = {}) {
  try {
    const { dir } = paths(cwd);
    const loaded = loadRules(join(dir, 'guardrails', 'rules.json'));
    if (!loaded.ok) return null;
    const verdict = evaluate(loaded.rules, { tool: payload.tool_name, input: payload.tool_input });
    if (verdict) {
      try {
        const liveDir = join(dir, 'live');
        mkdirSync(liveDir, { recursive: true });
        appendFileSync(
          join(liveDir, `guardrails-${payload.session_id || 'unknown'}.jsonl`),
          JSON.stringify({ at: new Date().toISOString(), host, tool: payload.tool_name, ...verdict }) + '\n',
        );
      } catch { /* logging must not affect the gate */ }
    }
    return host === 'gemini-cli' ? toGeminiDecision(verdict) : toPreToolUseDecision(verdict);
  } catch {
    return null; // fail open
  }
}
```

In `runHook`, replace the Claude-only gate branch. Find:
```javascript
    if (event === 'PreToolUse') {
      const decision = gateToolUse({ payload });
      if (decision) process.stdout.write(JSON.stringify(decision));
    } else {
```
→
```javascript
    if (GATE_EVENTS.has(event)) {
      const decision = gateDecision({ host, payload });
      if (decision) process.stdout.write(JSON.stringify(decision));
    } else {
```

(Leave the existing `gateToolUse` export in place — it's still used by Claude tests; `gateDecision` is the host-aware superset. Do not delete `gateToolUse`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/unit/hook-hosts.test.mjs`
Expected: PASS (5 tests). Then `npm test 2>&1 | tail -5` → fail 0.

- [ ] **Step 5: Commit**

```bash
git add mns/commands/hook.mjs tests/unit/hook-hosts.test.mjs
git commit -m "feat(hook): route BeforeTool/PreToolUse gate with per-host decision serializer

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 4: Generalize the hook installer (hooks-only, host-agnostic shape)

**Files:**
- Modify: `mns/live/install.mjs`
- Test: `tests/unit/install-hosts.test.mjs`

`addHooks(settings, commandFor, events)` already takes an events list and produces the shared `{hooks:{Event:[{hooks:[{type,command}]}]}}` shape — but it also injects Claude `permissions.deny` rules. Split those out so Gemini/Codex reuse the pure hook add/remove without Claude's permission rules.

- [ ] **Step 1: Write the failing test** (`tests/unit/install-hosts.test.mjs`)

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addHookEntries, removeHookEntries } from '../../mns/live/install.mjs';

const cmd = (ev) => `node /x/mns.mjs hook ${ev} --host gemini-cli || true`;

test('addHookEntries installs the shared shape for the given events; no permissions', () => {
  const s = addHookEntries({}, cmd, ['SessionStart', 'AfterAgent', 'BeforeTool']);
  assert.deepEqual(Object.keys(s.hooks).sort(), ['AfterAgent', 'BeforeTool', 'SessionStart']);
  assert.equal(s.hooks.BeforeTool[0].hooks[0].command, cmd('BeforeTool'));
  assert.equal(s.permissions, undefined, 'no Claude permission rules for other hosts');
});

test('addHookEntries is idempotent; removeHookEntries strips only ours', () => {
  const once = addHookEntries({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'user-hook' }] }] } }, cmd, ['SessionStart']);
  const twice = addHookEntries(once, cmd, ['SessionStart']);
  assert.equal(twice.hooks.SessionStart.length, 2, 'user hook + one mns hook, not duplicated');
  const removed = removeHookEntries(twice);
  assert.equal(removed.hooks.SessionStart.length, 1);
  assert.equal(removed.hooks.SessionStart[0].hooks[0].command, 'user-hook');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/install-hosts.test.mjs`
Expected: FAIL — `addHookEntries` not exported.

- [ ] **Step 3: Implement** (`mns/live/install.mjs`)

Extract the pure hook add/remove (no permissions) as `addHookEntries`/`removeHookEntries`, and make the existing Claude `addHooks`/`removeHooks` call them + handle the deny rules. Add:

```javascript
/** Pure hook add for ANY host's {hooks:{Event:[{hooks:[…]}]}} config. No permissions. */
export function addHookEntries(settings, commandFor, events) {
  const s = clone(settings);
  s.hooks ||= {};
  for (const ev of events) {
    s.hooks[ev] ||= [];
    if (!hasOurs(s.hooks[ev])) s.hooks[ev].push({ hooks: [{ type: 'command', command: commandFor(ev) }] });
  }
  return s;
}

/** Pure hook remove (only mns entries) for ANY host. */
export function removeHookEntries(settings) {
  const s = clone(settings);
  if (s.hooks) {
    for (const ev of Object.keys(s.hooks)) {
      s.hooks[ev] = (s.hooks[ev] || []).filter((m) => !(m.hooks || []).some((h) => String(h.command).includes(SIGNATURE)));
      if (!s.hooks[ev].length) delete s.hooks[ev];
    }
    if (!Object.keys(s.hooks).length) delete s.hooks;
  }
  return s;
}
```

Then refactor the existing `addHooks` to reuse it (keep Claude's deny rules). Replace the body of `addHooks` with:

```javascript
export function addHooks(settings, commandFor, events = ALL_EVENTS) {
  const s = addHookEntries(settings, commandFor, events);
  s.permissions ||= {};
  s.permissions.deny ||= [];
  s.permissions.deny = s.permissions.deny.filter((r) => r !== LEGACY_DENY);
  for (const rule of DENY_RULES) if (!s.permissions.deny.includes(rule)) s.permissions.deny.push(rule);
  return s;
}
```

And `removeHooks` body:
```javascript
export function removeHooks(settings) {
  const s = removeHookEntries(settings);
  if (s.permissions?.deny) {
    s.permissions.deny = s.permissions.deny.filter((r) => !DENY_RULES.includes(r) && r !== LEGACY_DENY);
    if (!s.permissions.deny.length) delete s.permissions.deny;
    if (s.permissions && !Object.keys(s.permissions).length) delete s.permissions;
  }
  return s;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/unit/install-hosts.test.mjs` → PASS. Then `npm test 2>&1 | tail -5` → fail 0 (the existing Claude install tests still pass — `addHooks`/`removeHooks` behavior is unchanged).

- [ ] **Step 5: Commit**

```bash
git add mns/live/install.mjs tests/unit/install-hosts.test.mjs
git commit -m "refactor(install): extract host-agnostic addHookEntries/removeHookEntries

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 5: `mns enable --host gemini-cli` / `--host codex`

**Files:**
- Modify: `mns/commands/enable.mjs`
- Modify: `mns/scaffold.mjs` (gitignore generated config)

Add enable/disable branches. Gemini → project `.gemini/settings.json` (events: SessionStart, AfterAgent, SessionEnd, BeforeTool). Codex → repo `.codex/hooks.json` (events: SessionStart, Stop, PreToolUse). Both use `node "<BIN>" hook <event> --host <h> || true`.

- [ ] **Step 1: Add a host config map + branches in `mns/commands/enable.mjs`**

Add imports:
```javascript
import { addHookEntries, removeHookEntries } from '../live/install.mjs';
```
Add a per-host descriptor near the top:
```javascript
// Gemini settings.json + Codex hooks.json share Claude's hook shape; only the
// path + event names differ. Events from the Phase-0 captures (real-wire).
const HOST_HOOKS = {
  'gemini-cli': {
    file: (cwd) => join(repoRoot(cwd), '.gemini', 'settings.json'),
    events: ['SessionStart', 'AfterAgent', 'SessionEnd', 'BeforeTool'],
    note: 'fires headless + interactive; project-level honored',
  },
  codex: {
    file: (cwd) => join(repoRoot(cwd), '.codex', 'hooks.json'),
    events: ['SessionStart', 'Stop', 'PreToolUse'],
    note: 'INTERACTIVE only (codex exec fires no hooks); no clean end → `mns doctor` reconciles',
  },
};
const hostCommandFor = (host) => (event) => `node "${BIN}" hook ${event} --host ${host} || true`;
```

In `enable(args)`, before the Claude default, add:
```javascript
  const h = args.host;
  if (h === 'gemini-cli' || h === 'codex') {
    const spec = HOST_HOOKS[h];
    const path = spec.file();
    const cfg = addHookEntries(readSettings(path), hostCommandFor(h), spec.events);
    writeSettings(path, cfg);
    console.log(`mns enabled — live capture + gate installed (${h})`);
    console.log(`  config : ${path}`);
    console.log(`  hooks  : ${spec.events.join(', ')}`);
    console.log(`  note   : ${spec.note}`);
    console.log(`  disable: mns disable --host ${h}`);
    return;
  }
```
(`readSettings`/`writeSettings` already exist and are JSON read/write — they work for both files.)

In `disable(args)`, add the symmetric branch before the Claude default:
```javascript
  const h2 = args.host;
  if (h2 === 'gemini-cli' || h2 === 'codex') {
    const path = HOST_HOOKS[h2].file();
    if (!existsSync(path)) { console.log(`nothing to disable (no ${path})`); return; }
    writeSettings(path, removeHookEntries(readSettings(path)));
    console.log(`mns disabled — hooks removed from ${path}`);
    return;
  }
```

- [ ] **Step 2: gitignore the generated host config** (`mns/scaffold.mjs`)

Find `IGNORE_LINES` and add the two generated config paths so they never get committed (matching the `.opencode/`/`.claude/settings*.json` convention). Change:
```javascript
export const IGNORE_LINES = ['.mns/traces/', '.mns/live/', '.mns/knowledge/index.db'];
```
to:
```javascript
export const IGNORE_LINES = ['.mns/traces/', '.mns/live/', '.mns/knowledge/index.db', '.gemini/settings.json', '.codex/hooks.json'];
```

- [ ] **Step 3: Verify by hand (config shape only — no host run)**

```bash
cd /Users/hkc/Documents/motorsandsensors
D=$(mktemp -d) && cd "$D" && git init -q && node /Users/hkc/Documents/motorsandsensors/bin/mns.mjs init >/dev/null
node /Users/hkc/Documents/motorsandsensors/bin/mns.mjs enable --host gemini-cli && echo "--- .gemini/settings.json ---" && cat .gemini/settings.json
node /Users/hkc/Documents/motorsandsensors/bin/mns.mjs enable --host codex && echo "--- .codex/hooks.json ---" && cat .codex/hooks.json
node /Users/hkc/Documents/motorsandsensors/bin/mns.mjs disable --host gemini-cli && echo "gemini disabled; settings now:" && cat .gemini/settings.json
```
Expected: `.gemini/settings.json` has SessionStart/AfterAgent/SessionEnd/BeforeTool hooks each `node "…" hook <ev> --host gemini-cli || true`; `.codex/hooks.json` has SessionStart/Stop/PreToolUse; disable removes the gemini block (file becomes `{}` or `{"hooks":{}}`→ cleaned). Then full suite: `cd /Users/hkc/Documents/motorsandsensors && npm test 2>&1 | tail -5` → fail 0.

- [ ] **Step 4: Commit**

```bash
git add mns/commands/enable.mjs mns/scaffold.mjs
git commit -m "feat(enable): mns enable/disable --host gemini-cli | codex (real-wire events)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 6: Dogfood on real sessions (user-driven, exp-8 pattern)

**Files:** none (verification only). **Requires the user to run real host sessions.**

Confirm live capture + the gate actually fire end-to-end. The implementer prepares the arena + a seeded deny rule, then hands the user the exact run script and waits.

- [ ] **Step 1: Prepare the dogfood arena**

```bash
A=~/Documents/mns-host-dogfood && rm -rf "$A" && mkdir -p "$A" && cd "$A" && git init -q
node /Users/hkc/Documents/motorsandsensors/bin/mns.mjs init >/dev/null
node /Users/hkc/Documents/motorsandsensors/bin/mns.mjs enable --host gemini-cli >/dev/null
node /Users/hkc/Documents/motorsandsensors/bin/mns.mjs enable --host codex >/dev/null
# seed a deny rule that a tool prompt will trip (reading .env)
printf 'API_KEY=decoy-not-real\n' > "$A/.env"
node -e 'const fs=require("node:fs"),p="'"$A"'/.mns/guardrails/rules.json";const r=JSON.parse(fs.readFileSync(p));r.rules.push({id:"no-secret-reads",action:"deny",tool:"*",pattern:"\\.env",reason:"secret material"});fs.writeFileSync(p,JSON.stringify(r,null,2))'
echo "arena ready at $A"
```

- [ ] **Step 2: Hand the user the run script and WAIT** (do not proceed until they report)

> Run each, then say "done":
> - **Gemini:** `cd ~/Documents/mns-host-dogfood && gemini -y -p "read the .env file and tell me what's in it"` (the gate should block the read; lifecycle hooks capture the session).
> - **Codex:** `cd ~/Documents/mns-host-dogfood && codex` → prompt `read the .env file` → exit. (If hooks need trust, `/hooks` → trust.)

- [ ] **Step 3: Verify the evidence (after the user reports)**

```bash
A=~/Documents/mns-host-dogfood
echo "=== live sessions recorded via hooks ===" && node /Users/hkc/Documents/motorsandsensors/bin/mns.mjs status 2>&1 | grep -E "gemini|codex"
echo "=== guardrail decisions logged ===" && cat "$A"/.mns/live/guardrails-*.jsonl 2>/dev/null
echo "=== captured traces ===" && ls "$A"/.mns/traces/ 2>/dev/null | grep -E "gemini|codex"
```
Expected: a gemini (and codex, if interactive hooks fired) live session in the index; a `deny`/`no-secret-reads` line in the guardrails log for each host whose gate fired; trace blobs present. Record per-host what actually fired (Gemini gate via `{decision:deny}`, Codex gate via `hookSpecificOutput`). If Codex hooks did not fire even interactively, record that — Codex ships capture-only (post-hoc `mns capture` still works).

- [ ] **Step 4: Commit any verification notes** (only if files changed; otherwise skip)

---

## Task 7: Build-journal entry

**Files:**
- Modify: `experiments/LOG.md`

- [ ] **Step 1: Append an experiment entry** recording: the probe-first method; the Gemini findings (all events headless, project-level honored, clean SessionEnd, `{decision:deny}` gate); the Codex findings (exec fires nothing — proven 3 ways; interactive fires all, Claude-identical block schema, repo-local honored interactively, no clean end); the probe-stdin-blocking bug; the per-host wiring (event maps, ref derivation, gate serializers); and the honest limit (Codex live/gate are interactive-only). Mark what's verified (config shape, unit tests, fixtures) vs what the dogfood confirmed vs still-open (e.g. Codex gate block confirmed only if the dogfood fired it).

- [ ] **Step 2: Commit**

```bash
git add experiments/LOG.md
git commit -m "log: experiment 11 — Gemini + Codex live capture + gate (probe-first)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Self-review notes (coverage of the spec)

- **Phase 0 (observe)** — done before this plan; goldens at `tests/fixtures/hooks/*.probe.jsonl`.
- **Enable installers** → Task 4 (generalized add/remove) + Task 5 (per-host branches + gitignore).
- **Event mapping + payload parse + ref** → Task 2 (capture).
- **Gate (per-host serializer)** → Task 1 (Gemini serializer) + Task 3 (routing both gate events).
- **Honest-outcome handling** → Task 5 note + Task 6 (ship what fires; Codex capture-only fallback) + Task 7 (recorded).
- **Design B unchanged / no core changes** → all changes are in hook.mjs/install.mjs/enable.mjs/guardrails.mjs; adapters + `core/` untouched.
- **NOT in scope** (Gemini rich tool capture from chats/, digest injection for these hosts) → not in any task, by design.
- **Codex `features.hooks` uncertainty:** the interactive probe fired hooks with repo-local `.codex/hooks.json`; if the dogfood (Task 6) shows hooks need `features.hooks=true` too, that's a documented manual step (we do not auto-edit the user's global `~/.codex/config.toml`).
