# zuzuu-web Observe Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local web dashboard that observes a project's zuzuu `agent/` home — status, faculties, proposals, generations, sessions, digest — built by adopting webcode (renamed zuzuu-web).

**Architecture:** Two repos. In **zuzuu** (`/Users/hkc/Documents/motorsandsensors`) add `--json` output to computed commands (pure helpers already exist). In **zuzuu-web** (`~/Documents/webcode`, renamed) add a daemon `/api/zuzuu/*` route group (reads `agent/` files directly + shells `zuzuu --json`, falling back to file-reads if the binary is absent) and a full-pane Faculties view. Read-only MVP.

**Tech Stack:** zuzuu — Node ≥22, ESM `.mjs`, `node:test`, zero deps. zuzuu-web — TypeScript, Hono daemon (vitest, tsx), React 19 + Vite + Tailwind v4 + Zustand + TanStack Query, `@zuzuu-web/protocol` shared types.

**Spec:** `docs/superpowers/specs/2026-06-12-zuzuu-web-observe-dashboard-design.md`

---

## File Structure

**zuzuu repo (Phase ①):**
- Modify `zuzuu/commands/status.mjs` — add pure `statusData(mnsDir)` + `--json` branch in `status()`.
- Modify `zuzuu/commands/inbox.mjs` — add pure `inboxData(mnsDir)` + `--json` branch.
- Modify `zuzuu/commands/generation.mjs` — add `--json` to `list` + `show`.
- Modify `zuzuu/commands/digest.mjs` — confirm/add `--json`.
- Modify `bin/zuzuu.mjs` — pass `args` through to `status`/`inbox` (already does for `generation`/`digest`).
- Tests: `tests/unit/json-outputs.test.mjs` (new).

**zuzuu-web repo (Phases ②–⑤):**
- Rename: all `package.json` names, import specifiers, `packages/daemon/bin/webcode.js`→`zuzuu-web.js`, window event strings.
- Create `packages/protocol/src/zuzuu.ts` — shared dashboard types.
- Create `packages/daemon/src/zuzuu-api.ts` — `createZuzuuApi(getRoot)` + `runZuzuu`.
- Modify `packages/daemon/src/server.ts` — mount `/api/zuzuu`.
- Create `packages/daemon/test/zuzuu-api.test.ts`.
- Create `packages/web/src/lib/zuzuu-api.ts` — REST client.
- Create `packages/web/src/state/view.ts` — `useView` (ide|faculties).
- Create `packages/web/src/faculties/*.tsx` — `FacultiesView`, `StatusHeader`, `FacultyCard`, `FacultyDetail`, `ProposalRow`, `GenerationsTimeline`, `GenerationDiff`, `SessionsList`, `DigestPanel`.
- Modify `packages/web/src/App.tsx` — top-bar toggle + center swap + live-refresh invalidation.

---

# PHASE ① — zuzuu `--json` outputs (zuzuu repo)

CWD: `/Users/hkc/Documents/motorsandsensors`. Run `npm test` (node:test). Baseline: 346 tests green. `parseArgs` already sets `args.json = true` for `--json`.

### Task 1: `status --json`

**Files:**
- Modify: `zuzuu/commands/status.mjs`
- Modify: `bin/zuzuu.mjs` (pass `args` to `status`)
- Test: `tests/unit/json-outputs.test.mjs` (create)

- [ ] **Step 1: Write the failing test**

```javascript
// tests/unit/json-outputs.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { statusData } from '../../zuzuu/commands/status.mjs';

function withHome(fn) {
  const root = mkdtempSync(join(tmpdir(), 'zjson-'));
  const dir = join(root, 'agent');
  mkdirSync(join(dir, 'knowledge', 'proposals'), { recursive: true });
  try { return fn(dir); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('statusData reports home, generation, pending map, drift', () => {
  withHome((dir) => {
    const d = statusData(dir);
    assert.equal(d.home, true);
    assert.equal(d.activeGeneration, null);          // none minted
    assert.equal(typeof d.pending, 'object');
    assert.equal(d.pending.knowledge, 0);
    assert.equal(d.drift.dirty, false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/json-outputs.test.mjs`
Expected: FAIL — `statusData` is not exported.

- [ ] **Step 3: Implement `statusData` + the `--json` branch**

In `zuzuu/commands/status.mjs`, reusing the imports already present (`FACULTIES`, `listProposals`, `detectDrift`) and `activeGeneration`. First, **rename the `activeGeneration` import to avoid shadowing** the field name we want to return:

```javascript
import { activeGeneration as activeGenerationFn } from '../faculty/generation.mjs';
import { existsSync } from 'node:fs';
```

Update the one existing caller inside `facultiesLine` from `activeGeneration(mnsDir)` to `activeGenerationFn(mnsDir)`. Then add the pure data function:

```javascript
/** Pure: structured status for a faculty home. Fail-soft per field. */
export function statusData(mnsDir) {
  let active = null, drift = { dirty: false, items: [] };
  const pending = {};
  try { active = activeGenerationFn(mnsDir); } catch { active = null; }
  for (const f of FACULTIES) {
    try { pending[f] = listProposals(mnsDir, f).length; } catch { pending[f] = 0; }
  }
  try {
    const d = detectDrift(mnsDir);
    const items = Array.isArray(d?.drifted) ? d.drifted : [];
    drift = { dirty: items.length > 0, items };
  } catch { /* fail-soft */ }
  return { home: existsSync(mnsDir), activeGeneration: active, pending, drift };
}
```

Add the `--json` branch at the top of `status()`:

```javascript
export function status(args = {}) {
  if (args.json) { console.log(JSON.stringify(statusData(paths().dir))); return; }
  // … existing text output …
}
```

In `bin/zuzuu.mjs`, change `case 'status': status(); break;` → `case 'status': status(args); break;`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/unit/json-outputs.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm test 2>&1 | tail -3`
Expected: all pass (347+).

- [ ] **Step 6: Commit**

```bash
git add zuzuu/commands/status.mjs bin/zuzuu.mjs tests/unit/json-outputs.test.mjs
git commit -m "feat(status): zuzuu status --json (statusData) for zuzuu-web

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 2: `inbox --json`

**Files:**
- Modify: `zuzuu/commands/inbox.mjs`, `bin/zuzuu.mjs`
- Test: `tests/unit/json-outputs.test.mjs`

- [ ] **Step 1: Write the failing test** (append)

```javascript
import { inboxData } from '../../zuzuu/commands/inbox.mjs';
import { writeFileSync } from 'node:fs';

test('inboxData lists pending proposals with faculty + title + total', () => {
  withHome((dir) => {
    writeFileSync(join(dir, 'knowledge', 'proposals', 'p1.json'),
      JSON.stringify({ id: 'p1', faculty: 'knowledge', payload: { body: 'use node:sqlite' } }));
    const d = inboxData(dir);
    assert.equal(d.total, 1);
    assert.equal(d.pending[0].faculty, 'knowledge');
    assert.equal(d.pending[0].id, 'p1');
    assert.match(d.pending[0].title, /node:sqlite/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/unit/json-outputs.test.mjs`
Expected: FAIL — `inboxData` not exported.

- [ ] **Step 3: Implement `inboxData` + `--json` branch**

In `zuzuu/commands/inbox.mjs`, add (reuse the existing `titleOf`, `listProposals`, `FACULTIES`):

```javascript
/** Pure: flat list of pending proposals across faculties (id, faculty, title). */
export function inboxData(mnsDir) {
  const pending = [];
  for (const faculty of FACULTIES) {
    let proposals = [];
    try { proposals = listProposals(mnsDir, faculty); } catch { proposals = []; }
    for (const p of proposals) pending.push({ id: p.id, faculty, title: titleOf(faculty, p) });
  }
  return { pending, total: pending.length };
}
```

Add the `--json` branch at the top of `inbox()`:

```javascript
export function inbox(args = {}, log = console.log) {
  const mnsDir = args.mnsDir || paths().dir;
  if (args.json) { log(JSON.stringify(inboxData(mnsDir))); return; }
  // … existing text output …
}
```

`bin/zuzuu.mjs` already calls `inbox(args)`. No bin change needed.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/unit/json-outputs.test.mjs` → PASS.

- [ ] **Step 5: Commit**

```bash
git add zuzuu/commands/inbox.mjs tests/unit/json-outputs.test.mjs
git commit -m "feat(inbox): zuzuu inbox --json (inboxData) for zuzuu-web

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 3: `generation list --json` + `generation show <id> --json`

**Files:**
- Modify: `zuzuu/commands/generation.mjs`
- Test: `tests/unit/json-outputs.test.mjs`

- [ ] **Step 1: Write the failing test** (append; reuse `mintGeneration` to build a generation)

```javascript
import { generationListData, generationShowData } from '../../zuzuu/commands/generation.mjs';
import { mintGeneration } from '../../zuzuu/faculty/generation.mjs';

test('generationListData returns active + list; showData returns the diff', () => {
  withHome((dir) => {
    const lf = mintGeneration(dir, { forkedFrom: null });
    const list = generationListData(dir);
    assert.equal(list.active, lf.id);
    assert.equal(list.generations[0].id, lf.id);
    const show = generationShowData(dir, lf.id);
    assert.equal(show.id, lf.id);
    assert.ok(show.faculties && typeof show.faculties === 'object');
    assert.equal(generationShowData(dir, 'gen_999'), null);   // unknown id
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/unit/json-outputs.test.mjs`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement the two pure data functions + `--json` branches**

In `zuzuu/commands/generation.mjs` (reuse `listGenerations`, `readGeneration`, `activeGeneration`, `diffGenerations`):

```javascript
/** Pure: generation list payload. */
export function generationListData(dir) {
  const active = activeGeneration(dir);
  const generations = listGenerations(dir).map((id) => {
    const lf = readGeneration(dir, id) ?? {};
    return { id, mintedAt: lf.mintedAt ?? null, mintedFrom: Array.isArray(lf.mintedFrom) ? lf.mintedFrom : [] };
  });
  return { active, generations };
}

/** Pure: generation diff payload, or null for an unknown id. */
export function generationShowData(dir, id) {
  const d = diffGenerations(dir, id);
  return d ? { id, ...d } : null;
}
```

Add `--json` branches to `list` and `show` (thread `args` through `generation`):

```javascript
export function generation(args) {
  const dir = mnsDir();
  const sub = args._[0];
  if (!sub || sub === 'list') {
    if (args.json) { console.log(JSON.stringify(generationListData(dir))); return; }
    return list(dir);
  }
  if (sub === 'mint') return mint(dir);
  if (sub === 'show') {
    if (args.json) {
      const d = generationShowData(dir, args._[1]);
      if (d == null) { console.error(`no generation '${args._[1]}'`); process.exit(1); }
      console.log(JSON.stringify(d)); return;
    }
    return show(dir, args._[1]);
  }
  if (sub === 'rollback') return doRollback(dir, args._[1]);
  console.error(`unknown: zuzuu generation ${sub}\nusage: zuzuu generation [list|show <id>|mint|rollback <id>]`);
  process.exit(1);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/unit/json-outputs.test.mjs` → PASS.

- [ ] **Step 5: Commit**

```bash
git add zuzuu/commands/generation.mjs tests/unit/json-outputs.test.mjs
git commit -m "feat(generation): list/show --json for zuzuu-web

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 4: confirm `digest --json`

**Files:** Modify `zuzuu/commands/digest.mjs` (only if `--json` absent); Test `tests/unit/json-outputs.test.mjs`.

- [ ] **Step 1: Check current behavior**

Run: `node bin/zuzuu.mjs digest --json 2>&1 | head -1` (in a repo with an `agent/` home).
If it already prints JSON, skip to Step 4 (write a confirming test). If it prints text, implement Step 3.

- [ ] **Step 2: Write the failing test** (append)

```javascript
import { digestData } from '../../zuzuu/commands/digest.mjs';
test('digestData returns { text }', () => {
  withHome((dir) => {
    const d = digestData(dir);
    assert.equal(typeof d.text, 'string');
  });
});
```

- [ ] **Step 3: Implement (if needed)** — in `zuzuu/commands/digest.mjs`, reuse `computeDigest`:

```javascript
import { computeDigest } from '../digest.mjs';
export function digestData(mnsDir) {
  const { text } = computeDigest(mnsDir);
  return { text: text ?? '' };
}
// in digest(args): if (args.json) { console.log(JSON.stringify(digestData(paths().dir))); return; }
```

- [ ] **Step 4: Run + Step 5: Commit**

```bash
node --test tests/unit/json-outputs.test.mjs   # PASS
npm test 2>&1 | tail -3                         # all green
git add zuzuu/commands/digest.mjs tests/unit/json-outputs.test.mjs
git commit -m "feat(digest): digestData + --json confirm for zuzuu-web

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

**End of Phase ①:** push the zuzuu repo (`git push origin main`) so the published/linked `zuzuu` binary the daemon shells out to has the `--json` flags. (Manual `npm publish` is a separate step; for local dev, `npm link` in the zuzuu repo so `zuzuu` resolves the new code.)

---

# PHASE ② — webcode → zuzuu-web rename (zuzuu-web repo)

CWD: `~/Documents/webcode`. Branch: `git checkout -b rename/zuzuu-web`. Run `npm test` (vitest, per-workspace) + `npm run typecheck`. This is a mechanical, isolated commit.

### Task 5: rename the workspace and packages

**Files:** all four `package.json`, every `*.ts`/`*.tsx` importing `@webcode/*`, `packages/daemon/bin/webcode.js`, `packages/web/src/App.tsx` (event strings).

- [ ] **Step 1: Establish the green baseline**

Run: `npm install && npm run -w @webcode/web build && npm test --workspaces --if-present 2>&1 | tail -5`
Expected: builds + tests pass. Record the pass counts.

- [ ] **Step 2: Rename package names**

- Root `package.json`: `"name": "zuzuu-web-workspace"`; scripts `dev:daemon`/`dev:web`/`build` change `-w webcode`→`-w zuzuu-web` and `-w @webcode/web`→`-w @zuzuu-web/web`.
- `packages/daemon/package.json`: `"name": "zuzuu-web"`; `"bin": { "zuzuu-web": "./bin/zuzuu-web.js" }`; dep `"@webcode/protocol"`→`"@zuzuu-web/protocol"`.
- `packages/web/package.json`: `"name": "@zuzuu-web/web"`; dep `"@webcode/protocol"`→`"@zuzuu-web/protocol"`.
- `packages/protocol/package.json`: `"name": "@zuzuu-web/protocol"`.

- [ ] **Step 3: Rename the bin file + import specifiers**

```bash
git mv packages/daemon/bin/webcode.js packages/daemon/bin/zuzuu-web.js
# update import specifiers across the web + daemon source
grep -rl "@webcode/protocol" packages --include='*.ts' --include='*.tsx' | while read f; do
  sed -i '' 's#@webcode/protocol#@zuzuu-web/protocol#g' "$f"; done
# window event strings
sed -i '' 's#webcode:#zuzuu-web:#g' packages/web/src/App.tsx
```

- [ ] **Step 4: Update display strings + bin shebang references**

In `packages/daemon/src/index.ts`, the startup log `webcode v${pkg.version}` → `zuzuu-web v${pkg.version}` and `webcode: no such directory` → `zuzuu-web: no such directory`. In `packages/web/src/lib/api.ts`, the 401 message `webcode daemon` → `zuzuu-web daemon`. Search and update any remaining user-visible `"webcode"` display strings: `grep -rn "webcode" packages/web/src packages/daemon/src --include='*.ts' --include='*.tsx' | grep -iv "@zuzuu-web\|//"`.

- [ ] **Step 5: Reinstall, build, test**

```bash
npm install
npm run -w @zuzuu-web/web build
npm test --workspaces --if-present 2>&1 | tail -5
npm run typecheck --workspaces --if-present 2>&1 | tail -5
```
Expected: same pass counts as the baseline; types clean.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "rename: webcode → zuzuu-web (packages, bin, imports, strings)

Daemon bin is zuzuu-web (NOT zuzuu — that name is the faculty CLI the dashboard
shells out to). Mechanical; tests + typecheck green.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

# PHASE ③ — daemon `/api/zuzuu/*` (zuzuu-web repo)

CWD: `~/Documents/webcode`. Branch: `git checkout -b feat/zuzuu-api`. Tests: vitest in `packages/daemon/test/`.

### Task 6: shared protocol types

**Files:** Create `packages/protocol/src/zuzuu.ts`; Modify `packages/protocol/src/index.ts` (re-export).

- [ ] **Step 1: Define the types**

```typescript
// packages/protocol/src/zuzuu.ts
export type FacultyKey = "knowledge" | "memory" | "actions" | "instructions" | "guardrails";

export interface ZuzuuHealth { home: boolean; zuzuuBin: boolean; }
export interface ZuzuuStatus {
  home: boolean;
  activeGeneration: string | null;
  pending: Record<string, number>;
  drift: { dirty: boolean; items: string[] };
}
export interface FacultySummary { key: FacultyKey; count: number; pending: number; }
export interface FacultyItem { id: string; title: string; path: string; }
export interface FacultyDetail { key: FacultyKey; items: FacultyItem[]; proposals: ProposalSummary[]; }
export interface ProposalSummary { id: string; faculty: string; title: string; }
export interface InboxResponse { pending: ProposalSummary[]; total: number; }
export interface GenerationSummary { id: string; mintedAt: string | null; mintedFrom: string[]; }
export interface GenerationList { active: string | null; generations: GenerationSummary[]; }
export interface GenerationDiff {
  id: string; forkedFrom: string | null; mintedFrom: string[];
  faculties: Record<string, { added?: string[]; changed?: string[] | boolean; removed?: string[] }>;
}
export interface SessionsResponse { sessions: unknown[]; }
export interface DigestResponse { text: string; }
```

- [ ] **Step 2: Re-export** — add `export * from "./zuzuu.js";` to `packages/protocol/src/index.ts`.

- [ ] **Step 3: Build protocol**

Run: `npm run -w @zuzuu-web/protocol build` (or the workspace's build script)
Expected: compiles, emits `.d.ts`.

- [ ] **Step 4: Commit**

```bash
git add packages/protocol/src/zuzuu.ts packages/protocol/src/index.ts
git commit -m "feat(protocol): zuzuu dashboard types

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 7: `runZuzuu` shell-out helper

**Files:** Create `packages/daemon/src/zuzuu-api.ts`; Test `packages/daemon/test/zuzuu-api.test.ts`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/daemon/test/zuzuu-api.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runZuzuu } from "../src/zuzuu-api.js";

let root: string;
beforeEach(() => { root = mkdtempSync(path.join(tmpdir(), "zw-")); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("runZuzuu", () => {
  it("returns null when the zuzuu binary is absent", async () => {
    // PATH without zuzuu → spawn fails → null
    const out = await runZuzuu(root, ["status"], { binary: "definitely-not-a-real-binary-zzz" });
    expect(out).toBeNull();
  });

  it("parses JSON stdout from a stub binary", async () => {
    const stub = path.join(root, "stub.sh");
    writeFileSync(stub, '#!/bin/sh\necho \'{"ok":true}\'\n');
    chmodSync(stub, 0o755);
    const out = await runZuzuu(root, ["status"], { binary: stub });
    expect(out).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run -w zuzuu-web test -- zuzuu-api` (or `npx vitest run packages/daemon/test/zuzuu-api.test.ts`)
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `runZuzuu`**

```typescript
// packages/daemon/src/zuzuu-api.ts
import { spawn } from "node:child_process";

interface RunOpts { binary?: string; timeoutMs?: number; }

/** Spawn `zuzuu <args> --json` in `root`. Returns parsed JSON, or null on any
 *  failure (binary absent, non-zero exit, unparseable) → callers fall back to
 *  reading agent/ files. Read-only + time-boxed. */
export function runZuzuu(root: string, args: string[], opts: RunOpts = {}): Promise<unknown | null> {
  const binary = opts.binary ?? "zuzuu";
  const timeoutMs = opts.timeoutMs ?? 5000;
  return new Promise((resolve) => {
    let out = "";
    let done = false;
    const finish = (v: unknown | null) => { if (!done) { done = true; resolve(v); } };
    let child;
    try {
      child = spawn(binary, [...args, "--json"], { cwd: root, stdio: ["ignore", "pipe", "ignore"] });
    } catch { finish(null); return; }
    const timer = setTimeout(() => { try { child.kill(); } catch { /* noop */ } finish(null); }, timeoutMs);
    child.stdout?.on("data", (b) => { out += b.toString(); });
    child.on("error", () => { clearTimeout(timer); finish(null); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return finish(null);
      try { finish(JSON.parse(out)); } catch { finish(null); }
    });
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/daemon/test/zuzuu-api.test.ts`
Expected: PASS (2).

- [ ] **Step 5: Commit**

```bash
git add packages/daemon/src/zuzuu-api.ts packages/daemon/test/zuzuu-api.test.ts
git commit -m "feat(daemon): runZuzuu shell-out helper (fail-soft → null)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 8: the file-read routes (`createZuzuuApi`)

**Files:** Modify `packages/daemon/src/zuzuu-api.ts`; Test `packages/daemon/test/zuzuu-api.test.ts`.

- [ ] **Step 1: Write the failing test** (append) — build a fixture `agent/` and assert routes

```typescript
import { createZuzuuApi } from "../src/zuzuu-api.js";

function fixtureHome(root: string) {
  const agent = path.join(root, "agent");
  for (const f of ["knowledge", "memory", "actions", "instructions", "guardrails"])
    mkdirSync(path.join(agent, f, "proposals"), { recursive: true });
  mkdirSync(path.join(agent, "knowledge", "items"), { recursive: true });
  mkdirSync(path.join(agent, "generations"), { recursive: true });
  writeFileSync(path.join(agent, "sessions.json"), JSON.stringify({ version: 1, sessions: [{ id: "s1", host: "claude-code" }] }));
  writeFileSync(path.join(agent, "knowledge", "items", "k1.json"), JSON.stringify({ id: "k1", body: "fact one" }));
  return agent;
}

describe("createZuzuuApi file routes", () => {
  it("GET /health reports home + bin presence", async () => {
    fixtureHome(root);
    const app = createZuzuuApi(() => root, { binary: "definitely-not-real-zzz" });
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ home: true, zuzuuBin: false });
  });

  it("GET /faculties lists the five with counts", async () => {
    fixtureHome(root);
    const app = createZuzuuApi(() => root, { binary: "x" });
    const res = await app.request("/faculties");
    const body = await res.json();
    expect(body.faculties).toHaveLength(5);
    expect(body.faculties.find((f: { key: string }) => f.key === "knowledge").count).toBe(1);
  });

  it("GET /sessions returns the index", async () => {
    fixtureHome(root);
    const app = createZuzuuApi(() => root, { binary: "x" });
    const body = await (await app.request("/sessions")).json();
    expect(body.sessions[0].id).toBe("s1");
  });

  it("missing agent/ → /health home:false (no throw)", async () => {
    const app = createZuzuuApi(() => root, { binary: "x" });
    const body = await (await app.request("/health")).json();
    expect(body.home).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/daemon/test/zuzuu-api.test.ts`
Expected: FAIL — `createZuzuuApi` not exported.

- [ ] **Step 3: Implement `createZuzuuApi` with the file-read routes**

Mirror `fs-api.ts` (per-request root refresh + `resolveSafe` + `onError`). Add to `zuzuu-api.ts`:

```typescript
import fsp from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { PathError, resolveSafe } from "./safe-path.js";

const FACULTIES = ["knowledge", "memory", "actions", "instructions", "guardrails"] as const;

interface ApiOpts { binary?: string; }

async function readJsonDir(dir: string): Promise<unknown[]> {
  let names: string[] = [];
  try { names = (await fsp.readdir(dir)).filter((n) => n.endsWith(".json")); } catch { return []; }
  const out: unknown[] = [];
  for (const n of names) {
    try { out.push(JSON.parse(await fsp.readFile(path.join(dir, n), "utf8"))); } catch { /* skip corrupt */ }
  }
  return out;
}

export function createZuzuuApi(getRoot: () => string, opts: ApiOpts = {}): Hono {
  const app = new Hono();
  let root = getRoot();
  app.use("*", async (_c, next) => { root = getRoot(); await next(); });
  app.onError((err, c) => {
    if (err instanceof PathError) return c.json({ error: err.message }, 403);
    return c.json({ error: "internal error" }, 500);
  });

  const agentDir = async () => resolveSafe(root, "agent");
  const hasBin = () => {
    const bin = opts.binary ?? "zuzuu";
    // best-effort: a spawn in runZuzuu is the real test; here report optimistic unless explicitly stubbed absent
    return bin === "zuzuu";
  };

  app.get("/health", async (c) => {
    const agent = await agentDir();
    return c.json({ home: existsSync(agent), zuzuuBin: hasBin() });
  });

  app.get("/faculties", async (c) => {
    const agent = await agentDir();
    const faculties = [];
    for (const key of FACULTIES) {
      let count = 0, pending = 0;
      try {
        const itemsDir = key === "knowledge" ? path.join(agent, key, "items") : path.join(agent, key);
        count = (await readJsonDir(itemsDir)).length;
      } catch { count = 0; }
      try { pending = (await readJsonDir(path.join(agent, key, "proposals"))).length; } catch { pending = 0; }
      faculties.push({ key, count, pending });
    }
    return c.json({ faculties });
  });

  app.get("/faculty/:key", async (c) => {
    const key = c.req.param("key");
    if (!FACULTIES.includes(key as typeof FACULTIES[number])) return c.json({ error: "unknown faculty" }, 404);
    const agent = await agentDir();
    const itemsDir = key === "knowledge" ? path.join(agent, key, "items") : path.join(agent, key);
    const items = (await readJsonDir(itemsDir)).map((it: unknown) => {
      const o = it as { id?: string; body?: string };
      return { id: o.id ?? "?", title: (o.body ?? o.id ?? "").toString().split("\n")[0].slice(0, 80), path: "" };
    });
    const proposals = (await readJsonDir(path.join(agent, key, "proposals"))).map((p: unknown) => {
      const o = p as { id?: string; payload?: { body?: string } };
      return { id: o.id ?? "?", faculty: key, title: (o.payload?.body ?? o.id ?? "").toString().split("\n")[0].slice(0, 80) };
    });
    return c.json({ key, items, proposals });
  });

  app.get("/generations", async (c) => {
    const agent = await agentDir();
    const gens = (await readJsonDir(path.join(agent, "generations"))) as Array<{ id?: string; mintedAt?: string; mintedFrom?: string[] }>;
    let active: string | null = null;
    try { active = (await fsp.readFile(path.join(agent, "generations", "active"), "utf8")).trim() || null; } catch { active = null; }
    return c.json({ active, generations: gens.map((g) => ({ id: g.id ?? "?", mintedAt: g.mintedAt ?? null, mintedFrom: g.mintedFrom ?? [] })) });
  });

  app.get("/sessions", async (c) => {
    const agent = await agentDir();
    try {
      const idx = JSON.parse(await fsp.readFile(path.join(agent, "sessions.json"), "utf8"));
      return c.json({ sessions: idx.sessions ?? [] });
    } catch { return c.json({ sessions: [] }); }
  });

  app.get("/digest", async (c) => {
    const agent = await agentDir();
    try { return c.json({ text: await fsp.readFile(path.join(agent, ".live", "digest.md"), "utf8") }); }
    catch { return c.json({ text: "" }); }
  });

  return app;
}
```

NOTE on `active` pointer: confirm the real format by inspecting a live home (`cat /Users/hkc/Documents/motorsandsensors/agent/generations/active`). The generation lockfile format is set by `zuzuu/faculty/generation.mjs` — if `active` is JSON not a bare id, adjust the read accordingly (the test fixture should mirror the real format).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/daemon/test/zuzuu-api.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/daemon/src/zuzuu-api.ts packages/daemon/test/zuzuu-api.test.ts
git commit -m "feat(daemon): createZuzuuApi file-read routes (faculties, faculty/:key, generations, sessions, digest, health)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 9: the shell-out routes with file fallback (`/status`, `/inbox`, `/generation/:id`)

**Files:** Modify `packages/daemon/src/zuzuu-api.ts`; Test `packages/daemon/test/zuzuu-api.test.ts`.

- [ ] **Step 1: Write the failing test** (append) — stub binary + fallback

```typescript
describe("createZuzuuApi computed routes", () => {
  it("GET /status uses zuzuu --json when available", async () => {
    fixtureHome(root);
    const stub = path.join(root, "zuzuu-stub.sh");
    writeFileSync(stub, '#!/bin/sh\necho \'{"home":true,"activeGeneration":"gen_001","pending":{"knowledge":2},"drift":{"dirty":false,"items":[]}}\'\n');
    chmodSync(stub, 0o755);
    const app = createZuzuuApi(() => root, { binary: stub });
    const body = await (await app.request("/status")).json();
    expect(body.activeGeneration).toBe("gen_001");
    expect(body.pending.knowledge).toBe(2);
  });

  it("GET /status falls back to file-reads when zuzuu is absent", async () => {
    fixtureHome(root);
    const app = createZuzuuApi(() => root, { binary: "definitely-not-real-zzz" });
    const body = await (await app.request("/status")).json();
    expect(body.home).toBe(true);            // computed from files
    expect(body.activeGeneration).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/daemon/test/zuzuu-api.test.ts`
Expected: FAIL — `/status` route missing.

- [ ] **Step 3: Implement the computed routes** (append inside `createZuzuuApi`, before `return app;`)

```typescript
  app.get("/status", async (c) => {
    const viaCli = await runZuzuu(root, ["status"], { binary: opts.binary });
    if (viaCli) return c.json(viaCli);
    // fallback: compute from files
    const agent = await agentDir();
    const pending: Record<string, number> = {};
    for (const key of FACULTIES) pending[key] = (await readJsonDir(path.join(agent, key, "proposals"))).length;
    let active: string | null = null;
    try { active = (await fsp.readFile(path.join(agent, "generations", "active"), "utf8")).trim() || null; } catch { active = null; }
    return c.json({ home: existsSync(agent), activeGeneration: active, pending, drift: { dirty: false, items: [] } });
  });

  app.get("/inbox", async (c) => {
    const viaCli = await runZuzuu(root, ["inbox"], { binary: opts.binary });
    if (viaCli) return c.json(viaCli);
    const agent = await agentDir();
    const pending = [];
    for (const key of FACULTIES) {
      for (const p of (await readJsonDir(path.join(agent, key, "proposals"))) as Array<{ id?: string; payload?: { body?: string } }>)
        pending.push({ id: p.id ?? "?", faculty: key, title: (p.payload?.body ?? p.id ?? "").toString().split("\n")[0].slice(0, 80) });
    }
    return c.json({ pending, total: pending.length });
  });

  app.get("/generation/:id", async (c) => {
    const id = c.req.param("id");
    if (!/^[A-Za-z0-9_-]+$/.test(id)) return c.json({ error: "bad id" }, 400);
    const viaCli = await runZuzuu(root, ["generation", "show", id], { binary: opts.binary });
    if (viaCli) return c.json(viaCli);
    return c.json({ error: "generation diff needs the zuzuu CLI" }, 503);
  });
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/daemon/test/zuzuu-api.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add packages/daemon/src/zuzuu-api.ts packages/daemon/test/zuzuu-api.test.ts
git commit -m "feat(daemon): /status /inbox /generation/:id (zuzuu --json + file fallback)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 10: mount the routes in the server

**Files:** Modify `packages/daemon/src/server.ts` (near the existing `app.route("/api/fs", …)`).

- [ ] **Step 1: Add the import + mount**

```typescript
import { createZuzuuApi } from "./zuzuu-api.js";
// … near app.route("/api/fs", createFsApi(() => this.root)); add:
app.route("/api/zuzuu", createZuzuuApi(() => this.root));
```

- [ ] **Step 2: Build + typecheck + test**

```bash
npm run -w zuzuu-web build && npm run typecheck --workspaces --if-present 2>&1 | tail -3
npx vitest run packages/daemon/test 2>&1 | tail -5
```
Expected: clean + green.

- [ ] **Step 3: Manual smoke against the real zuzuu repo**

```bash
# in one terminal: run the daemon rooted at the zuzuu repo (which has a real agent/ home)
npx tsx packages/daemon/src/index.ts /Users/hkc/Documents/motorsandsensors --no-open --port 7771 &
# auth: grab the token from the daemon output, then:
curl -s -b "wc_auth=<token>" localhost:7771/api/zuzuu/health
curl -s -b "wc_auth=<token>" localhost:7771/api/zuzuu/faculties
```
Expected: `{home:true,...}` and the five faculties with real counts. (Cookie name = the daemon's `AUTH_COOKIE` constant; confirm in `server.ts`.)

- [ ] **Step 4: Commit**

```bash
git add packages/daemon/src/server.ts
git commit -m "feat(daemon): mount /api/zuzuu

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

# PHASE ④ — the Faculties view (zuzuu-web web)

CWD: `~/Documents/webcode`, same branch. The web app has light test coverage; each task builds the component + a build/typecheck gate, with one data-layer unit test.

### Task 11: the view toggle (`useView`) + top-bar swap

**Files:** Create `packages/web/src/state/view.ts`; Modify `packages/web/src/App.tsx`.

- [ ] **Step 1: Create the store**

```typescript
// packages/web/src/state/view.ts
import { create } from "zustand";
export type ViewMode = "ide" | "faculties";
interface ViewState { mode: ViewMode; setMode: (m: ViewMode) => void; }
export const useView = create<ViewState>((set) => ({ mode: "ide", setMode: (mode) => set({ mode }) }));
```

- [ ] **Step 2: Wire the toggle + center swap in App.tsx**

Add near the top of `App()`: `const view = useView((s) => s.mode); const setView = useView((s) => s.setMode);`. Add a top bar (above the main `Group`) with a `ModeTabs` or two `Button`s toggling `"ide"`/`"faculties"`. Wrap the existing IDE `Group` so it renders only when `view === "ide"`, and render `<FacultiesView/>` when `view === "faculties"`:

```tsx
{view === "ide" ? (
  <Group orientation="horizontal" className="min-h-0 flex-1">{/* existing sidebar + center */}</Group>
) : (
  <FacultiesView />
)}
```

(Import `FacultiesView` — created in Task 13; for this task, a placeholder `export function FacultiesView() { return <div className="p-4 text-meta">faculties</div>; }` so it compiles.)

- [ ] **Step 3: Build + typecheck**

Run: `npm run -w @zuzuu-web/web build && npm run -w @zuzuu-web/web typecheck 2>&1 | tail -3`
Expected: clean. Manual: the toggle switches panes.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/state/view.ts packages/web/src/App.tsx packages/web/src/faculties/FacultiesView.tsx
git commit -m "feat(web): ide|faculties view toggle

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 12: the REST client

**Files:** Create `packages/web/src/lib/zuzuu-api.ts`; Test `packages/web/src/lib/zuzuu-api.test.ts` (vitest; webcode web uses vitest if configured — else skip the unit test and rely on the daemon tests + manual smoke).

- [ ] **Step 1: Write the client** (mirror `lib/api.ts`'s `request<T>`)

```typescript
// packages/web/src/lib/zuzuu-api.ts
import type {
  ZuzuuHealth, ZuzuuStatus, FacultySummary, FacultyDetail, InboxResponse,
  GenerationList, GenerationDiff, SessionsResponse, DigestResponse,
} from "@zuzuu-web/protocol";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`/api/zuzuu${path}`);
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `request failed (${res.status})`);
  return res.json() as Promise<T>;
}

export const zuzuuApi = {
  health: () => get<ZuzuuHealth>("/health"),
  status: () => get<ZuzuuStatus>("/status"),
  faculties: () => get<{ faculties: FacultySummary[] }>("/faculties"),
  faculty: (key: string) => get<FacultyDetail>(`/faculty/${encodeURIComponent(key)}`),
  inbox: () => get<InboxResponse>("/inbox"),
  generations: () => get<GenerationList>("/generations"),
  generation: (id: string) => get<GenerationDiff>(`/generation/${encodeURIComponent(id)}`),
  sessions: () => get<SessionsResponse>("/sessions"),
  digest: () => get<DigestResponse>("/digest"),
};
```

- [ ] **Step 2: Build + typecheck**

Run: `npm run -w @zuzuu-web/web typecheck 2>&1 | tail -3`
Expected: clean (types resolve from `@zuzuu-web/protocol`).

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/lib/zuzuu-api.ts
git commit -m "feat(web): zuzuu-api REST client

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 13: StatusHeader + FacultyCards (the overview)

**Files:** Create `packages/web/src/faculties/FacultiesView.tsx`, `StatusHeader.tsx`, `FacultyCard.tsx`.

- [ ] **Step 1: StatusHeader** — `useQuery(["zuzuu","status"], zuzuuApi.status)`; render active generation, pending total (sum of `pending`), a `StatusDot` (`drift.dirty ? "warn" : "ok"`). Empty state if `!status.home`: "No zuzuu home here — run `zuzuu init`."

- [ ] **Step 2: FacultyCard** — props `{ data: FacultySummary; onSelect: () => void }`; renders key + count + a pending badge; `onClick={onSelect}`. Compose with `Bar`/`Button` + Tailwind tokens.

- [ ] **Step 3: FacultiesView** — `useQuery(["zuzuu","faculties"], zuzuuApi.faculties)`; lays out `<StatusHeader/>` then a grid of `<FacultyCard/>` ×5; holds `const [active, setActive] = useState<string|null>(null)` for drill-in (used in Task 14). Each card `onSelect={() => setActive(key)}`.

```tsx
// packages/web/src/faculties/FacultiesView.tsx (skeleton)
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { zuzuuApi } from "../lib/zuzuu-api";
import { StatusHeader } from "./StatusHeader";
import { FacultyCard } from "./FacultyCard";

export function FacultiesView() {
  const [active, setActive] = useState<string | null>(null);
  const faculties = useQuery({ queryKey: ["zuzuu", "faculties"], queryFn: zuzuuApi.faculties });
  return (
    <div className="flex h-full flex-col overflow-auto p-4 gap-4">
      <StatusHeader />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {faculties.data?.faculties.map((f) => <FacultyCard key={f.key} data={f} onSelect={() => setActive(f.key)} />)}
      </div>
      {/* Task 14 mounts <FacultyDetail facultyKey={active}/>; Task 15 the timeline; Task 16 sessions/digest */}
    </div>
  );
}
```

- [ ] **Step 4: Build + typecheck + manual smoke** (`npm run -w @zuzuu-web/web dev`, with the daemon running rooted at the zuzuu repo) — header + 5 cards show real counts.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/faculties/FacultiesView.tsx packages/web/src/faculties/StatusHeader.tsx packages/web/src/faculties/FacultyCard.tsx
git commit -m "feat(web): faculties overview — StatusHeader + FacultyCards

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 14: FacultyDetail + ProposalRow (drill-in)

**Files:** Create `packages/web/src/faculties/FacultyDetail.tsx`, `ProposalRow.tsx`; Modify `FacultiesView.tsx` (mount detail when `active`).

- [ ] **Step 1: ProposalRow** — props `{ data: ProposalSummary }`; one line: title · faculty (no actions — read-only).
- [ ] **Step 2: FacultyDetail** — props `{ facultyKey: string }`; `useQuery(["zuzuu","faculty",facultyKey], () => zuzuuApi.faculty(facultyKey))`; lists `items` (id + title) and `proposals` (as `ProposalRow`s) under headers; empty copy when each is empty.
- [ ] **Step 3: Mount in FacultiesView** — `{active && <FacultyDetail facultyKey={active} />}`.
- [ ] **Step 4: Build + typecheck + smoke** — clicking a card shows its items/proposals.
- [ ] **Step 5: Commit** — `feat(web): faculty drill-in — items + proposals`.

### Task 15: GenerationsTimeline + GenerationDiff

**Files:** Create `packages/web/src/faculties/GenerationsTimeline.tsx`, `GenerationDiff.tsx`; Modify `FacultiesView.tsx`.

- [ ] **Step 1: GenerationsTimeline** — `useQuery(["zuzuu","generations"], zuzuuApi.generations)`; render generations as a row of dots/labels, active marked (`●`); `useState` selected id; click → select.
- [ ] **Step 2: GenerationDiff** — props `{ id: string }`; `useQuery(["zuzuu","generation",id], () => zuzuuApi.generation(id))`; render per-faculty `+added ~changed -removed` from the diff; handle the 503 (zuzuu CLI absent) with a "needs the zuzuu CLI" note.
- [ ] **Step 3: Mount in FacultiesView** under the cards.
- [ ] **Step 4: Build + typecheck + smoke** — timeline shows generations; selecting shows the diff.
- [ ] **Step 5: Commit** — `feat(web): generations timeline + diff`.

### Task 16: SessionsList + DigestPanel

**Files:** Create `packages/web/src/faculties/SessionsList.tsx`, `DigestPanel.tsx`; Modify `FacultiesView.tsx`.

- [ ] **Step 1: SessionsList** — `useQuery(["zuzuu","sessions"], zuzuuApi.sessions)`; a compact table (status · host · session id), first ~12. Empty copy when none.
- [ ] **Step 2: DigestPanel** — `useQuery(["zuzuu","digest"], zuzuuApi.digest)`; render `text` as preformatted/markdown (reuse the web's markdown renderer if present, else `<pre>`). Empty copy when no digest yet.
- [ ] **Step 3: Mount both in FacultiesView.**
- [ ] **Step 4: Build + typecheck + smoke.**
- [ ] **Step 5: Commit** — `feat(web): sessions list + digest panel`.

---

# PHASE ⑤ — wire-up + states

### Task 17: live refresh via the existing fs watcher

**Files:** Modify `packages/web/src/App.tsx` (the `fsEvents.start` effect).

- [ ] **Step 1: Watch agent/ + invalidate** — in the existing `fsEvents.start((path) => {…})` effect, also `fsEvents.watch("agent")` and, on a change whose path starts with `agent`, invalidate the zuzuu queries:

```typescript
fsEvents.start((p) => {
  // … existing invalidations …
  if (p === "agent" || p.startsWith("agent/")) {
    void queryClient.invalidateQueries({ queryKey: ["zuzuu"] });
  }
});
fsEvents.watch("agent");
```

NOTE: the daemon's chokidar watch is `depth: 0` per watched path (`ws-fs.ts`) — to catch nested faculty/proposal writes, either watch the specific subpaths the dashboard cares about (`agent`, `agent/knowledge/proposals`, `agent/generations`, …) on mount of `FacultiesView`, or add a `refetchInterval` (e.g. 4000ms, like `GitPanel`) on the zuzuu queries as a simpler catch-all. Prefer the `refetchInterval` for the MVP (less coupling); document the watcher path as a future refinement.

- [ ] **Step 2: Implement the chosen approach** — add `refetchInterval: 4000, placeholderData: keepPreviousData` to the zuzuu `useQuery`s (mirror `GitPanel`). This is the simplest reliable live-refresh and removes the depth-0 watcher concern.
- [ ] **Step 3: Build + smoke** — run `zuzuu review` (approve a proposal) in a terminal rooted at the same repo; the dashboard's pending count drops within ~4s.
- [ ] **Step 4: Commit** — `feat(web): live refresh of the faculties dashboard (poll)`.

### Task 18: empty + degraded states

**Files:** Modify the faculties components.

- [ ] **Step 1: No agent/ home** — `StatusHeader` already shows the init prompt when `!status.home`; ensure `FacultiesView` short-circuits to just the header (no cards) in that case.
- [ ] **Step 2: zuzuu binary absent** — `useQuery(["zuzuu","health"])`; when `!health.zuzuuBin`, render a subtle banner in `StatusHeader`: "showing file data only (zuzuu CLI not found)". `GenerationDiff` shows its 503 note.
- [ ] **Step 3: Per-section empties** — confirm each panel (faculty items, proposals, generations, sessions, digest) renders explicit empty copy, not blank.
- [ ] **Step 4: Build + typecheck + smoke** (run the daemon with `PATH` lacking `zuzuu` → banner appears; computed views still render from files).
- [ ] **Step 5: Commit** — `feat(web): empty + degraded (no home / no CLI) states`.

### Task 19: launch story, docs, finish

**Files:** Modify `~/Documents/webcode/README.md` (zuzuu-web section); manual verification.

- [ ] **Step 1: Document the launch** — add to the zuzuu-web README: `zuzuu-web <project-with-an-agent-home>` → open the URL → the **Faculties** tab; note read-only + the `zuzuu` CLI is optional (file-read fallback).
- [ ] **Step 2: Full manual smoke against the real home** — daemon rooted at `/Users/hkc/Documents/motorsandsensors`: verify status, 5 cards with real counts, drill into knowledge (real items + proposals), the generations timeline + a diff, sessions, digest, and live-refresh on a `zuzuu review`.
- [ ] **Step 3: Full test + typecheck**

```bash
npm test --workspaces --if-present 2>&1 | tail -5
npm run typecheck --workspaces --if-present 2>&1 | tail -3
```
Expected: green + clean.

- [ ] **Step 4: Commit + finish the branch**

```bash
git add -A && git commit -m "docs(zuzuu-web): launch + read-only dashboard notes

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
Then use **superpowers:finishing-a-development-branch** to merge `feat/zuzuu-api` (and `rename/zuzuu-web` if separate) into the zuzuu-web main.

---

## Self-Review

**Spec coverage:**
- `--json` outputs (status/inbox/generation/digest) → Tasks 1–4. ✓
- rename webcode→zuzuu-web (packages/bin/imports/strings; bin = `zuzuu-web` not `zuzuu`) → Task 5. ✓
- daemon `/api/zuzuu/*` (all 8 routes + health; file-read + `--json` shell-out + binary-absent fallback; `resolveSafe`; auth via mount) → Tasks 6–10. ✓
- full-pane Faculties view (toggle, overview, drill-in, timeline+diff, sessions, digest; TanStack Query + Zustand; design-system primitives) → Tasks 11–16. ✓
- live refresh + empty/degraded states + launch → Tasks 17–19. ✓
- testing (zuzuu node:test shapes; daemon vitest both seam paths + path-escape; web smoke) → Tasks 1–4, 7–9, 19. ✓
- read-only guarantee (no mutating routes) → Tasks 8–9 expose only GETs. ✓

**Placeholder scan:** none — every code step has complete code; two NOTEs flag real-format confirmations (the `active` pointer format, the AUTH_COOKIE name) to inspect against the live home, not placeholders.

**Type consistency:** the protocol types (Task 6) are the single source the daemon returns and the web client consumes (Task 12); route shapes in Tasks 8–9 match `FacultySummary`/`InboxResponse`/`GenerationList`/`GenerationDiff`. `runZuzuu(root, args, opts)`, `createZuzuuApi(getRoot, opts)`, `zuzuuApi.*`, `useView` are used consistently across tasks.

**Known confirmations to make during implementation** (flagged inline, not deferrable work): the generation `active` pointer on-disk format (bare id vs JSON) — mirror it in the Task 8 fixture; webcode's `AUTH_COOKIE` constant name for the curl smokes; whether `digest --json` already exists (Task 4 Step 1).
