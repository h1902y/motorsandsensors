# W2 Workbench v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship workbench v1 per `docs/specs/2026-06-12-w2-workbench-v1-design.md` — HITL review in the browser, agent-session UX, Home→Workbench integration, `zz web` distribution.

**Architecture:** Two repos. **zuzuu** (`/Users/hkc/Documents/zuzuu`, zero-dep ESM, `node:test`) grows `--json` on the commands the daemon shells to, plus a `zz web` launcher mirroring `commands/code.mjs`. **zuzuu-web** (`/Users/hkc/Documents/webcode`, Hono daemon + React/Vite, vitest) grows CLI-only mutation routes, the ReviewFlow, Home CTAs/onboarding, and workbench integration. Mutations always shell to the zuzuu CLI (absent → 503); agent sessions and `zuzuu init` run in real PTYs via the existing stdin-injection mechanism (`termRegistry.sendInput`, same as workflows — no sessions-API change).

**Tech Stack:** Node ≥22, Hono 4, React 19, Zustand, TanStack Query, xterm.js 6, vitest / node:test.

**Conventions:** zuzuu repo — hermetic tests, no new deps, follow `code.mjs`'s injectable-deps seam. webcode repo — follow `zuzuu-api.ts` route style, `GitPanel.tsx` mutation pattern (direct api call + manual `invalidateQueries`), protocol types in `packages/protocol/src/zuzuu.ts`. Commit after every task; zuzuu repo work on branch `w2/workbench`, webcode on `main` (no remote yet until Task 8).

---

## Phase ① — zuzuu repo: `--json` gaps

### Task 1: `eval --json`

**Files:** Modify `zuzuu/commands/eval.mjs`; Test `tests/unit/json-outputs.test.mjs`

- [ ] **Step 1: failing test** — append to `tests/unit/json-outputs.test.mjs` (reuse its fixture-home helper):

```js
test('evalData ranks pending proposals with scores', () => {
  withHome((dir) => {
    seedProposal(dir, 'knowledge', 'p1');            // existing helper pattern in this file
    const data = evalData(dir);
    assert.ok(Array.isArray(data.ranked));
    const r = data.ranked[0];
    for (const k of ['id', 'faculty', 'title', 'score', 'confidence', 'rationale']) assert.ok(k in r);
  });
});
```

- [ ] **Step 2:** `node --test tests/unit/json-outputs.test.mjs` → FAIL (`evalData` not exported)
- [ ] **Step 3:** in `eval.mjs`, extract the existing gather+`rank()` pipeline into exported pure `evalData(agentDir)` returning `{ ranked: [{ id, faculty, title, score, confidence, rationale }] }` (map from `rank()`'s `{proposal, score, confidence, rationale}`); command body: `if (args.json) return console.log(JSON.stringify(evalData(dir)))`, else existing table.
- [ ] **Step 4:** test passes; `npm test` green. **Step 5:** commit `feat(cli): zuzuu eval --json`.

### Task 2: `proposals … --json` (list/show/approve/reject, `--faculty` on mutations)

**Files:** Modify `zuzuu/commands/review.mjs` (the `proposals(args)` surface, ~lines 284-290); Test `tests/unit/json-outputs.test.mjs`

- [ ] **Step 1: failing tests** — approve emits `{ok, action, itemIds, warnings}`; reject emits `{ok, archived}`; list emits `{pending:[{id,faculty,title}]}`. Use a temp home + seeded proposal; call the exported data/command functions directly (capture stdout via the file's existing pattern).
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** in the `proposals` subcommand handlers: when `args.json`, print `JSON.stringify(result)` instead of the `✓/✗` lines — the result objects already exist (`gate.approve`/`gate.reject` returns). Honor `args.faculty` when resolving (it already does via `facultyOf`); keep exit codes.
- [ ] **Step 4:** green. **Step 5:** commit `feat(cli): proposals --json`.

### Task 3: `act inbox|approve|reject --json`

**Files:** Modify `zuzuu/commands/act.mjs`; Test `tests/unit/json-outputs.test.mjs`

- [ ] **Step 1: failing tests** — `act inbox --json` → `{pending:[{slug, promptSnippet?}]}` (from `listInbox`); `act approve --json` → `{ok, action}` (from the actions adapter's `activateAction` result); reject likewise.
- [ ] **Step 2:** FAIL. **Step 3:** add `args.json` branches printing the underlying result objects. **Step 4:** green. **Step 5:** commit.

### Task 4: `generation mint --json [--from a,b,c]` + `rollback --json`

**Files:** Modify `zuzuu/commands/generation.mjs` (mint + rollback cases, ~lines 81-100); Test `tests/unit/json-outputs.test.mjs`

- [ ] **Step 1: failing tests** — mint on a seeded home returns `{id, mintedFrom, forkedFrom}`; with `--from p1,p2` → `mintedFrom: ['p1','p2']`; rollback returns `{ok, restored, active}`.
- [ ] **Step 2:** FAIL. **Step 3:** mint case: parse `args.from` (comma-split) → pass as `mintedFrom` to the existing `mintGeneration(dir, {forkedFrom: activeGeneration(dir), mintedFrom})`; `args.json` prints the returned gen record subset. Rollback: wrap the existing `rollback(dir, id)` result (`{ok, restored}`) + `active: id`.
- [ ] **Step 4:** green. **Step 5:** commit.

### Task 5: `status --json` gains `hosts`

**Files:** Modify `zuzuu/commands/status.mjs` (`statusData`, line ~53); Test `tests/unit/json-outputs.test.mjs`

- [ ] **Step 1: failing test** — `statusData(dir, { hosts: [{name:'claude-code'}] })` includes `hosts: [{name:'claude-code'}]` (injection keeps the test hermetic).
- [ ] **Step 2:** FAIL. **Step 3:** `statusData(dir, { hosts = detected().map(a => ({ name: a.name })) } = {})` → add `hosts` to the returned object. **Step 4:** green; whole suite green. **Step 5:** commit.

### Task 6: `zz web` command

**Files:** Create `zuzuu/commands/web.mjs`; Modify `bin/zuzuu.mjs` (import + help + case); Test `tests/unit/web.test.mjs` (mirror `tests/unit/code.test.mjs`)

- [ ] **Step 1: failing tests** (clone `code.test.mjs` shape; deps recorded as call tuples):

```js
import { web } from '../../zuzuu/commands/web.mjs';
test('web: detected binary → launches without install', () => {
  const calls = [];
  web({ _: [] }, { detect: () => true, install: () => calls.push(['install']),
    prompt: () => true, launch: (o) => calls.push(['launch', o.cwd]), log: () => {} });
  assert.deepEqual(calls, [['launch', process.cwd()]]);
});
test('web: absent binary + accepted prompt → installs then launches', () => { /* detect false, prompt true → ['install'],['launch',…] */ });
test('web: absent binary + declined prompt → no install, no launch', () => { /* prompt false → [] */ });
```

- [ ] **Step 2:** FAIL. **Step 3:** implement `web(args, deps)` mirroring `code.mjs`'s seam exactly: `realDetect` = `spawnSync('zuzuu-web', ['--version'])` ok; `realInstall` = `npm i -g @zuzuucodes/web`; `realLaunch` = `spawn('zuzuu-web', [dir], {detached: true, stdio: 'ignore'}).unref()` + log "opening in your browser — zuzuu-web prints the URL". No `runInit` (Home owns onboarding, per spec). Wire `case 'web': web(args); break;` + help line `web [dir]  launch the visual workbench (installs @zuzuucodes/web on demand)`.
- [ ] **Step 4:** green; `npm test` green. **Step 5:** commit `feat(cli): zz web — launch the workbench (runtime peer)`.

### Task 7: release the CLI (the daemon shells to these new flags)

- [ ] Bump `package.json` version `1.0.1 → 1.1.0`; commit `v1.1.0 — workbench CLI surface (--json + zz web)`; merge `w2/workbench` → `main`; push. OIDC auto-publishes. Verify: `npm view @zuzuucodes/cli version` → `1.1.0` (poll, ~2 min).

## Phase ② — publish zuzuu-web

### Task 8: GitHub repo + npm `@zuzuucodes/web`

**Files (webcode repo):** Modify `packages/daemon/package.json`; possibly `packages/daemon/src/server.ts` static-serving path (discovery step).

- [ ] **Step 1 (discovery):** find how the daemon serves the built web app (`grep -rn "dist\|static\|serveStatic" packages/daemon/src/`) — confirm what `npm run build` produces and where the daemon expects it at runtime.
- [ ] **Step 2:** make the daemon package self-contained for publish: `"name": "@zuzuucodes/web"` (bin stays `"zuzuu-web"`), `"publishConfig": {"access":"public"}`, a `files` field covering its `dist/` + the built web assets (add a build step copying `packages/web/dist` into `packages/daemon/web-dist/` if the static path needs it), `prepublishOnly: npm test`.
- [ ] **Step 3:** `npm run build && npm test` green; pack-check: `npm pack --dry-run -w packages/daemon` lists the bin, dist, and web assets.
- [ ] **Step 4:** `gh repo create h1902y/zuzuu-web --public --source ~/Documents/webcode --push`.
- [ ] **Step 5:** `npm publish -w packages/daemon` (user runs auth if prompted). Verify `npx @zuzuucodes/web --version` in a tmp dir. Commit + push.

## Phase ③ — daemon mutation routes

### Task 9: `runZuzuuMut` helper

**Files (webcode):** Modify `packages/daemon/src/zuzuu-api.ts`; Test `packages/daemon/test/zuzuu-api.test.ts`

- [ ] **Step 1: failing tests** (use the existing `jsonStub` mechanism; add a `failStub` exiting 1 with stderr):

```ts
it("runZuzuuMut: ok → {ok:true,data}", async () => { /* jsonStub '{"ok":true}' → {ok:true,data:{ok:true}} */ });
it("runZuzuuMut: non-zero → {ok:false,code:'failed',stderr}", async () => { /* failStub */ });
it("runZuzuuMut: absent binary → {ok:false,code:'absent'}", async () => { /* binary:'/nonexistent' */ });
```

- [ ] **Step 2:** FAIL. **Step 3:** implement beside `runZuzuu`: same spawn (args array + `--json`, cwd=root, 10s timeout) but `stdio:["ignore","pipe","pipe"]`, distinguish ENOENT/spawn-error (`absent`) from non-zero exit (`failed`, capture stderr tail ≤2 KB), parse stdout JSON on success.
- [ ] **Step 4:** green. **Step 5:** commit.

### Task 10: mutation + eval + hosts routes

**Files (webcode):** Modify `packages/daemon/src/zuzuu-api.ts`, `packages/protocol/src/zuzuu.ts`; Test `packages/daemon/test/zuzuu-api.test.ts`

- [ ] **Step 1: failing tests** — for each route: stub-success → 200 with the CLI's JSON; failStub → 502 `{error, stderr}`; absent → 503 `{error:"zuzuu CLI required"}`; id/slug with `../` or shell-meta → 400 (never reaches spawn).
- [ ] **Step 2:** FAIL. **Step 3:** implement in `createZuzuuApi` (validators: `const SAFE_ID = /^[a-z0-9][a-z0-9._-]*$/i`):

```ts
app.post("/proposals/:id/approve", ...)   // runZuzuuMut(root, ["proposals","approve",id,"--faculty",body.faculty])
app.post("/proposals/:id/reject", ...)    // ["proposals","reject",id,"--faculty",body.faculty]  (reason: body.reason → ["--reason", body.reason] if provided)
app.post("/actions/:slug/approve", ...)   // ["act","approve",slug]
app.post("/actions/:slug/reject", ...)    // ["act","reject",slug]
app.post("/generation/mint", ...)         // ["generation","mint", ...(body.from?.length ? ["--from", body.from.join(",")] : [])]
app.post("/generation/:id/rollback", ...) // ["generation","rollback",id]
app.get("/eval", ...)                     // runZuzuu(root,["eval"]) → fallback: inbox file-read with score:null per item
app.get("/hosts", ...)                    // runZuzuu(root,["status"]) → {hosts: data?.hosts ?? [], cliAbsent: data===null}
```

Map `{ok:false,code:'absent'}` → 503, `'failed'` → 502. Add protocol types: `EvalResponse {ranked: RankedProposal[]}`, `RankedProposal`, `HostsResponse {hosts:{name:string}[], cliAbsent:boolean}`, `MutationResult {ok:boolean; action?:string; warnings?:string[]}`.
- [ ] **Step 4:** green (`npm test -w zuzuu-web`). **Step 5:** commit `feat(daemon): zuzuu mutation routes — CLI-only, 503 without the binary`.

## Phase ④ — ReviewFlow

### Task 11: client mutations + ReviewFlow component

**Files (webcode):** Modify `packages/web/src/lib/zuzuu-api.ts`; Create `packages/web/src/faculties/ReviewFlow.tsx`; Modify `packages/web/src/faculties/FacultyDetail.tsx`; Test `packages/web/src/faculties/ReviewFlow.test.tsx` (existing web test setup)

- [ ] **Step 1:** extend `zuzuuApi` with `eval()`, `hosts()`, `approveProposal(id, faculty)`, `rejectProposal(id, faculty, reason?)`, `approveAction(slug)`, `rejectAction(slug)`, `mintGeneration(from)`, `rollback(id)` — thin POST wrappers via the existing `request<T>` helper.
- [ ] **Step 2: failing component test** — render ReviewFlow with a mocked queue of 2; approve advances and records the call; reject requires/sends reason; end screen fires `mintGeneration(['p1'])` once when ≥1 approved and renders the gen id.
- [ ] **Step 3:** implement `ReviewFlow` as an `Overlay` (existing primitive): queue from `useQuery(["zuzuu","eval"])` + `["zuzuu","actions-inbox"]`; card shows title/faculty/payload/evidence/score+rationale; buttons Approve / Reject (reason input) / Skip — GitPanel pattern (`await api…; queryClient.invalidateQueries({queryKey:["zuzuu"]})`); on 503 render the install-CLI banner inside the overlay (no dead buttons); end screen: if approvals>0 → mint → "generation `<id>` minted" + link to timeline diff; else "all caught up".
- [ ] **Step 4:** test green; add inline Approve/Reject buttons on `FacultyDetail` proposal rows using the same api calls. **Step 5:** commit.

## Phase ⑤ — Home + onboarding

### Task 12: Home CTAs + onboarding card

**Files (webcode):** Modify `packages/web/src/faculties/FacultiesView.tsx`, `packages/web/src/faculties/StatusHeader.tsx`; Create `packages/web/src/faculties/HomeCtas.tsx`, `packages/web/src/lib/agent-launch.ts`

- [ ] **Step 1:** `agent-launch.ts` — the one helper both Home and the workbench use:

```ts
export async function launchInTerminal(command: string) {
  const s = await api.createSession({});            // existing POST /api/sessions wrapper
  useSessions.getState().add(s); useSessions.getState().setActive(s.id);
  useView.getState().setMode("ide");
  await termRegistry.whenReady(s.id);               // add: resolves when TermConnection is open
  termRegistry.get(s.id)?.sendInput(`\x15${command}\r`);   // exact workflows mechanism (App.tsx:177)
}
```

- [ ] **Step 2:** `HomeCtas.tsx`: **Start agent session** (popover listing `/hosts` results — `claude` · `gemini` · `codex` · `pi` · `OpenCode (bundled)` → commands `claude`/`gemini`/`codex`/`pi`/`zuzuu code`; absent hosts greyed) · **Review N** (badge from eval count; opens ReviewFlow) · **Open workbench** (`setMode("ide")`). Render at the top of `FacultiesView`.
- [ ] **Step 3:** onboarding variant: when `health.home === false` render a single card replacing the dashboard — "This project has no zuzuu home yet" + **Set up zuzuu** → `launchInTerminal("zuzuu init")`, follow-up hint card linking **Enable live capture** → `launchInTerminal("zuzuu enable")`. When `health.zuzuuBin === false` → banner with `npm i -g @zuzuucodes/cli`.
- [ ] **Step 4:** manual check (`npm run dev` against this repo): CTAs render, Start agent opens a terminal running the command, Review opens the flow. **Step 5:** commit.

## Phase ⑥ — workbench integration

### Task 13: Agent sidebar tab + status chip + live refresh

**Files (webcode):** Create `packages/web/src/explorer/AgentPanel.tsx`; Modify `packages/web/src/App.tsx` (sidebar options line ~229, panel branch ~244, status bar ~299-310, fs-invalidation effect ~58-68), `packages/web/src/state/explorer.ts` (sidebarMode union + "agent")

- [ ] **Step 1:** `AgentPanel`: pending count (eval query) + **Review** button → ReviewFlow; digest peek (first ~20 lines, "open full" → opens `.zuzuu/.live/digest.md` in the editor); faculty quick-links opening `.zuzuu/<f>/README.md`/items in Monaco via the existing file-open action; **Start agent session** reusing `HomeCtas`' popover.
- [ ] **Step 2:** sidebar: `options={["files","search","git","agent"]}`; render `<AgentPanel/>` for `"agent"`.
- [ ] **Step 3:** status bar chip beside the view ModeTabs: `gen_NNN · N pending` (status+eval queries; hidden when `home:false`); click → ReviewFlow.
- [ ] **Step 4:** live refresh: in the `fsEvents.start` callback add `if (path === ".zuzuu" || path.startsWith(".zuzuu/")) queryClient.invalidateQueries({queryKey:["zuzuu"]})`; call `fsEvents.watch(".zuzuu")` once on app start (chokidar does not ignore dot-dirs — verified). Keep the 4s poll as fallback.
- [ ] **Step 5:** typecheck + tests green; commit.

## Phase ⑦ — E2E + docs

### Task 14: end-to-end on this repo + ship docs

- [ ] **E2E (manual, in `/Users/hkc/Documents/zuzuu`):** `zz web` → installs/launches → Home renders status+digest → Start agent (`claude`) → terminal session live → run `zuzuu distill --all` in it → Review badge updates (live or ≤4 s) → ReviewFlow: approve one, reject one with reason → end screen mints generation → timeline shows it → rollback from timeline works → status chip updates. Negative: rename `zuzuu` binary temporarily → mutations 503 + banner; reads still render.
- [ ] **Docs:** wiki — new `Workbench` page (launch via `zz web`, Home, review ceremony, agent sessions; shipped behavior only) + Getting-Started mention; zuzuu README one-liner under the quickstart (`zuzuu web`); webcode README/CLAUDE.md updated.
- [ ] **Close-out per canon:** record the outcome in `experiments/LOG.md` (W2 entry), update `.personal/STATUS.md` + tick `zuzuu-product-experience.md` W2 boxes, **delete both spec files** from `docs/specs/` (git history is the archive). Final commits + pushes (both repos), zuzuu version bump if CLI changed since 1.1.0.

---

## Self-review notes

- Spec coverage: distribution (T6-8), mutations CLI-only (T9-10), ReviewFlow (T11), Home/onboarding (T12), integration + watcher risk (T13), E2E/wiki (T14). Mint gap discovered in grounding → covered by T4 + ReviewFlow end-step.
- Type/name consistency: `@zuzuucodes/web` (npm) / bin `zuzuu-web` / repo `h1902y/zuzuu-web`; route paths match the design spec table; `--from` comma list ↔ `body.from: string[]`.
- Known discovery steps (explicitly marked): daemon static-asset serving for publish (T8 step 1); `termRegistry.whenReady` may need adding (T12 step 1).
