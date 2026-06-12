# The Overhaul — codebase restructure + workbench IA v3 (design)

**Date:** 2026-06-13 · **Status:** approved (autonomous run; user directive 2026-06-13) · Companion spec: `2026-06-13-faculty-module-design.md`

## Context

User directive: the codebase grew fast across nine releases in two days; audit and restructure both layers to production grade — single-responsibility files, clean directory structure, dead-weight removal, performance, design-system consistency — and rework the workbench's information architecture (right panel three sections, slim footer, composer-style session start, sessions observability). "Extreme decisions" (Rust/Go rewrite) were authorized but are **declined with reasoning**: the audit (2026-06-13) found no language-level bottleneck — 9.9K LOC CLI + 10.3K LOC web, I/O-bound operations, per-spawn gate in ms, 667 tests green. A rewrite reproduces five-host hook integration for zero measured gain. Production-grade = boundaries + cleanliness, delivered here. Revisit with profiling data at Stage 3 (pi harness).

Audit facts driving this spec: 10 mixed-concern files (App.tsx 568 lines/12 concerns; migrate.mjs 572; server.ts 527; review.mjs 366 mixing ceremony+CLI+rendering; zuzuu-api.ts 418 mixing spawn-wrappers+routes); root-level zuzuu/*.mjs placement inconsistent; no dead exports (previous slices cleaned as they went); two mitigated N+1 spawn patterns; Vite chunk-size warning (no code-splitting).

## Part A — CLI restructure (zuzuu repo)

Organizing principle: **the Faculty Module contract** (companion spec) defines the domain layout; everything else is entry-points and infrastructure.

- **Directory rationalization** (git mv + import sweep; behavior-neutral, tests must stay green unchanged where possible):
  - `zuzuu/core/` ← store.mjs, session.mjs, capture-core.mjs (infrastructure)
  - `zuzuu/home/` ← scaffold.mjs, inject.mjs (the faculty-home lifecycle)
  - `zuzuu/sessions/` ← session-git.mjs (split: git plumbing vs session policy — two files), live/ stays
  - `zuzuu/faculty/` gains module.mjs (the contract, companion spec) + registry.mjs; guardrails.mjs moves INTO guardrails/ (engine.mjs) with a root re-export shim removed after import sweep
  - digest.mjs → zuzuu/digest/ (composes per-module digest sections — see module spec)
- **Splits** (single responsibility):
  - `commands/review.mjs` → review.mjs (interactive ceremony only) + proposals.mjs (non-interactive CLI) + shared faculty/render.mjs (card/text rendering)
  - `commands/migrate.mjs` → migrations/ dir: home.mjs (agent→.zuzuu), items.mjs (envelope), proposals.mjs (legacy schema), index.mjs (dispatch). Pure mechanical split.
  - `faculty/generation.mjs` → generation/read.mjs (list/show/diff) + generation/write.mjs (mint/rollback)
- **New surface (sessions observability contract for the web):** `zuzuu session inspect <id> --json` → `{session, trace: {spans, tools, duration}, signals: {<faculty>: counts}}` — reuses adapters' `mineSignals` on one session; `zuzuu sessions --json` list with state labels (active|completed|abandoned|captured).
- **Perf:** none required by evidence; keep the gate cache; note daemon-side batching below.
- Tests: suite stays green throughout; splits move tests alongside; no golden-id regeneration.

## Part B — Web restructure + IA v3 (web/)

**Decomposition:**
- App.tsx (568) → `app/Layout.tsx` (panes), `app/Footer.tsx`, `app/shortcuts.ts`, `app/queries.ts` (shared query hooks), App.tsx as thin composition (<120 lines).
- server.ts (527) → auth.ts (token/cookie/host gates) + routes stay; zuzuu-api.ts → zuzuu-cli.ts (runZuzuu/runZuzuuMut spawn layer) + zuzuu-routes.ts.
- Vite: lazy-load Monaco/editor and palette chunks (the chunk warning); verify bundle delta.
- **Daemon batching:** `GET /api/zuzuu/overview` — ONE CLI spawn (`zuzuu faculty items` per faculty stays, but add `zuzuu faculty overview --json` CLI command emitting all five faculties' counts+top-items in one process) — kills the 5-spawn-per-cycle pattern.

**IA v3 — the right panel becomes three sections** (top→bottom, one scroll):
1. **Needs you** (actionables): pending proposals grouped per faculty ("Knowledge: 3 to review") + Review CTA (moves here FROM the footer chip) + drift/CLI warnings. Empty → quiet "all caught up".
2. **Sessions** (observability v1): list from sessions.json + live state — **Active** session pinned top (the digest renamed **Session brief** lives under it — resolves the digest/instructions confusion; instructions = a faculty, the brief = "what the agent was told now"), completed/abandoned labeled. Click → **Session detail**: trace summary + per-faculty mined signals (from `session inspect`) + "what graduated from this session" (proposals whose provenance cites it). v1 scope: counts + lists, no transcript viewer (W-later).
3. **Faculties**: the five cards become a **2-col grid of compact square cards** (icon, name, count, pending dot) → drill-in FacultyView (kept, improved spacing/sections from the kit pass).
File mode (Monaco) unchanged over the whole panel.

**Footer → pristine:** keep only `❯_` (connection) · vault name (recents menu only — Browse stays; cwd display dropped, lives in session detail) · session-git indicator · `⌘K` · NEW info/help icon (opens explain/wiki links). Review CTA and the ⟡ chip move into panel section 1.

**Composer-style session start:** the start card is replaced by a bottom composer bar in the session pane — "Start a session with…" + host buttons inline (detected bold, others greyed); Enter starts the default (first detected). Recovery/end cards keep their center placement. (zuzuu-codes-default-provider product play: later, noted.)

**Design-system pass:** all panels consume components/ui + panel/kit only; sweep raw hex/ad-hoc spacing into tokens; kill remaining UI misses found during E2E.

## Out of scope
Rust/Go rewrite (declined, reasoning above) · transcript viewer in session detail · session branching/continuation UX (raw idea, future) · marketplace loading of third-party faculties (module contract ships; loading is W4) · zuzuu-codes provider play.

## Verification
Both suites green at every commit; playgrounds; live browser E2E (three sections with real data, composer start, footer, session detail signals); perf sanity (overview = 1 spawn; bundle chunk warning gone); ship v1.6.0 via pipeline; wiki/LOG/STATUS; specs deleted on ship per canon.
