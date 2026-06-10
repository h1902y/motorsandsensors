# Spec — pi as a host: live capture + the guardrails gate

**Date:** 2026-06-10
**Status:** design (doc-verified) → Phase 0 (confirm on real session) then the plan
**Stage:** pi is the **Stage-3** host (the owned-harness target, DESIGN §6). This spec brings pi to **observe** parity with the other four hosts — capture + gate — as a normal wrapped host. (Stage 3 proper — building the *owned harness* on pi — remains gated on the efficiency benchmark; this is just coverage.)

## Goal

`mns enable --host pi` installs a pi **extension** that: (a) fires the mns lifecycle hook for live capture, and (b) gates tool calls against `.mns/guardrails/rules.json`, blocking `deny`. Add a **pi adapter** (the 5th) so `mns capture`/live capture parse pi's session files. Reuse the shared `evaluate()` engine.

## The governing constraint — the real-wire-data rule

pi ships its own docs on disk (v0.79.1: `docs/extensions.md`, `docs/sdk.md`, `docs/session-format.md`) — read directly, so the API shape is **doc-verified against the installed version**. Phase 0 *confirms behavior on a real session* (does each event fire under the run mode we use; exact payload fields). Findings below are doc-verified; Phase 0 is confirmation.

### Doc-verified findings (2026-06-10)

1. **Extension shape:** `export default function (pi) { pi.on(event, handler); pi.registerTool(...); }`. Auto-discovered from **`.pi/extensions/`** (project) or `~/.pi/agent/extensions/` (global). **`.ts` loads natively** (via jiti — no build step).
2. **The gate:** `pi.on("tool_call", async (event, ctx) => {...})` — `event.toolName`, `event.input` (e.g. `event.input.command`), `event.toolCallId`. **Returning `{ block: true, reason }` vetoes** the call. Handlers are **awaited** before the tool runs, so a handler that `await`s a spawned `node` gate genuinely blocks — pi has **no timeout**, so we add our own + fail-open.
3. **Lifecycle:** `session_start { reason: "startup"|"new"|"resume"|"fork", previousSessionFile? }` (open) · `turn_end` (turn) · `session_shutdown` (end). The active session file comes from `ctx.sessionManager.getSessionFile()` (not the event).
4. **Sessions (for the adapter):** `~/.pi/agent/sessions/--<cwd-slashes-as-dashes>--/<timestamp>_<uuid>.jsonl` — **JSONL**, first line a `SessionHeader` `{type:"session", version, id, timestamp, cwd}`, entries linked by `id`/`parentId` (a tree) — maps directly onto our existing `refId`/`parentRefId` adapter model.
5. **Headless `pi -p`:** needs **`--approve`** (or persisted project trust) or project-local `.pi/extensions/` is silently skipped. In print mode **`ctx.ui` is a no-op** (`ctx.hasUI===false`) → the gate must **auto-decide** (no `ctx.ui.confirm`). Whether the loop events fire under `-p` is **unconfirmed** (docs guarantee extensions run + UI is no-op, not that each event fires) → Phase 0 confirms; if `-p` doesn't fire them, confirm interactively (the Codex pattern).

## Architecture — Design B, unchanged

The pi extension is a **signal + re-capture trigger**, never a span builder (like the OpenCode plugin). Capture = on `session_start`/`turn_end`/`session_shutdown`, spawn `mns hook <event> --host pi --session <id>` detached (fire-and-forget) → the **pi adapter** re-parses the session JSONL. Gate = on `tool_call`, spawn the shared mns gate awaited and return `{block:true,reason}` on `deny`.

---

> **Phase-0 status (2026-06-10, ✅ DONE).** Probed headless via `pi --approve --provider openrouter --model google/gemini-2.5-flash -p`. Real-wire results (golden: `tests/fixtures/hooks/pi.probe.jsonl`) — **all events fire headless under `-p`**:
> - `session_start { reason:"startup" }` (open) · `turn_start { turnIndex, timestamp }` / `turn_end { turnIndex, message, toolResults }` (turn) · `agent_start` · `session_shutdown` (end).
> - **`tool_call { toolName:"bash", toolCallId, input:{command} }`** — the gate point; `event.toolName` + `event.input` confirmed (returning `{block:true,reason}` would veto). Also `tool_execution_start/end`, `tool_result { content, isError }`.
> - The event payload carries **no session id/path** — confirmed: get it from `ctx.sessionManager.getSessionFile()` (second handler arg). `--approve` was required for the project extension to load headless.
> - (The earlier 11-min stall was purely the Google free-tier 429; OpenRouter resolved it.)

## Phase 0 — Observe (probe pi's real events)

A probe extension (`.pi/extensions/probe.ts`) records each event's real payload; run a real pi session that triggers a tool.
- **Run it:** `pi --approve -p "... use the bash tool ..."` first; if events don't fire under `-p` (or it stalls), run **interactively** (`pi`, trust the extension) — pi's model (`gemini-3.1-pro-preview`, thinking "high") can be slow, so allow time / try a faster model via `--model`.
- **Deliverables (gate the plan):** which events fire (and under which run mode); the exact `tool_call` fields (`toolName`, `input` shape per tool); the session id field + that `ctx.sessionManager.getSessionFile()` gives the path; confirmation `{block:true}` vetoes. Committed as a golden fixture (`tests/fixtures/hooks/pi.probe.jsonl`).

---

## Phase 1 — Wire (shape specified; specifics from Phase 0)

### 1. The pi adapter (5th host) — `experiments/experiment-1-trace-capture/adapters/pi.mjs`

Parse pi's session JSONL → the normalized `Event[]` tree (the existing core). `parse(ref)` takes the session file path; read the `SessionHeader` for session id/cwd; walk entries by `id`/`parentId` → SESSION → TURN → TOOL spans (depth as pi's tree allows; match the Claude/Codex adapter richness where the format supports it). `detect()` = `~/.pi/agent/sessions/` exists. `listSessions()` walks that dir. Register in `adapters/registry.mjs` (host name `pi`). Real-wire: golden ids pasted from a real captured pi session.

### 2. The extension (installed by `mns enable --host pi`) — `mns/commands/enable.mjs`

`enable --host pi` writes `.pi/extensions/mns.ts` (auto-discovered; `.ts` ok). The extension:
- `session_start` / `turn_end` / `session_shutdown` → spawn `node "<BIN>" hook <mapped-event> --host pi --session <id>` **detached** (capture; never blocks).
- `tool_call` → spawn the mns gate **awaited** (`node "<BIN>" hook PreToolUse --host pi`, payload `{tool_name, tool_input, session_id}` on stdin), with a **timeout**; on `deny` return `{ block: true, reason }`; on `ask`/allow/no-match/**any error/timeout** return nothing (defer — fail-open; print-mode can't prompt so ask defers). 
- `disable --host pi` removes the extension file.
- Note the `--approve`/trust requirement for headless in the enable output.

### 3. `hook.mjs` — pi event mapping + gate

- Add pi's event names to the `OPEN`/`TURN`/`END` sets (`session_start`→open, `turn_end`→turn, `session_shutdown`→end). `runHook` for pi: capture events use `--session` (the extension passes the id; the adapter resolves the path) OR stdin — decide from Phase 0 (the extension can pass the session-file path as `--session`/an arg since pi gives it via `getSessionFile()`).
- `gateDecision` is host-aware; pi's "decision" is consumed by the extension (which reads the spawned gate's stdout/exit to decide `{block}`), like OpenCode — add a pi branch returning a parseable deny (reuse `{decision:"deny",reason}`). Log to `.mns/live/guardrails-<session>.jsonl` with `host:"pi"`.

### Honest-outcome handling

Ship per-host what verifies: if `tool_call` fires + `{block}` vetoes → gate ships; if only some events fire under `-p` → capture works in whatever mode they fire (interactive at minimum). Record any gap (e.g. headless-only-partial) in the LOG, as with Codex.

---

## Testing

- **Golden fixtures:** the Phase-0 `pi.probe.jsonl` + a real captured pi session (adapter goldens, ids pasted from a real run).
- **Unit:** the pi adapter (`parse` → span tree from a real session fixture); pi event-set membership; the pi gate decision; `enable --host pi` writes/removes the extension; fail-open (gate error → no block).
- **Dogfood:** `mns enable --host pi`, seed a `deny` rule, run a real pi session that hits the gated tool → confirm blocked + `{host:"pi",…,action:"deny"}` logged + a live session recorded via the extension. (Interactive if `-p` doesn't fire events.)

## Explicitly NOT in scope (YAGNI)

- Building the **owned harness** on pi (Stage 3 proper — gated on the efficiency benchmark). This spec is *coverage as a wrapped host* only.
- Digest/context injection for pi (separate slice).
- The OpenCode gate (its own spec) and any change to the other four hosts' paths or the shared `evaluate()`.

## Sequencing note

Per the agreed order, the **OpenCode gate ships first**; this pi spec follows. Phase 0 (probe) confirms pi's real events before the Phase-1 plan is written.
