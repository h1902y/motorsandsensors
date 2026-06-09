# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

**A design + research repository — not an application.** As of now there is **no code, no build system, no tests, nothing scaffolded**. It is Markdown only: a consolidated design and the audits/surveys it stands on. Treat "solved memory / tools / runtime" in the docs as *solved on paper*. Do not invent build/lint/test commands — there are none to run.

Structure:
- `README.md` — the **canonical single-file overview** of the project (what/why/architecture/decisions). It supersedes and consolidates an earlier set of concept docs. Start here; it is the entry point.
- `inspiration/` — the **reference shelf**: one 100-project field survey (`agent-harness-survey.md`) plus five source-level audits (entire.io host-adapter, Claude Code pricing, model/provider agnosticity, supermemory/smfs, terminal-first runtime). Depth lives here; `README.md` is the synthesis.

## The project in one line

The host coding-agent (Claude Code / Codex / Gemini CLI) supplies the **brain** (reasoning loop + model). This project gives that agent an evolving **Memory, Knowledge, Actions, and Guardrails** — "faculties" that **graduate** across versioned **generations**, grown from the observability **trace** of real use, human-gated. We **wrap, serve, observe, and evolve** a host we do not run; we never drive the host headlessly.

## Load-bearing vocabulary (use these terms exactly — they carry decisions)

- **Faculties**: Memory (episodic), Knowledge (semantic), Actions (procedural/tools), Guardrails (membrane) — the parts *we* own and grow. Cognition, Model, Workspace are **host-owned** (we observe, never graduate). Note the rename: **Knowledge = semantic, Memory = episodic** (older docs called the semantic faculty "Memory").
- **be / run / evolve**: the architectural split — what the agent *is* (faculties) vs what *runs & bounds* it (runtime) vs what *grows* it (evolution engine).
- **The two axes** (never fuse them): **Substrate** = *how* a faculty is implemented (operator-*set* tier) vs **Contents/capability** = *what* it accumulated (trace-*earned* promotion).
- **Pin definitions, observe data**: the backbone principle. Immutable/versioned things are *definitions* (prompt, model, tool version, schema); everything else is *runtime* captured in traces. This dissolves "snapshot/replay the run state."
- **Entity model**: **Agent** (durable employee, not a script) → **Generation** (immutable pinned lockfile; rollback = flip the `isActive` pointer) → **Run/Episode** (transient, emits a trace).
- **Proposal**: the first-class bridge from observability to a new generation; human approves it async/out-of-band in an inbox. **Auto-crystallization is deliberately cut from v1** — the async human gate *is* the safety boundary.
- **Trace**: typed, append-only, tree-shaped record of a run. The keystone artifact — *build first*. The host-adapter's normalized `Event` is its basis.

## Conventions when editing these docs

- **`README.md` is canonical.** When the design changes, update `README.md`; keep `inspiration/` as audit records. Note the `inspiration/` docs contain cross-links to pre-consolidation filenames (e.g. `../agentic-platform-concept.md`, `../agent-foundation-primitives.md`) that no longer exist as separate files — their content now lives in `README.md`. Do not "fix" these by recreating those files; the consolidation was intentional.
- **Preserve the verified-vs-directional split.** Several audits explicitly separate *verified* facts from *directional/unverified* leads (notably the pricing audit's numbers and the late-2025/2026 preprint citations). Do not promote unverified leads to authoritative claims, and do not strip the honesty flags.
- **Naming.** The project was previously **zuzuagents** (product concept *zuzu*); it is being renamed **motorsandsensors**. Older docs still say "zuzu/zuzuagents" — that is expected, not an error to mass-rename. Sibling projects keep their names: **Zuzucodes Labs**, **Flow Engine**, **Notes** (the three lineages being merged).
- Dates in this repo are written absolute (e.g. `2026-06-08`), matching the doc status lines.

## Key fixed decisions (don't relitigate without cause)

These were converged across multiple sessions; treat them as settled unless explicitly revisiting:
- Engine runtime = **Cloudflare Workflows only** (`waitForEvent` for human/A2A gates); Workflows runs **only the async evolution loop**, not the hot agent loop.
- Org topology = **strict 1:N tree + mirror aliases**, *not* an arbitrary DAG. M:N is for faculty *sharing*, not delegation.
- **Interactive-mode-first** (never headless) — a product pillar grounded in Claude Code pricing + the fact that hooks/MCP/CLAUDE.md/skills only fully work interactively.
- Host integration is an **observe** model (entire.io's adapter shape), *not* a `run()`/`stream()` driving bridge.
- Knowledge/Memory substrate = off-edge Postgres/Neon (AGE/pgvector are opt-in top rungs, "prove-it" before betting the hot path).

## Social

**This project owns the X / Twitter channel (`@h1902y`).** X is the *builder* surface — build-in-public of this harness under the "motors & sensors" brand. The work shown here is the content; an employer who sees the LinkedIn practitioner then checks X and sees someone who actually builds.

- **Read [`SOCIAL.md`](SOCIAL.md) before doing any social work here** — pillars (50% build-log / 30% lessons / 20% reactions), the reply-first daily cadence + Thu/Sun threads, and the design-stage caveat (post the *thinking in public*, don't fake shipped code).
- This is design-stage (docs only, no code yet) — so build-log content right now = decisions, architecture, and the audits/survey. The pinned anchor thread already does this.
- **Report up:** keep `STATUS.md` current (what was decided/shipped, what's queued for X, blockers). The personal vault (`~/Documents/personal`) aggregates status and owns the cross-channel strategy (`personal/social-channel-architecture.md`) — sync to it, don't duplicate.

## Tasks

This project owns its activities in [`tasks/`](tasks/) — multi-day work units as `type: activity` markdown notes (checkboxes for steps, `relations: depends-on` for dependencies). Migrated from the personal vault on 2026-06-09 (federation). Current: `ai-agent-harness`, `twitter-profile-growth` (the X growth plan; its `h1902y` handle-procurement sub-list is personal-identity-layer, kept here as a sub-section).

- Activity templates live at `~/Documents/personal/tasks/.schema/templates/` (canonical) — mirror that shape when creating a new task here.
- When task state changes materially, reflect the headline in [`STATUS.md`](STATUS.md) so the personal vault's dashboard stays current — that's the only cross-repo obligation.
- Some migrated tasks carry `[[wikilinks]]` to notes that stayed in the personal vault; those are cross-repo and won't resolve in Obsidian — leave them as references.

<!-- >>> mns:faculties:v1 >>> -->
## mns — agent faculty home

This project has an mns faculty home at `.mns/` (managed by the mns CLI):

- **Read `.mns/knowledge/`** — verified project facts/entities. Treat as ground truth.
- **Follow `.mns/instructions/`** — project steering (`project.md`) and rules (`guardrails.md`).
- **Use `.mns/actions/`** — named procedures/runbooks for this project.
- **Record durable, verified learnings** in `.mns/knowledge/` (facts only, no speculation).
- Do **not** read `.mns/traces/` or `.mns/live/` (mns observability internals).
<!-- <<< mns:faculties <<< -->
