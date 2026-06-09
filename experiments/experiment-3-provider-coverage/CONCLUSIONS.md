# Experiment 3 — Conclusions (in progress)

**Verdict so far: host-agnosticity holds on real data.** Adding Codex required **zero core changes** — one new adapter against real wire data and it flowed through the existing `parse → eventsToSpans → toOTLP` path. The matrix is now **3 real providers** (Claude rich, Gemini thin, Codex rich) + OpenCode in progress.

## What worked

- **Real-data-first paid off.** The Codex docs explicitly warn "trust wire data, not docs" — and indeed the clean turn signal was `event_msg/user_message`, not the `message` items a docs-only adapter would have used (those carry injected permissions/environment noise). Only a real session surfaced that.
- **The core didn't move.** Codex is a 4th span shape; the normalized `Event` + deterministic-id pipeline absorbed it unchanged. That *is* the agnosticity claim, now demonstrated on three real hosts.
- **`call_id` pairing** gave real tool durations for free (flat call→output linkage, same idea as Claude's `tool_use_id`).

## Honest limits

- **Codex tool status is `OK`-only** for now — its output has no explicit error flag in the captured sample; needs a failing-tool session to model errors.
- **OpenCode is SQLite, not JSON** (v1.16.2). Reading it needs `node:sqlite` (built-in, Node ≥22) — fine here, but it raises the Node floor for that one adapter, and it's experimental. Pending a real `opencode run` session to lock the `data`-blob shapes; until then there is **no** OpenCode adapter (correctly reported as "no adapter" by `playground-4`, never faked green).
- These adapters were validated on a *single* real session each (one shape). More sessions (parallel tools, failures, multi-turn) would harden them.

## Next

- OpenCode: capture one real session → confirm `message.data`/`part.data` JSON → build the SQLite adapter (separate the SQLite I/O from a pure `buildTrace(rows)` so the normalization stays hermetically testable) → real capture + regression.
- Codex: a session with a failing tool to model error status.
- Then the deferred harvest of the trace core + adapters into `app/`.
