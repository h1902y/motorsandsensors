# Spec — Gemini CLI + Codex: live capture + the guardrails gate

**Date:** 2026-06-10
**Status:** approved design → Phase 0 (observe) next, then the Phase 1 plan
**Stage:** the Stage-1 wrapper gap (DESIGN §6 three-stage sequence). Post-hoc transcript capture already works for all four hosts; **live** capture + the **gate** exist only for Claude Code + OpenCode. This wires the remaining two.

## Goal

Bring Gemini CLI and Codex up to live-capture + guardrails-gate parity with Claude Code and OpenCode — `mns enable --host gemini-cli` / `--host codex` installs the host's native lifecycle + pre-tool hooks, so capture is invisible and the gate enforces `rules.json` on tool calls. Ship **per-host whatever actually verifies**; record honestly what a host's surface can't support.

## The governing constraint — the real-wire-data rule

This is the load-bearing convention here (CLAUDE.md): adapters/hooks are built against output the host *actually produced*, never from docs (the docs lied twice — Claude `Stop` and OpenCode `session.idle` are per-*turn* not end; OpenCode `session.deleted` is delete-only). The June-2026 host-mechanism survey of Gemini/Codex hooks was **docs-only**. Therefore:

> **No event mapping, payload parsing, or gate-decision code is written from docs.** Phase 0 captures the real payloads first; Phase 1 is written from those captures.

This is why the exact event names, payload field paths, and block-response schema are marked **"from Phase 0"** below — that deferral is the correct application of the rule, not an unresolved placeholder.

## Existing pattern this mirrors (do not reinvent)

- `mns enable` (`mns/commands/enable.mjs`): Claude → writes hooks into `.claude/settings.json` via `addHooks` (`mns/live/install.mjs`); OpenCode → writes a project plugin `.opencode/plugin/mns.js`. Each fires `node <bin> hook <event> [--host h] [--session id] || true` (graceful: always exit 0).
- `mns/commands/hook.mjs`: `runHook(event, {host, session})` dispatches. `handleHook` maps event sets `OPEN`/`TURN`/`END` onto `openLive`/`touchLive`/`closeLive` + `safeCapture` (Design B — the hook re-captures the transcript through the proven adapter; it never builds spans). `gateToolUse` evaluates `.mns/guardrails/rules.json` and emits Claude's `hookSpecificOutput` decision (fail-open: silence on any error).
- Adapters (`experiments/experiment-1-trace-capture/adapters/{gemini-cli,codex}.mjs`): post-hoc parse of `~/.gemini/tmp/<proj>/logs.json` (thin: prompts only) and `~/.codex/sessions/.../rollout-*.jsonl` (rich: turns + tool calls, Claude-like). Both real-data-verified.

## Architecture — Design B, unchanged

Hooks are **lifecycle signals + re-capture triggers**, never span builders. The capture work is the existing `captureTrace` via the existing adapters. So live capture for a new host = (a) install its hooks, (b) map its event names onto `open/turn/end`, (c) parse its payload for the session id / transcript ref. The gate adds (d) a per-host decision serializer over the host-agnostic `evaluate()`.

---

## Phase 0 — Observe (fully specified; prerequisite to Phase 1)

### The probe

A throwaway script `mns/live/probe.mjs` (kept after, it's a dev/observe tool) whose only job is to record exactly what a host hands a hook:

```
node probe.mjs <host> <event>   # appends one JSON line to .mns/live/probe-<host>.jsonl
```
Each line: `{ at, host, event, argv: process.argv.slice(2), stdin: <raw stdin or null>, cwd }`. It reads stdin non-blocking (fd 0), never throws, always exits 0 (must not disturb the host session).

### Installing the probe (repo-local only)

A scratch project (fresh temp dir, `mns init`), into which I install probe hooks for **every candidate event** in each host's native config — **repo-local config only**, never the user's global `~/.gemini` / `~/.codex`:
- **Gemini:** project `./.gemini/settings.json` `hooks` block (candidate events from the survey: SessionStart, SessionEnd, BeforeAgent, AfterAgent, BeforeTool, AfterTool, Notification, Stop — install all that the schema accepts; the probe reveals which actually fire).
- **Codex:** repo `./.codex/hooks.json` (candidate events: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop, etc.).

If a host rejects repo-local hook config (only honors global), that is itself a Phase-0 finding — fall back to a clearly-labeled temporary global install that is removed immediately after capture, with the user's confirmation.

### The capture run (user-driven, exp-8 pattern)

The user runs **one real Gemini session** and **one real Codex session** in the scratch project: open it, issue a prompt that triggers at least one tool call (so a pre-tool event fires), then exit normally (so any end signal fires). I do not drive these — interactive-first is canon, and the captures must be from real use.

### Phase-0 deliverables (what gates Phase 1)

From `.mns/live/probe-<host>.jsonl`, for each host, a recorded finding:
1. **Which events actually fire** (and at what lifecycle moment — start vs per-turn vs end; docs have been wrong on exactly this).
2. **Transport** — does the host pass data via argv, stdin JSON, or both?
3. **Payload shape** — the session id field, the transcript/rollout path field, and (for the pre-tool event) the tool name + tool input fields the gate must match on.
4. **Block schema** — what a hook must emit (stdout JSON shape and/or exit code) to DENY a tool call. If undiscoverable from the probe (the probe only allows), a second minimal probe that emits a candidate block response verifies it.
5. **End-signal reality** — does a clean end fire, or must we reconcile via staleness (`mns doctor`) as with Claude/OpenCode?

These captures are committed as **golden fixtures** (real-wire, pasted from real runs — per the golden-ids convention) and are the substrate the Phase-1 tests assert against.

---

## Phase 1 — Wire (shape specified; specifics from Phase-0 captures)

Three seams, each per-host, written from the captures:

### 1. Enable installers (`mns/live/install.mjs` + `mns/commands/enable.mjs`)

- `mns enable --host gemini-cli` → write the Gemini hook config (settings.json `hooks` block, shape from Phase 0) tagging entries by a stable signature (mirroring the Claude `SIGNATURE` approach so `disable` removes only ours, never the user's hooks). Decide install scope (project `./.gemini/settings.json` is preferred; global only if Phase 0 proves project-level doesn't fire).
- `mns enable --host codex` → write the Codex hook config (`hooks.json` / `config.toml`, shape from Phase 0), same tag-and-remove discipline.
- `disable` symmetry for both. Each hook command keeps the `|| true` graceful wrapper.
- Generated host-enablement config stays **git-ignored** (the existing secrets/`.gitignore` convention covers `.opencode/`, `.claude/settings*.json`; add the Gemini/Codex equivalents).

### 2. Event mapping (`mns/commands/hook.mjs`)

- Add the real Gemini/Codex event names (from Phase 0) to the `OPEN` / `TURN` / `END` sets so they route through the existing `handleHook` → `captureTrace` path. No new span building.
- `runHook` payload parsing: today it reads stdin JSON for `claude-code` and uses `--session` for `opencode`. Add per-host parsing for however Gemini/Codex actually deliver the payload (from Phase 0) → extract `session_id` and the transcript/rollout ref the adapter needs.
- If a host has no clean end signal (likely), rely on the existing staleness reconciliation in `mns doctor` — no new mechanism.

### 3. The gate (`mns/commands/hook.mjs` `gateToolUse` + a per-host serializer)

- `loadRules` + `evaluate` are host-agnostic and unchanged. The verdict (`deny|ask|allow` + reason) is the same.
- Add a **per-host decision serializer**: Claude → the existing `hookSpecificOutput` JSON; Gemini/Codex → their real block schema (stdout JSON and/or exit code, from Phase 0). Extract the tool name + input to match on from each host's pre-tool payload.
- Decisions still append to `.mns/live/guardrails-<session>.jsonl` (the existing trail). Fail-open everywhere (engine/rule errors → no decision, host's normal flow).

### Honest-outcome handling

Ship per-host whatever verifies:
- If a host fires a usable pre-tool event with a block schema → wire the gate.
- If not (e.g. Gemini's surface proves capture-only) → ship **live capture only** for that host and record the gap in `experiments/LOG.md` and the host's adapter comment. CLAUDE.md already anticipates "thinner on Codex/Gemini" — this makes the line precise per host. **No gate is shipped that the host won't actually honor.**

---

## Testing

- **Golden fixtures:** the Phase-0 `probe-<host>.jsonl` captures (real-wire). Regression tests assert the event mapping + payload parsing against these exact captures.
- **Unit:** `addHooks`/`removeHooks` (or per-host equivalents) produce the correct native config shape and remove only mns's entries (idempotent, no-clobber) — asserted against the real config format; event-set membership (real names → open/turn/end); per-host gate decision serializer emits the real block schema; fail-open (malformed rules → no decision); hook always exits 0.
- **Dogfood (user-driven, exp-8 pattern):** `mns enable --host gemini-cli` and `--host codex` on real sessions → confirm a live session record lands in `.mns/sessions.json` via the hook (not just post-hoc `mns capture`), and that a seeded guardrail rule blocks a tool call where the host supports it. Record the result (including any host that ships capture-only) in the LOG.

## Explicitly NOT in scope (YAGNI)

- Rich tool-span capture for Gemini (its `logs.json` is prompt-only; tool calls live in checkpoint files — a separate capture-depth rung, not this slice).
- Context injection at session start for Gemini/Codex (the digest delivery tier — a separate slice; this spec is capture + gate only).
- Any change to the host-agnostic core (`core/`, `evaluate()`), the Claude/OpenCode paths, or the adapters' post-hoc parsing.

## Sequencing note

This spec's Phase 0 must run (and reveal real payloads) before the Phase-1 implementation plan is written. The plan author reads the committed `probe-<host>.jsonl` captures + the recorded findings, then writes the exact installers / mappings / serializers. That ordering is the spec's central discipline.
