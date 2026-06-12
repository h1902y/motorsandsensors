# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

**A working early-stage build + its canonical design.** The host coding-agent (Claude Code / Codex / Gemini CLI / OpenCode / pi) supplies the **brain**; this project gives it evolving **faculties** — Knowledge (semantic), Memory (episodic), Actions (procedural), Instructions (directive), Guardrails (protective, enforced) — that **graduate** across versioned generations, grown from the observability **trace** of real use, human-gated. We **wrap, serve, observe, evolve** a host we never drive.

Built so far (verified): the **observe** layer — host-agnostic trace capture (OTLP/JSON) across **5 real hosts** (Claude Code / Gemini CLI / Codex / OpenCode / pi) + live capture + the guardrails gate, capture+gate parity on all five; the **serve** layer — the `.zuzuu/` faculty home with the full faculty surface (knowledge `remember`/`recall`, the Actions engine, instructions, the session-start `digest`); and the **local evolve loop** — `distill` miners → per-faculty proposals → `review`/`inbox`/`eval` (human-gated) → generation `mint`/`rollback` lockfiles. The *async* evolution service (Cloudflare Workflows) is still design-only. Don't claim unbuilt parts work; don't treat designed parts as absent — check `experiments/LOG.md` for what’s proven.

Naming: the project is **zuzuu** (current name; a return to the original concept) — was **motorsandsensors / mns** in the v0 phase (no `mns` alias remains — all backward-compat was removed). The **command is `zz`** (and `zuzuu`); the npm package is **`@zuzuucodes/cli`** (unscoped `zuzuu` is blocked by npm as too-similar to `zuul`; the `@zuzuucodes` org holds it). Repo: `~/Documents/zuzuu` → `github.com/h1902y/zuzuu`. Releases auto-publish from `main` via OIDC trusted publishing (`.github/workflows/publish.yml`, version-bump-driven).

## Commands

```bash
npm test                                   # full hermetic suite (node:test, zero deps)
node --test tests/unit/ids.test.mjs        # a single test file
npm run playground                         # real-data smoke checks (pass/skip/fail)
node tests/playground/run.mjs 4                  # one playground by number
node bin/zuzuu.mjs <cmd>                   # the CLI (or `zz`/`zuzuu` after npm link)
#   observe: status · capture [--host h] · trace [--last] · enable|disable · doctor
#   serve:   init · code · digest · remember/recall · knowledge · act · explain
#   evolve:  distill · inbox · review · proposals · eval · generation [mint|rollback]
```

No build step, **zero runtime dependencies** (a deliberate policy — `node:test`, `node:sqlite`, hand-rolled OTLP). Node ≥ 22 (OpenCode adapter needs `node:sqlite`; tests need ≥ 21's glob).

## Architecture (the big picture)

**Capture pipeline (host-agnostic by construction):** per-host adapters (`experiments/experiment-1-trace-capture/adapters/*.mjs`) parse each host's on-disk session log → normalized `Event[]` (tree via `refId`/`parentRefId`) → `core/spans.mjs` → OTLP/JSON (`core/otlp.mjs`). The core has **no host conditionals**; ids are **deterministic** (sha256 of host+session / trace+refId) so re-capture is idempotent. Adding a host = one adapter file registered in `adapters/registry.mjs`.

**The `zuzuu` CLI (`zuzuu/`, product surface):** `capture-core.mjs` is the one shared capture path; `store.mjs` is the git-native split (`.zuzuu/sessions.json` index **tracked** + linked to commits; `.traces/`/`.live/` git-ignored). **The home is the HIDDEN `.zuzuu/` dir** (since 2026-06-12 — the `.git` model: transparency via porcelain — `zz status`/`explain`/`digest` — plus plain-text files inside; was the visible `agent/`, migrated via `zz migrate --home`, auto on `init`, gated on `agent/agent.json`). Inside: the 5 faculties as open subdirs + a top-level `README.md` explainer; machine internals dot-prefixed: `.traces`/`.live`/`knowledge/.index.db`. `store.mjs` `homeDir()` resolves the home to `.zuzuu/`. `session.mjs` is the lifecycle state machine (`opening→active→completed|abandoned|crashed`, post-hoc = `captured`). **Live capture is Design B** — hooks/plugins are lifecycle *signals + re-capture triggers*, never span builders: `commands/hook.mjs` maps every host's lifecycle events (Claude `SessionStart/Stop/SessionEnd`, OpenCode `session.created/idle/deleted`, Gemini `SessionStart/AfterAgent/SessionEnd`, Codex, pi) onto one `open/turn/end` path; `live/install.mjs` adds/removes the hook block by `SIGNATURE`, never clobbering user hooks. No host emits a clean end on kill → `doctor` reconciles stale live sessions from the transcript (nothing lost). `scaffold.mjs`/`inject.mjs`/`commands/init.mjs` = the git-style faculty home (three modes: greenfield / brownfield-inject / reinit; idempotent, never clobbers). `guardrails.mjs` + the `PreToolUse` gate = the enforced Guardrails faculty (rules.json, severity deny>ask>allow, fail-open, decisions logged).

**The faculty spine (`zuzuu/faculty/` + per-faculty dirs):** `faculty/contract.mjs` = canonical paths for all 5 faculties (each gets `inbox/` → `proposals/` → `proposals/archive/`); `faculty/proposal.mjs`/`gate.mjs` = the unified proposal record + approve/reject gate (`review` is the interactive ceremony, `proposals` the non-interactive one); `faculty/generation.mjs` = immutable content-addressed lockfiles with snapshot bytes under `.zuzuu/generations/` — rollback = flip the `active` pointer + restore content, never `git revert`. Each faculty dir (`zuzuu/knowledge|memory|actions|instructions|guardrails/`) exposes an `adapter.mjs` to the spine; `knowledge/` also owns items/registry/index (sqlite)/embed; `actions/` owns the manifest + runnable-script runner + audit trail. `miners/` (one per faculty, self-registering) power `distill` — they mine captured sessions into proposals; the guardrails miner is deliberately constrained (ask-only, literal-escaped patterns, cross-session corroboration required). `eval/` ranks pending proposals by a pure mechanical score. `digest.mjs` = the deterministic, zero-network session-start brief (written to `.zuzuu/.live/digest.md` by the SessionStart hook). `commands/code.mjs` = Stage 2: configure + launch the real `opencode` binary as the bundled host (runtime peer, installed on demand — never an npm dep, never forked).

**The method:** `experiments/` (numbered spikes; each README = hypothesis → findings → conclusions) → proven parts harvest into `app/` (be/run/evolve skeleton; nothing harvested yet — CLI imports experiment code in place). `playground/` = app-level smoke vs real machine data; `tests/` = hermetic.

## Hard-won conventions (violating these has bitten us)

- **Real-wire-data rule:** adapters/integrations are built and verified against output the host *actually produced* — never from docs alone, never against self-invented fixtures (that's circular). Observe real events **before** wiring lifecycle semantics (docs lied twice: Claude `Stop` and OpenCode `session.idle` are per-*turn*, not end; OpenCode `session.deleted` is delete-only).
- **Golden ids in regression tests are pasted from a real run** — never hand-computed. If the id scheme changes intentionally, regenerate and review.
- **Playground exit contract:** 0 = pass, **2 = skip** (host data absent — not a failure), anything else = fail. Don't "fix" skips to passes.
- **Hooks/plugins must never break the host:** always exit 0 (`… || true` wrappers, try-wrapped plugin), spawn detached, degrade silently. The guardrails **gate fails open** — engine/rule errors emit no decision (host's normal flow), never a block.
- **Home deny rules are narrow** (`.zuzuu/.traces/`, `.zuzuu/.live/` only) — a blanket `.zuzuu/**` deny starves the agent of its own faculties (which it's meant to read).
- **Secrets:** keys never land in tracked files; scan before commit/push. Generated host-enablement config (`.opencode/`, `.claude/settings*.json`) is git-ignored.
- The `<!-- >>> zuzuu:faculties … -->` block at the bottom of this file is **managed by `zuzuu init`** — don't hand-edit it.

## Load-bearing vocabulary (these terms carry decisions)

- **Faculties — the 5+3 anatomy** (since 2026-06-10): **five us-owned faculties** — Knowledge (semantic), Memory (episodic), Actions (procedural), **Instructions** (directive: the pinned steering/system-prompt artifact), Guardrails (protective: *enforced* tool gates) — each us-owned, trace-grown, generation-pinned, served. **Cognition / Model / Workspace are host *anatomy*, not faculties** (process / engine / arena; observed and steered, never graduated).
- **be / run / evolve**: what the agent *is* / what *serves & bounds* it / what *grows* it.
- **Pin definitions, observe data**: immutable things are *definitions* (prompt, tool version, schema); everything else is runtime captured in traces.
- **Agent → Generation → Run**: durable identity → immutable pinned lockfile (rollback = flip pointer) → transient episode emitting a trace.
- **Proposal**: the bridge from observability to a new generation — **always human-approved in v1**.
- **Design B**: live-capture hooks signal + trigger re-capture through the proven parse path; they never build spans.

## Docs canon

- `README.md` = front door (what works, quickstart). `docs/DESIGN.md` = **canonical design** (was the repo README until 2026-06-10 — older docs/comments citing "README §N" mean DESIGN.md). `experiments/LOG.md` = the **build journal** (all experiment records, one append-only file — append corrections, don’t rewrite history). The **GitHub wiki** = the extended *user guide* (how-tos, host guides, troubleshooting) — it documents **only shipped + verified behavior**, never design intentions (those live in DESIGN). That’s the whole doc set; module knowledge lives in code comments, not READMEs. Wiki source of truth is the wiki git repo (`….wiki.git`).
- `docs/inspiration/` = audit records; they contain intentionally-dead links to pre-consolidation filenames — do **not** recreate those files. Preserve every verified-vs-directional honesty split.
- Older docs say "zuzu/zuzuagents" — expected, not an error. Dates are absolute (`2026-06-09`).
- The personal federation layer (`STATUS.md`, work `tasks/`) lives in **`.personal/` — git-ignored, local-only** (it's planning, not product). The personal vault reads `.personal/STATUS.md`. Social artifacts (`SOCIAL.md`, `engagement/`) moved to the personal vault on 2026-06-12 (de-federation). Note: pre-split copies exist in public git history.

## Key fixed decisions (don't relitigate without cause)

- Evolution engine runtime = **Cloudflare Workflows only** (async evolution loop, never the hot agent loop) · org topology = **strict 1:N tree + mirror aliases** · **interactive-mode-first, never headless** · host integration = **observe model** (entire.io shape), not a driving bridge · Knowledge/Memory substrate = off-edge Postgres/Neon (graph/vector are earned top rungs) · **transcript-parsing is the capture foundation**; hooks are enhancement · product sequence (decided 2026-06-10) = **three stages**: ① host-agnostic wrapper (Claude/Gemini/Codex — building now) → ② OpenCode as **default bundled host** (`zuzuu code` distribution; zuzuu-as-plugin is built) → ③ owned harness on **pi** for granular context/model control, gated on the efficiency benchmark — never an OpenCode fork, never scratch (DESIGN §6; credits model stays a flagged, undecided hypothesis).
- Product experience (decided 2026-06-12, DESIGN §13): the home is **hidden `.zuzuu/`** (reversed the visible-`agent/` decision with cause — clash risk + brownfield clutter; transparency = porcelain: `zz status`/`explain`/`digest` + plain-text files + the human gate, the `.git` model) · six workstreams in dependency order (home/onboarding → workbench → faculty-health UX → marketplace templates → tasks faculty → benchmark) · the workbench middle pane = **embedded terminal** (xterm.js running the real host CLI), never a custom chat loop · **zuzuu-web evolves into the workbench** (one web surface) · positioning = AI-first directory for *any* folder-based work, coding is the first vertical · philosophy = **enhance, never reinvent**.

## Social

**Social is managed from the personal vault** (`~/Documents/personal` — de-federated 2026-06-12; this repo no longer owns the X channel's strategy or state). The vault's social handler reads this repo **read-only** as a content source for build-in-public posts: `README.md`, `experiments/LOG.md`, `docs/DESIGN.md`, and the git log — **keep those current; they're what gets posted about.** Build-log discipline still applies: only what actually shipped, verified. Don't do social work (drafting, posting, engagement) from this repo.

## Tasks

This project owns its **work** activities in [`.personal/tasks/`](.personal/tasks/) — multi-day work units as `type: activity` markdown notes (checkboxes for steps, `relations: depends-on` for dependencies). Current: `ai-agent-harness`, `zuzuu-landing-page`. (The social activity `twitter-profile-growth` was repatriated to `~/Documents/personal/tasks/` on 2026-06-12.)

- Activity templates live at `~/Documents/personal/tasks/.schema/templates/` (canonical) — mirror that shape when creating a new task here.
- When task state changes materially, reflect the headline in [`.personal/STATUS.md`](.personal/STATUS.md) (slim, work-only: Focus now / Shipped recently / Blockers / Next up) so the personal vault's dashboard stays current — that's the only cross-repo obligation.
- Some tasks carry `[[wikilinks]]` to notes that live in the personal vault; those are cross-repo and won't resolve in Obsidian — leave them as references.

<!-- >>> zuzuu:faculties:v9 >>> -->
## zuzuu — agent faculty home

This project has a zuzuu faculty home at `.zuzuu/` (managed by the zuzuu CLI). Work to this contract:

- **Ground.** At session start, read `.zuzuu/.live/digest.md` if it exists — your *zuzuu digest* (instructions, knowledge, actions, proposals, guardrails), regenerated each session. Trust it as ground truth; don't re-derive what it states or re-read faculty files it already summarized. (On Claude Code the same brief also arrives inline at session start.)
- **Cite in-flight.** When an answer draws on a stored fact, say `from knowledge: <id>`; when you follow a runbook/action, name it. Make the faculty visible.
- **Harvest at close.** Before ending, propose durable learnings as one-fact files in `.zuzuu/knowledge/inbox/` (plain text is fine), and propose any reusable procedure with `zuzuu act propose <slug>` (it lands in `actions/inbox/`). A human reviews both via `zuzuu review`. Never write `knowledge/items/` or active `actions/` directly.
- **Respect `.zuzuu/guardrails/`** — hard rules, *enforced* on tool calls by the zuzuu gate; a refusal there is policy, not preference.
- Do **not** read `.zuzuu/.traces/` or `.zuzuu/.live/` (zuzuu observability internals) — **except `.zuzuu/.live/digest.md`, which is written for you.**
<!-- <<< zuzuu:faculties <<< -->
