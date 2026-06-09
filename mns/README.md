# mns — the motors & sensors CLI

Verb-first, entire.io-style, **zero dependencies, no build**. The user-facing surface over the trace core.

```bash
mns init                    # scaffold the faculty home (.mns/) — git-style, idempotent
mns status                  # detected hosts + recorded sessions
mns capture [--host NAME]   # capture a session → git-native trace + index entry
mns trace [--last | FILE]   # print a captured trace's span tree
mns enable | disable        # live, invisible capture on/off — Claude hooks, or --host opencode (plugin)
mns hook <Event>            # internal: the callback Claude Code's hooks invoke
mns doctor                  # environment + session + faculty-home health (reconciles lost sessions)
mns version | help
```

## The faculty home (`mns init`)

Git-init semantics — context-aware, idempotent, never destructive:
**empty dir** → full scaffold + `AGENTS.md`/`CLAUDE.md` created · **existing project** → scaffold + delimiter-block injected into existing instruction files (user text untouched) · **`.mns/` exists** → "Reinitialized", missing pieces only.

`.mns/` = everything mns owns in a project: `knowledge/` (semantic) · `memory/` (episodic) · `actions/` (procedural) · `instructions/` (cognition steering + v1-advisory guardrails) · plus the observe layer (`sessions.json`, `traces/`, `live/`). See [experiment-5](../experiments/experiment-5-faculty-home/).

Run as `mns <cmd>` after `npm link`, or `node bin/mns.mjs <cmd>`, or `npm run mns -- <cmd>`.

> Named `mns` (not `mas`) on purpose — `mas` is Homebrew's Mac App Store CLI; we don't shadow it.

## Git-native storage

Mirrors entire.io's split so trace blobs never pollute your working diff:

| Path | Tracked? | What |
|---|---|---|
| `.mns/sessions.json` | **tracked** | the session index — small, diff-friendly, each entry links to the `git commit` it was captured at |
| `.mns/traces/*.otlp.jsonl` | git-ignored | the bulky OTLP blobs (regenerable); Phase 2 moves these to an orphan `mns/traces` branch |

## The Session primitive (`session.mjs`)

The lifecycle model: `opening → active → completed | abandoned | crashed`. A killed terminal sends no clean "end", so lost sessions are *reconciled* (entire's approach), not signalled.

**`mns capture` (post-hoc):** records a session as `captured` (lifecycle-unknown snapshot from an existing transcript).

**`mns enable` (live):** installs background hooks (`SessionStart/Stop/SessionEnd`) so sessions transition for real — `active → completed`, or `→ abandoned` when a terminal is killed (reconciled by `mns doctor` via a liveness heartbeat, since a kill emits no signal). Built in [`experiment-2-live-sessions`](../experiments/experiment-2-live-sessions/); the hook is a lifecycle *signal + re-capture trigger* (Design B), never a span builder. See [QUICKSTART.md](../QUICKSTART.md#live-capture-enable-once-then-invisible).

## Layout

- `bin/mns.mjs` — dispatch (in repo root `bin/`).
- `mns/session.mjs` — the Session primitive + lifecycle state machine.
- `mns/store.mjs` — the git-native `.mns/` store + git linkage.
- `mns/commands/{status,capture,trace,doctor}.mjs`.

Reuses Experiment 1's `core/` + `adapters/` in place; re-points to `app/` at harvest.
