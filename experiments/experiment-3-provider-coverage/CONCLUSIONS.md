# Experiment 3 — Conclusions (in progress)

**Verdict: host-agnosticity holds on real data — across four hosts.** Adding Codex *and* OpenCode each required **zero core changes** — a new adapter against real wire data, flowing through the existing `parse → eventsToSpans → toOTLP` path. `playground-4` is now **4 real providers** (Claude rich, Gemini thin, Codex rich, OpenCode rich).

## OpenCode findings (verified)

- v1.16.2 stores sessions in **SQLite** (`opencode.db`), tables `session`/`message`/`part` with JSON `data` blobs — read via built-in **`node:sqlite`** (zero-dep; loaded *lazily* via `createRequire` so it can't break the other adapters on Node <22).
- Real shapes (confirmed on a live `opencode run` with the Google/Gemini provider): message `data.role`; the user prompt is a `text` **part**; tool calls are `type:"tool"` parts with `{tool, callID, state:{status, input, output, time:{start,end}}}` → real durations + status. Part types also include `reasoning`/`step-start`/`step-finish` (ignored).
- Adapter splits SQLite I/O from a pure `buildTrace({session,messages,parts})` → normalization is hermetically tested; the real `mns capture --host opencode` validates the DB read. Captured `session → turn → bash` on a real session.
- **Strategic note:** the read-adapter here is the post-hoc path; the live plugin (`mns enable --host opencode`) is built + verified in [experiment-4](../experiment-4-opencode-plugin/). OpenCode's events are finer-grained than Claude's at the tool/message level, but its *session lifecycle* turned out to be the **same shape** as Claude (idle ≈ per-turn Stop; no clean end) — an earlier "cleaner than Claude" claim was corrected after observing real events.

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
