# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

**A working early-stage build + its canonical design.** The host coding-agent (Claude Code / Codex / Gemini CLI / OpenCode) supplies the **brain**; this project gives it evolving **faculties** — Knowledge (semantic), Memory (episodic), Actions (procedural), Instructions (directive), Guardrails (protective, enforced) — that **graduate** across versioned generations, grown from the observability **trace** of real use, human-gated. We **wrap, serve, observe, evolve** a host we never drive.

Built so far (verified): the **observe** layer — host-agnostic trace capture (OTLP/JSON) across 4 real hosts + the `zuzuu` CLI + live capture — and the first **serve** slice (`zuzuu init` faculty home). The **evolve** engine is design-only. Don't claim unbuilt parts work; don't treat designed parts as absent — check `experiments/LOG.md` for what’s proven.

Naming: the project is **zuzuu** (current name; a return to the original concept) — was **motorsandsensors / mns** in the v0 phase. The CLI is `zuzuu` (package `zuzuu`, v1.0.0); `mns` stays as a legacy alias.

## Commands

```bash
npm test                                   # full hermetic suite (node:test, zero deps)
node --test tests/unit/ids.test.mjs        # a single test file
npm run playground                         # real-data smoke checks (pass/skip/fail)
node tests/playground/run.mjs 4                  # one playground by number
node bin/zuzuu.mjs <cmd>                   # the CLI (or `zuzuu`/`mns` after npm link)
#   init · status · capture [--host h] · trace [--last] · enable|disable [--host opencode] · doctor
```

No build step, **zero runtime dependencies** (a deliberate policy — `node:test`, `node:sqlite`, hand-rolled OTLP). Node ≥ 22 (OpenCode adapter needs `node:sqlite`; tests need ≥ 21's glob).

## Architecture (the big picture)

**Capture pipeline (host-agnostic by construction):** per-host adapters (`experiments/experiment-1-trace-capture/adapters/*.mjs`) parse each host's on-disk session log → normalized `Event[]` (tree via `refId`/`parentRefId`) → `core/spans.mjs` → OTLP/JSON (`core/otlp.mjs`). The core has **no host conditionals**; ids are **deterministic** (sha256 of host+session / trace+refId) so re-capture is idempotent. Adding a host = one adapter file registered in `adapters/registry.mjs`.

**The `zuzuu` CLI (`mns/`, product surface):** `capture-core.mjs` is the one shared capture path; `store.mjs` is the git-native split (`agent/sessions.json` index **tracked** + linked to commits; `.traces/`/`.live/` git-ignored). **The home is the VISIBLE `agent/` dir** (the 5 faculties as open subdirs + a top-level `agent/README.md` explainer; machine internals dot-prefixed: `.traces`/`.live`/`knowledge/.index.db`). `store.mjs` `homeDir()` resolves `agent/` → legacy `.mns/` → default `agent/`; `zuzuu migrate --home` + `zuzuu init` migrate legacy projects. `session.mjs` is the lifecycle state machine (`opening→active→completed|abandoned|crashed`, post-hoc = `captured`). **Live capture is Design B** — hooks/plugins are lifecycle *signals + re-capture triggers*, never span builders: `commands/hook.mjs` maps Claude's `SessionStart/Stop/SessionEnd` and OpenCode's `session.created/idle/deleted` onto one `open/turn/end` path. No host emits a clean end on kill → `doctor` reconciles stale live sessions from the transcript (nothing lost). `scaffold.mjs`/`inject.mjs`/`commands/init.mjs` = the git-style faculty home (three modes: greenfield / brownfield-inject / reinit; idempotent, never clobbers). `guardrails.mjs` + the `PreToolUse` gate = the enforced Guardrails faculty (rules.json, severity deny>ask>allow, fail-open, decisions logged).

**The method:** `experiments/` (numbered spikes; each README = hypothesis → findings → conclusions) → proven parts harvest into `app/` (be/run/evolve skeleton; nothing harvested yet — CLI imports experiment code in place). `playground/` = app-level smoke vs real machine data; `tests/` = hermetic.

## Hard-won conventions (violating these has bitten us)

- **Real-wire-data rule:** adapters/integrations are built and verified against output the host *actually produced* — never from docs alone, never against self-invented fixtures (that's circular). Observe real events **before** wiring lifecycle semantics (docs lied twice: Claude `Stop` and OpenCode `session.idle` are per-*turn*, not end; OpenCode `session.deleted` is delete-only).
- **Golden ids in regression tests are pasted from a real run** — never hand-computed. If the id scheme changes intentionally, regenerate and review.
- **Playground exit contract:** 0 = pass, **2 = skip** (host data absent — not a failure), anything else = fail. Don't "fix" skips to passes.
- **Hooks/plugins must never break the host:** always exit 0 (`… || true` wrappers, try-wrapped plugin), spawn detached, degrade silently. The guardrails **gate fails open** — engine/rule errors emit no decision (host's normal flow), never a block.
- **Home deny rules are narrow** (`agent/.traces/`, `agent/.live/` only) — a blanket `agent/**` deny starves the agent of its own faculties (which it's meant to read).
- **Secrets:** keys never land in tracked files; scan before commit/push. Generated host-enablement config (`.opencode/`, `.claude/settings*.json`) is git-ignored.
- The `<!-- >>> mns:faculties … -->` block at the bottom of this file is **managed by `mns init`** — don't hand-edit it.

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
- The personal/marketing federation layer (`STATUS.md`, `SOCIAL.md`, `tasks/`, `engagement/`) lives in **`.personal/` — git-ignored, local-only** (it's strategy/targets, not product). The personal vault reads it at `.personal/` (contract updated 2026-06-10). Note: pre-split copies exist in public git history.

## Key fixed decisions (don't relitigate without cause)

- Evolution engine runtime = **Cloudflare Workflows only** (async evolution loop, never the hot agent loop) · org topology = **strict 1:N tree + mirror aliases** · **interactive-mode-first, never headless** · host integration = **observe model** (entire.io shape), not a driving bridge · Knowledge/Memory substrate = off-edge Postgres/Neon (graph/vector are earned top rungs) · **transcript-parsing is the capture foundation**; hooks are enhancement · product sequence (decided 2026-06-10) = **three stages**: ① host-agnostic wrapper (Claude/Gemini/Codex — building now) → ② OpenCode as **default bundled host** (`zuzuu code` distribution; zuzuu-as-plugin is built) → ③ owned harness on **pi** for granular context/model control, gated on the efficiency benchmark — never an OpenCode fork, never scratch (DESIGN §6; credits model stays a flagged, undecided hypothesis).

## Social

**This project owns the X / Twitter channel (`@h1902y`).** X is the *builder* surface — build-in-public of this harness under the "zuzuu" brand. The work shown here is the content; an employer who sees the LinkedIn practitioner then checks X and sees someone who actually builds.

- **Read [`.personal/SOCIAL.md`](.personal/SOCIAL.md) before doing any social work here** — pillars (50% build-log / 30% lessons / 20% reactions), the reply-first daily cadence + Thu/Sun threads.
- Real code ships now (since 2026-06-09) — build-log posts show *actual shipped work*; the standing discipline is the reverse: show only what actually shipped, verified.
- **Report up:** keep `.personal/STATUS.md` current (what was decided/shipped, what's queued for X, blockers). The personal vault (`~/Documents/personal`) aggregates status and owns the cross-channel strategy (`personal/social-channel-architecture.md`) — sync to it, don't duplicate.

## Tasks

This project owns its activities in [`.personal/tasks/`](.personal/tasks/) — multi-day work units as `type: activity` markdown notes (checkboxes for steps, `relations: depends-on` for dependencies). Migrated from the personal vault on 2026-06-09 (federation). Current: `ai-agent-harness`, `twitter-profile-growth` (the X growth plan; its `h1902y` handle-procurement sub-list is personal-identity-layer, kept here as a sub-section).

- Activity templates live at `~/Documents/personal/tasks/.schema/templates/` (canonical) — mirror that shape when creating a new task here.
- When task state changes materially, reflect the headline in [`.personal/STATUS.md`](.personal/STATUS.md) so the personal vault's dashboard stays current — that's the only cross-repo obligation.
- Some migrated tasks carry `[[wikilinks]]` to notes that stayed in the personal vault; those are cross-repo and won't resolve in Obsidian — leave them as references.

<!-- >>> zuzuu:faculties:v8 >>> -->
## zuzuu — agent faculty home

This project has a zuzuu faculty home at `agent/` (managed by the zuzuu CLI; `mns` is a legacy alias). Work to this contract:

- **Ground.** At session start, read `agent/.live/digest.md` if it exists — your *zuzuu digest* (instructions, knowledge, actions, proposals, guardrails), regenerated each session. Trust it as ground truth; don't re-derive what it states or re-read faculty files it already summarized. (On Claude Code the same brief also arrives inline at session start.)
- **Cite in-flight.** When an answer draws on a stored fact, say `from knowledge: <id>`; when you follow a runbook/action, name it. Make the faculty visible.
- **Harvest at close.** Before ending, propose durable learnings as one-fact files in `agent/knowledge/inbox/` (plain text is fine), and propose any reusable procedure with `zuzuu act propose <slug>` (it lands in `actions/inbox/`). A human reviews both via `zuzuu review`. Never write `knowledge/items/` or active `actions/` directly.
- **Respect `agent/guardrails/`** — hard rules, *enforced* on tool calls by the zuzuu gate; a refusal there is policy, not preference.
- Do **not** read `agent/.traces/` or `agent/.live/` (zuzuu observability internals) — **except `agent/.live/digest.md`, which is written for you.**
<!-- <<< zuzuu:faculties <<< -->
