# Spec 1 — The mns Session Contract (Stage-1 experience, Claude Code verified tier)

**Date:** 2026-06-10
**Status:** approved design → ready for implementation plan
**Sequence:** Spec 1 of 2 (Spec 2 = the Actions Engine, `2026-06-10-mns-actions-engine-design.md`). The two meet at exactly one seam: the digest's Actions index.

## Goal

Make every Claude Code session in an mns project **open grounded, work cited, and close harvested** — an opinionated, observable session contract — built on Claude Code's official `SessionStart`/`PreToolUse` hooks, and designed host-agnostic so Gemini/Codex/OpenCode/pi become delivery tiers later.

This is the **experience layer over the five faculties that already exist** (Knowledge, Memory, Actions, Instructions, Guardrails). No new faculties. Three new pieces plus polish:

1. `mns digest` — the computation (host-agnostic).
2. `SessionStart` digest injection — the delivery (Claude Code verified tier).
3. Faculty block v4 — the contract text.
4. First-run + edge-state polish.

## Why now / positioning

This slice is the efficiency thesis (DESIGN §2 efficiency corollary) in miniature: a workspace that grounds the agent deterministically — instead of letting it re-derive context every session — does the same work with fewer tokens. The digest's token cost is a number **we control and report**; the observe layer verifies sessions actually start grounded. Stage-1 ("host-agnostic wrapper", DESIGN §6 three-stage sequence) is the current build focus; Claude Code is the first **verified** delivery tier.

## Host-mechanism grounding (June 2026 survey)

Confirmed official mechanisms the design rides:
- **Claude Code:** `SessionStart` hook emits `{ "hookSpecificOutput": { "hookEventName": "SessionStart", "additionalContext": "<text>" } }` — the injection point. `PreToolUse` gate already built + live-fire-proven (exp-8). ≤4KB advisory budget for `additionalContext`.
- **Convergence:** the faculty block already flows into `CLAUDE.md` / `AGENTS.md` / `GEMINI.md` (mns init injects all three), so the contract text is host-portable before other hosts' hooks are wired.
- **Other hosts (designed-for, not built here):** Gemini CLI (11-event hook system incl. SessionStart/BeforeTool), Codex (SessionStart/PreToolUse hooks + `systemMessage` injection), OpenCode (`instructions` array + `chat.system.transform`), pi (`before_agent_start` returns systemPrompt). All four can deliver the same digest — but each needs its hook surface **observed before wiring** (real-wire-data rule; docs have lied twice). Separate experiment.

---

## Component 1 — `mns digest`

A new **pure, deterministic, zero-network, no-model** command:

```
mns digest [--json] [--budget N]
```

Reads the faculty home and emits a compact, token-budgeted grounding brief. It is the single source the hook injects, and is independently runnable (a human, or a hookless host, sees exactly what the agent sees).

### Contents, in priority order (truncated to budget, default ~1500 tokens)

1. **Instructions state** — the active `instructions/project.md` steering. **If it is still the bare placeholder**, inject the **interview directive** instead: *"Project steering is empty. Before substantive work, interview your human (what is this project, conventions, priorities), draft `.mns/instructions/project.md`, and get their approval."* (This is the agent-led onboarding decision — empty `.mns` becomes a conversation the agent starts, not a dead placeholder.)
2. **Knowledge** — count + top-N items by a cheap salience heuristic (recently-created + most-related), each as `id · type · one-line`. Via `allItems()` (mns/knowledge/items.mjs). No model call.
3. **Actions index** — `slug · promptSnippet` per available action (the seam to Spec 2). In this spec, renders whatever the Actions lister returns; empty until Spec 2 lands. Progressive disclosure: index only, never bodies.
4. **Proposals pending** — count + "remind the human to run `mns review`" when > 0. Via `listProposals()` (mns/knowledge/proposals.mjs).
5. **Guardrails** — active rule count + one-line "enforced gate is on". Via `loadRules()` (mns/guardrails.mjs). So the agent knows refusals are policy, not whim.
6. **Identity line** — project name + faculty-home version (forward hook for generation-pinning).

### Contract

- **Pure / deterministic / fast:** no network, no model, no `Date.now()`-dependent output beyond a passed-in clock. Reuses existing read APIs — **no new storage**.
- **Budget:** `--budget` token cap (default ~1500, well under the 4KB advisory). Truncation is deterministic and priority-ordered (instructions + guardrails never dropped; knowledge/actions lists truncate first).
- **`--json`** for programmatic riders; default human-readable.
- **Salience heuristic** is intentionally cheap and explainable (no embeddings on the hot path); semantic ranking is a later rung.

---

## Component 2 — `SessionStart` digest injection (Claude Code tier)

`mns hook SessionStart` currently only opens the live record and captures (mns/commands/hook.mjs `handleHook`). Add: it **also** computes the digest and emits Claude Code's documented shape on stdout:

```json
{ "hookSpecificOutput": { "hookEventName": "SessionStart", "additionalContext": "<mns digest text>" } }
```

### Discipline preserved (non-negotiable)

- **Always exit 0, fail-open.** Any digest error → emit **no** `additionalContext` (session proceeds normally, never broken) — exactly the guardrails gate's silence-on-error pattern.
- **Budget-capped** (~1500 tokens) so grounding never crowds the task.
- **Only this one mechanism changes.** The existing capture/lifecycle path (openLive/touchLive/closeLive + safeCapture) is untouched; the digest is additive on the same `SessionStart` event.
- The digest emission and the live-record/capture side-effects must not interfere: capture failures must not suppress the digest, and digest failures must not suppress capture.

---

## Component 3 — Faculty block v4 (the contract, not a directory listing)

Today's block (v3) says "read these directories." v4 rewrites it as the **three-ritual contract**, leaning on the digest so steering text shrinks:

- **Ground** — "At session start you'll receive an mns digest. Trust it as ground truth; don't re-derive what it states or re-read faculty files it already summarized."
- **Cite in-flight** — "When an answer draws on knowledge, say `from knowledge: <id>`; when you follow a runbook/action, name it. Make the faculty visible."
- **Harvest at close** — "Before ending, propose durable learnings as one-fact files in `knowledge/inbox/` (never write `items/`). A human reviews via `mns review`."

### Delivery

- Ships via the **existing version-aware re-injection** (exp-6 machinery): v3 blocks upgrade in place on next `mns init`/scaffold, **no clobber**, idempotent.
- Same block text flows into `CLAUDE.md`/`AGENTS.md`/`GEMINI.md` by the convergence above — contract is host-portable immediately.
- Markers: the managed `<!-- >>> mns:faculties:v4 >>> -->` … `<!-- <<< mns:faculties <<< -->` block (bump v3→v4).

---

## Component 4 — First-run & edge-state polish

Paper cuts found walking a fresh `mns init` (verified 2026-06-10):

- **`doctor`:** "not a git repo" shown as ⚠ then "all good" prints under warnings. Reclassify the git-absence as neutral info (capture still works), and **don't print "all good" when warnings exist**.
- **`recall` empty state:** `(no matches — try mns knowledge reindex?)` is misleading when there are simply **no items**. Distinguish "no items yet" (point at `mns remember`) from "no matches for query."
- **`status`:** leads with machine-wide host-session counts (e.g. 1100 Claude sessions) before "0 recorded here." **Lead with this project**, push the machine inventory below.
- **`init` greenfield "next" steps:** add the digest to the mental model — "start your agent; it opens grounded."

---

## Testing

- **`mns digest` unit tests:** empty home → interview directive present; populated home → items/proposals/guardrails/actions reflected; budget truncation deterministic + priority-ordered; `--json` schema stable.
- **`SessionStart` hook tests:** digest present in `additionalContext` on success; **silence on injected error (fail-open)**; exit 0 always; capture side-effects still occur when digest succeeds *and* when it fails (independence). Same regression discipline as the gate (exp-6/8).
- **Block v4 upgrade tests:** v3→v4 in-place, idempotent, no clobber (extend exp-6 tests).
- **Polish tests:** doctor (no "all good" under warnings; git-absence neutral), status (project-first ordering), recall (no-items vs no-matches) empty-state assertions.
- **Dogfood measurement:** capture a real grounded session in a scratch project; confirm via the trace it started with the digest; record the digest's token cost (the efficiency-thesis number).

## Explicitly NOT in this slice (YAGNI)

- **SessionEnd auto-distill** — harvest stays steering-led here; mechanical close-out is the next slice after Spec 2 (was "approach B"). Queued, not built.
- **`mns brief` / PM management surface** — the layer over the foundation; deferred per the product sequencing.
- **Other-host digest delivery** (Gemini/Codex/OpenCode/pi) — designed-for (digest is host-agnostic) but each needs its hook surface observed first. Separate experiment.
- **Substrate format changes** (JSON→JSONL/Markdown) — recorded as proposals as they surface; not built here.

## Appendix — substrate proposals surfaced by this exercise

(Design notes, not built in this spec — candidates for the human gate / future generations.)

- **Actions = SKILL.md cross-host standard** for the runbook kind (survey finding: Claude/Gemini/Codex/pi all consume SKILL.md). → fully designed in Spec 2.
- **Active vs available faculty subset** (pi's `getAllTools()` vs `setActiveTools()`) — the digest could surface only a trace-relevant subset of knowledge/actions rather than top-N. Forward hook.
