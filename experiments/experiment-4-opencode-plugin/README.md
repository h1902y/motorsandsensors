# Experiment 4 — OpenCode plugin (live capture)

> The live-capture path for OpenCode, and the first piece of the "MNS as an OpenCode plugin / default host" strategy (README §6). Where [experiment-3](../experiment-3-provider-coverage/) reads OpenCode's SQLite store *post-hoc*, this captures sessions **live and invisibly** via OpenCode's plugin bus — the OpenCode analog of `mns enable`'s Claude hooks.

## Hypothesis

OpenCode's plugin API (`@opencode-ai/plugin`) can drive the same Session lifecycle as the Claude hooks, non-intrusively, reusing the existing capture path (Design B: signal + re-capture trigger, never a span builder).

## What we verified (by observing real events — the gating step)

Before wiring anything, a throwaway logger plugin (`event: ({event}) => log(event.type)`) was dropped into `.opencode/plugin/` and a real `opencode run` was observed. Findings (these **corrected** a docs-based assumption):

- Plugins load from **`.opencode/plugin/`** (singular) as **`.js`**, via a named async export returning `{ event }`.
- The session id is at **`event.properties.sessionID`**.
- Real lifecycle order: **`session.created`** (once, start) → many `message.part.updated`/`session.updated` → **`session.idle`** (once, at the end of the turn).
- **`session.idle` is the per-turn "done" signal** (the analog of Claude's `Stop`), *not* a session-end marker — in an interactive TUI it fires after every turn.
- **`session.deleted` does NOT fire on normal completion** (delete-only). So OpenCode, like Claude, has **no clean end-of-session signal** → ended/killed sessions reconcile via staleness (`mns doctor`).

> This falsified an earlier "OpenCode gives a cleaner lifecycle/kill signal than Claude" claim (it was prose from event *names*, not behavior). The README/CONCLUSIONS were corrected: OpenCode is a **peer** live-capture host, not a categorically better one.

## What we built

- `mns enable --host opencode` writes `.opencode/plugin/mns.js` (project-scoped) — a graceful shim that, on `session.created` / `session.idle` (/ `session.deleted`), spawns `node <mns> hook <event> --host opencode --session <id>` detached (never throws into OpenCode). `mns disable --host opencode` removes it.
- The hook handler (`mns/commands/hook.mjs`) was generalized host-agnostically: `open`/`turn`/`end` map across `{SessionStart,Stop,SessionEnd}` (Claude) and `{session.created,session.idle,session.deleted}` (OpenCode). The capture `ref` is the transcript path for Claude, the `sessionID` for OpenCode (its adapter re-reads the SQLite store). Spawns the real `node` (not bun) so `node:sqlite` works.

## Verified (live, real data)

`mns enable --host opencode` → `opencode run "…bash…"` → **`mns status` showed the session captured live as `active`** (1 turn / 1 tool), with no manual `mns capture`. Disable cleanly removes the plugin.

## Honest limits

- **Same lazy-end constraint as Claude** — no clean end signal; a finished/killed OpenCode session reads `active` until `mns doctor` reconciles it.
- `session.idle` re-captures each turn (idempotent, fast; a debounce is a later optimization).
- The plugin spawns one detached `mns` per lifecycle event — fine (lifecycle events are few), and deliberately *not* wired to `tool.execute.*`/`message.part.updated` (those fire many times per turn).

See [CONCLUSIONS.md](CONCLUSIONS.md).
