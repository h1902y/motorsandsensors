# zuzuu-web — read-only observe dashboard (design)

**Date:** 2026-06-12 · **Status:** approved design, ready for implementation plan

## Context

zuzuu (the agent-faculty tool) is git-native and CLI-first: everything it owns lives in a project's visible `agent/` home (the 5 faculties + `generations/` + `sessions.json` + the live digest). The CLI surfaces this through `zuzuu status / inbox / generation / explain / digest`, but there is no visual way to *see* an agent's faculties evolving. This spec designs **zuzuu-web**: a local web dashboard that **observes** a project's `agent/` home — where you are in the graduation loop, what's pending, what each faculty holds, how generations changed.

It is built by adopting `~/Documents/webcode` — a working v0.5 local-daemon web IDE (Hono daemon + React/Vite/Tailwind/Monaco/xterm/Zustand/TanStack Query) — **renamed `zuzuu-web`**, and adding a faculties dashboard alongside its existing IDE. This is the **observe** half of an eventual studio; mutations (approve/reject from the browser) are explicitly out of scope for this MVP and come in a later slice.

**Locked decisions (from brainstorming):**
- **UI shape:** a **full-pane Faculties view** — a top-level toggle swaps the center area between the IDE and the dashboard.
- **MVP depth:** **overview + browse into items** — at-a-glance status *and* drill-in to each faculty's actual items/proposals, the generations timeline + diff, sessions.
- **Data seam:** the daemon **reads `agent/` files directly** for raw data + **shells out to `zuzuu --json`** for computed views.
- **Read-only** — no approve/reject/mint from the browser in this MVP.

## Scope

This spec spans **two repos**:
1. **zuzuu** (`/Users/hkc/Documents/motorsandsensors`) — add `--json` output to the computed commands the dashboard consumes. Small, hermetic, reusable beyond the dashboard.
2. **zuzuu-web** (`~/Documents/webcode`, renamed) — the rename + the daemon `/api/zuzuu/*` routes + the Faculties view.

Cohesive enough for one implementation plan with five sequenced phases.

## Architecture

```
  Browser (zuzuu-web)                    zuzuu-web daemon (Hono)              a project
 ┌────────────────────┐   /api/zuzuu/*  ┌──────────────────────────┐        ┌──────────┐
 │ Faculties view      │ ──REST(auth)──► │ createZuzuuApi(()=>root) │        │  agent/  │
 │  StatusHeader        │               │  ├ read files ───────────┼──────► │  …        │
 │  FacultyCard ×5      │ ◄─JSON──────── │  └ shell `zuzuu --json`  │ spawn  │          │
 │  Timeline · Sessions │               │     (cwd = root)         │ ─────► │ (zuzuu   │
 │  FacultyDetail/Diff  │   /ws/fs       │  resolveSafe(root,agent) │        │  binary) │
 └────────────────────┘ ◄─watch agent/─ └──────────────────────────┘        └──────────┘
```

- The daemon serves a single workspace root (`this.root`, passed at launch — `packages/daemon/src/index.ts`). It observes `<root>/agent/`. You launch zuzuu-web rooted at a project that has a faculty home.
- Raw, already-JSON data (faculty items, proposals, generation lockfiles, `sessions.json`) is **read from disk** via `resolveSafe(root, "agent")` (the existing path-safety choke point, `packages/daemon/src/safe-path.ts`).
- Computed/derived views (status rollup, inbox titles+scores, generation diff, digest) come from **`zuzuu <cmd> --json`**, spawned with `cwd = root`. **If the `zuzuu` binary is not on PATH, those routes degrade to file-reads** (best-effort) so the dashboard still renders.

## Part 1 — zuzuu `--json` outputs (in the zuzuu repo)

Add a `--json` flag to the computed commands so consumers get a stable contract instead of parsing human text. Pure functions return the data object; the command prints `JSON.stringify` when `--json` is set, else the existing text. Hermetic `node:test` asserts each shape. No behavior change to the default text output.

| command | `--json` shape (sketch) |
|---|---|
| `zuzuu status --json` | `{ home: bool, activeGeneration: string\|null, pending: {<faculty>: n}, drift: {dirty: bool, items: [...] } }` |
| `zuzuu inbox --json` | `{ pending: [{ id, faculty, title, score? }], total }` |
| `zuzuu generation list --json` | `{ active: string\|null, generations: [{ id, mintedAt, mintedFrom: [...] }] }` |
| `zuzuu generation show <id> --json` | `{ id, forkedFrom, mintedFrom: [...], faculties: {<f>: {added, changed, removed}} }` (reuses `diffGenerations`) |
| `zuzuu digest --json` | `{ text, sections: {...} }` (already supports `--json`; confirm/extend) |

These reuse existing pure helpers (`detectDrift`, `listProposals`, `diffGenerations`, `computeDigest`, `facultiesLine`/`activeGeneration`). The flag plumbs through `bin/zuzuu.mjs` arg parsing (which already captures flags). The zuzuu test suite (currently 346) gains one shape test per command.

## Part 2 — webcode → zuzuu-web rename (in the webcode repo)

A mechanical, isolated commit; keep webcode's own tests green.
- Package `name`s: root `webcode-workspace`→`zuzuu-web-workspace`; daemon `webcode`→`zuzuu-web`; `@webcode/web`→`@zuzuu-web/web`; `@webcode/protocol`→`@zuzuu-web/protocol`.
- Import specifiers `@webcode/*` → `@zuzuu-web/*` across `*.ts`/`*.tsx`.
- **Daemon bin: `webcode` → `zuzuu-web`** (NOT `zuzuu` — that name is the faculty CLI; shadowing it would break the very binary the daemon shells out to). Rename `packages/daemon/bin/webcode.js` → `zuzuu-web.js`.
- Window event names `webcode:*` → `zuzuu-web:*` (`packages/web/src/App.tsx`).
- User-visible display strings ("webcode") → "zuzuu-web" where they appear in the shell.

## Part 3 — daemon `/api/zuzuu/*` routes

A new module `packages/daemon/src/zuzuu-api.ts` exporting `createZuzuuApi(getRoot: () => string): Hono`, modeled exactly on `fs-api.ts` (the per-request `root = getRoot()` refresh, `resolveSafe`, the `onError` mapping PathError→403 / ENOENT→404). Mounted in `server.ts` beside the fs route: `app.route("/api/zuzuu", createZuzuuApi(() => this.root))` — inheriting the existing `/api/*` auth middleware.

A small `runZuzuu(root, args): Promise<unknown|null>` helper spawns `zuzuu <args> --json` with `cwd = root`, parses stdout JSON, returns `null` on spawn failure / non-zero / absent binary (the file-read fallback path). Spawns are short, read-only, and time-boxed.

Routes (all read-only):

| route | implementation |
|---|---|
| `GET /status` | `runZuzuu(root, ["status"])` → fallback: read generations active + count proposals + drift |
| `GET /faculties` | read `agent/<faculty>/` dirs → `[{ key, count }]` for the 5 faculties |
| `GET /faculty/:key` | read that faculty's item files + `inbox/`/`proposals/` (validate `:key` ∈ the 5) |
| `GET /inbox` | `runZuzuu(root, ["inbox"])` → fallback: read `proposals/` titles |
| `GET /generations` | read `agent/generations/*.json` + `active` pointer |
| `GET /generation/:id` | `runZuzuu(root, ["generation", "show", id])` (validate id) |
| `GET /digest` | read `agent/.live/digest.md` (or `runZuzuu(root, ["digest"])`) |
| `GET /sessions` | read `agent/sessions.json` |
| `GET /` (or `/health`) | `{ home: existsSync(agent), zuzuuBin: bool }` — drives the empty/degraded states |

Shared types live in `@zuzuu-web/protocol` (the existing protocol package) so the web client imports the same shapes.

**Tests** (webcode's framework — vitest): build a fixture `agent/` dir in a temp root; assert each route's JSON against it. For the shell-out routes, test both paths — a stubbed `zuzuu` on PATH (a tiny script emitting known JSON) and the binary-absent file-read fallback.

## Part 4 — the Faculties full-pane view (web)

A top-level view toggle: a small app store `useView` with `mode: 'ide' | 'faculties'`, and a tab/segmented control in the top bar (`App.tsx`). When `mode === 'faculties'`, the center area renders `<FacultiesView/>` instead of the IDE Group; the sidebar can hide or stay (decided at build time — default: dashboard takes the full width).

Component tree (`packages/web/src/faculties/`):
- `FacultiesView.tsx` — the root; lays out header + cards + timeline + sessions; owns the drill-in selection.
- `StatusHeader.tsx` — active generation · pending total · drift badge · agent-home/zuzuu-absent notices. Uses `StatusDot`.
- `FacultyCard.tsx` ×5 — key + item count + pending badge; click selects the faculty.
- `FacultyDetail.tsx` — the selected faculty's items list + `ProposalRow`s.
- `ProposalRow.tsx` — proposal title · faculty · eval score (read-only).
- `GenerationsTimeline.tsx` — generations as a row of dots (active marked); click → `GenerationDiff`.
- `GenerationDiff.tsx` — the per-faculty added/changed/removed from `/generation/:id`.
- `SessionsList.tsx` — recent sessions from `/sessions`.
- `DigestPanel.tsx` — the grounding brief (can reuse Monaco/markdown render).

**Data layer:** `packages/web/src/lib/zuzuu-api.ts` (mirrors `lib/api.ts`'s `request<T>` wrapper) + TanStack Query keyed `["zuzuu", <route>, …]`, consumed exactly like `GitPanel` (`useQuery` + `placeholderData`). A small `useZuzuu` Zustand store holds the drill-in selection (active faculty / generation), mirroring `state/explorer.ts`.

**Design system:** compose from the existing primitives (`Bar`, `Button`, `StatusDot`, `Tabs/ModeTabs`, `Field`, the Tailwind `@theme` tokens) — no new design language.

## Part 5 — wire-up, live refresh, and states

- **Live refresh:** reuse the existing `/ws/fs` chokidar channel (`packages/web/src/lib/fs-events.ts`): `fsEvents.watch("agent")` and, in the App invalidation effect, invalidate `["zuzuu"]` queries when a change under `agent/` arrives. Running `zuzuu review`/`distill` in the terminal refreshes the dashboard live.
- **States (must be explicit, not blank):**
  - no `agent/` home in the workspace → an empty state: "No zuzuu home here — run `zuzuu init`."
  - `zuzuu` binary absent → a subtle banner: "showing file data only (zuzuu CLI not found)"; computed views fall back.
  - empty faculty / no proposals / no generations → per-section empty copy.
- Launch story (README/docs): `zuzuu-web <project-dir>` (or run it in a repo with an `agent/` home) → open the printed URL → the Faculties tab.

## Error handling

- Daemon: PathError→403, ENOENT→404, malformed `agent/` JSON → 200 with a `{ partial: true }` marker rather than a 500 (a corrupt single item must not blank the dashboard); spawn failures → `null` → file-read fallback. Never throw past `onError`.
- Web: the `request<T>` wrapper surfaces `ApiError`; each panel renders its own error/empty state (no global crash).
- Read-only guarantee: the daemon exposes **no** mutating zuzuu routes in this MVP; the dashboard cannot change `agent/`.

## Testing strategy

- **zuzuu repo:** one hermetic `node:test` per `--json` command asserting the shape; default text output unchanged (existing tests stay green).
- **zuzuu-web daemon:** vitest against a fixture `agent/` temp dir — each route's JSON; the shell-out routes tested on both the stubbed-binary and absent-binary paths; path-escape attempts → 403.
- **zuzuu-web web:** the data layer (`zuzuu-api.ts`) + key panels at webcode's existing test depth; manual smoke: launch rooted at this repo (which has a real `agent/` home) and verify the dashboard renders status, cards, a generation diff, sessions, digest, and live-refreshes on a `zuzuu review`.

## Out of scope (explicit)

- Any mutation from the browser (approve/reject/mint/rollback) — the next slice.
- Multi-project / project-switcher beyond webcode's existing single-root + `switchTo`.
- Auth/hosting changes (reuse webcode's token gate + localhost model).
- Renaming the zuzuu generated plugin/extension files (`mns.js`/`mns.ts`) — tracked separately.

## Build sequence

**① zuzuu `--json` (zuzuu repo) → ② rename (webcode repo) → ③ daemon routes → ④ Faculties view → ⑤ wire-up + states.** ① is the contract the daemon depends on; ② unblocks all webcode-side work; ③ before ④ so the view has real data; ⑤ closes the loop with live refresh + honest empty/degraded states.
