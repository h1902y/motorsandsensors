# Experiment 2 — live session lifecycle (the entire.io "enable once, then invisible" model)

> Phase 2 of the trace work. Where Experiment 1 captured **post-hoc** (you run `mns capture` after coding), this makes capture **live and invisible**: enable once, then your agent sessions are recorded automatically as they happen — opened on start, closed on end, and reconciled if the terminal is killed.

## Hypothesis

We can drive the [Session lifecycle primitive](../../mns/session.mjs) (`opening → active → completed | abandoned | crashed`) from a host's **lifecycle hooks**, non-intrusively, without rebuilding any trace logic — and we can recover **lost** sessions (killed terminals, which emit no end signal) after the fact.

## Where the code lives (note)

Unlike Experiment 1 (throwaway spike in `experiments/`), this is **product code** — it's the `mns` CLI's live surface. So the implementation lives in **`mns/`**, and this folder is the *experiment record* (hypothesis + findings):

- `mns/commands/{enable,disable,hook}.mjs` — the CLI verbs + the hook callback.
- `mns/live/{install,live-store,reconcile}.mjs` — settings install, liveness records, lost-session reconcile.
- `mns/commands/doctor.mjs` — runs reconcile.

## Key findings (verified, not assumed)

1. **`SessionEnd` ≠ `Stop` (the gating fact).** Verified against the docs *and* this repo's own transcript: `Stop` fires at the **end of every turn** (8× in one session), `SessionStart` once, and **`SessionEnd`** once when the session truly ends — with a `reason` (`clear|logout|prompt_input_exit|…`). So `SessionEnd` is the clean-end signal; treating `Stop` as "completed" would be wrong (it'd "complete" every turn).
2. **Design B — the hook is a SIGNAL + re-capture TRIGGER, never a span builder.** Every hook payload carries `transcript_path`; on each signal we re-run Experiment 1's proven `parse → eventsToSpans → toExportRequest` path wholesale. Because ids are deterministic, re-capture is idempotent. This avoids rebuilding span construction across short-lived hook processes — the exact problem that pushed Exp 1 to transcript-first — and gives correct durations + `tool_use_id` pairing for free. **No incremental span state, no PreToolUse stack, no parallel-tool caveat.**
3. **Lost sessions are reconciled, not signalled.** A killed terminal sends no `SessionEnd`, so its live record just stops getting heartbeats. **`mns doctor`** detects staleness and — because the **transcript is still on disk** — does a *full, correct* capture of the abandoned session before closing it. Nothing is lost on a kill. (`mns status` only displays; it doesn't reconcile.)
4. **Non-intrusive by construction.** Minimal hook set (`SessionStart/Stop/SessionEnd` — not the per-tool hooks, since we re-parse). Every hook command is wrapped `… || true` so it **always exits 0**; if `mns`/node is missing it degrades silently and never breaks your agent. Plus `permissions.deny: Read(./.mns/**)` so the agent can't read its own trace output (no feedback loop) — entire.io's pattern.

## Lifecycle mapping

| Hook | Action |
|---|---|
| `SessionStart` | open live record (`active`) + capture |
| `Stop` (per turn) | heartbeat + re-capture (stays `active`) |
| `SessionEnd` | capture as `completed` + close live record |
| *(no signal — killed)* | stale heartbeat → `mns doctor` captures as `abandoned` |

## Use it

```bash
mns enable      # installs the hooks into .claude/settings.json (this repo)
# …restart your agent, then just work. Sessions capture themselves.
mns status      # see them as active → completed
mns doctor      # reconciles any lost (killed) sessions
mns disable     # remove the hooks
```

## Honest limitations

- **Lazy lost-session detection.** A killed session reads `active` until the next `mns doctor` reconciles it (no kill signal exists — entire has the same constraint).
- **Shared index has a concurrency limit.** `.mns/sessions.json` is a single shared file; writes are atomic (no corruption), but two `mns`-enabled sessions in the *same repo* at once can still lose an index update via interleaved read-modify-write (trace blobs are per-session, so unaffected). Phase 3: per-session record files or locking. For the real-agent run, use a single terminal.
- **Not yet proven against a *real* live agent run.** Validated by hermetic tests + piping synthetic payloads through the real `mns hook` binary; enabling on a live Claude session and watching real hooks fire is the remaining real-world proof (deferred to avoid disrupting an in-flight session).
- **`Stop` re-captures every turn** — fine at our scale (idempotent, fast), but it's repeated work; a future optimization could diff.
- Claude Code only so far (it has the richest hook lifecycle). Gemini/others: thinner or transcript-reconcile fallback (future).

See [CONCLUSIONS.md](CONCLUSIONS.md).
