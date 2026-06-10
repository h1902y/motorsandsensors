# experiments/LOG.md — the build journal

> **The method:** every capability starts as a numbered experiment with a hypothesis; it must be **proven against real sessions/wire data** (never invented fixtures) before it counts; each entry below ends with its Conclusions (what worked, honest limits, harvest list); proven parts graduate into `app/`. Entries are **dated records — append, don't rewrite** (corrections get appended notes). Spike code lives in `experiments/experiment-N-*/` while it's experimental (only exp-1 has code; later experiments shipped straight into `mns/` and are recorded here).

| # | Experiment | Status |
|---|---|---|
| 1 | host-agnostic trace capture | ✅ proven (4 real hosts); harvest pending |
| 2 | live session lifecycle (`mns enable`) | ✅ proven (real-agent run pending); code in `mns/` |
| 3 | provider coverage (Codex + OpenCode, real wire data) | ✅ proven; core unchanged → 4 real hosts |
| 4 | OpenCode plugin (live capture) | ✅ live-verified; same lifecycle shape as Claude |
| 5 | faculty home (`mns init`) | ◐ scaffold proven; live agent-reads-faculties proof pending |
| 6 | guardrails gate (5+3 taxonomy; enforced PreToolUse) | ✅ gate verified vs real schema; real-session firing pending |

---

## Experiment 1 — host-agnostic trace capture

> The README calls the **trace** the keystone — "the typed, append-only, tree-shaped record of every run… **build it first**." This experiment builds the minimal version of it, and does so **host-agnostically** (not Claude-Code-first).

### Hypothesis

We can capture a coding-agent session as a **tree-shaped OpenTelemetry trace** by **parsing the host's session transcript off disk** — a mechanism that:

- needs **zero cooperation** from the host (no hooks, no running process, no SDK in the host), and
- runs through **one host-agnostic core** that knows nothing about any specific host, fed by small per-host **adapters**.

If true, "host-agnostic" is a property of the architecture, provable by pointing ≥2 different hosts' logs at the same core and getting valid traces out of both.

### Why transcript parsing (not hooks)

Hooks are host-specific and uneven — Claude Code's are rich, most others are thin or absent. But **every** host writes a session log to disk. Parsing that log is the most host-agnostic capture surface there is (it's the entire.io adapter shape: `resolveTranscript` + `parseTranscript`). It also hands us **stable per-tool-call ids** for free (`tool_use.id` ↔ `tool_result.tool_use_id`), which dissolves the Pre/Post correlation problem that the hook approach can't solve cleanly (Claude Code hook payloads carry no per-call id — verified). Live hooks remain a *future* enhancement, not the foundation.

### Success criteria

- [x] A host-agnostic **core** (`core/`) maps a normalized `Event[]` → OTel spans → OTLP/JSON, with **no host conditionals**.
- [x] A documented **HostAdapter contract** (`adapters/host-adapter.mjs`).
- [x] **≥2 adapters** producing valid traces from **real on-disk data** → agnosticity *demonstrated*, not asserted.
- [x] Output is **OTLP/JSON** (`ExportTraceServiceRequest` per line) — structurally validated, replayable into any OTel backend later.

### Architecture

```
adapters/<host>.mjs   native log ──▶  Event[]        (host-specific; the only place host knowledge lives)
core/event.mjs        the normalized Event vocabulary (session / turn / tool_call; tree via refId/parentRefId)
core/ids.mjs          deterministic W3C trace_id / span_id  (re-capture is idempotent)
core/spans.mjs        Event[] ──▶ OTel spans            (pure id-wiring; host-agnostic)
core/otlp.mjs         spans ──▶ OTLP/JSON NDJSON
bin/capture.mjs       pick host → parse → write out/<host>-<session>.otlp.jsonl
bin/inspect-trace.mjs pretty-print the span tree
```

The core never branches on host name; the dispatcher routes by detection/capability. Adding a host = adding one adapter file to `adapters/registry.mjs`.

### Run it

```bash
npm run capture                       # auto-detect a host (transcript-present), capture latest session
npm run capture -- --list             # show detected hosts + their sessions
npm run capture -- --host gemini-cli  # capture a specific host
npm run inspect -- experiments/experiment-1-trace-capture/out/<file>.otlp.jsonl
```

### Result (captured live, this session)

**Claude Code** — rich `session → turn → tool` tree, real durations + OK/ERROR status:

```
• session 20410eef (claude-code)  56.1m
  • turn: …/init…  1.0m
    • Bash  704ms
    • Read  540ms
  • turn: Okay let's start the application scaffolding…  48.6m
    • Agent  2.1m
    • AskUserQuestion  17.2m      ← real human think-time, captured
    • WebFetch  13.8s
    • ExitPlanMode  13.4m
    …
```

**Gemini CLI** — thin `session → turn` tree (its `logs.json` logs user prompts only; tool calls live in checkpoints, not captured):

```
• session 6c6924c4 (gemini-cli)  1420.4m
  • turn: what is this codebase about  6.3m
  • turn: deep dive on swira  1414.1m
```

Same core, two hosts, different richness → **host-agnosticity demonstrated**, and the rich/thin gap is the README's "completeness varies by host" thesis made literal.

 for lessons and the harvest list.

---

### Conclusions

**Verdict: hypothesis confirmed.** Transcript parsing is a viable, genuinely host-agnostic trace-capture mechanism. Two real hosts (Claude Code, Gemini CLI) produced valid OTLP/JSON traces through one core with zero host conditionals. All structural checks on the output passed.

### What worked

- **Transcript-first beats hook-first** for the foundation. It needs no host cooperation, no running process, and — critically — Claude transcripts carry stable `tool_use.id` ↔ `tool_result.tool_use_id` pairs, so span pairing, durations, and OK/ERROR status come for free. (Confirmed the hook payload has *no* per-call id, which would have made Pre/Post pairing ambiguous under parallel tool calls.)
- **`refId` / `parentRefId` on the Event is the right host-agnostic seam.** Adapters express whatever tree depth the host's log supports; the core just wires `parent_span_id = spanId(parentRefId)`. No host logic leaks into the core.
- **Deterministic ids** (`sha256(host+session)` / `sha256(trace+refId)`) make re-capture idempotent and remove any id-mapping table.
- **OTLP/JSON `ExportTraceServiceRequest` per line** is the right output: validated structurally (32/16-hex ids, uint64-nano string timestamps, AnyValue attrs, resolvable parents). It's collector-ingestible later with no converter.
- **Capturing live, in-session, is dogfood gold.** The trace shows real human think-time (`AskUserQuestion 17.2m`, `ExitPlanMode 13.4m`) and tool latencies — exactly the signal the evolution engine will mine.

### What we learned / honest limits

- **Completeness varies by host — by a lot.** Claude = `session→turn→tool` with status; Gemini's `logs.json` = `session→turn` (prompts only). This is the README's thesis made literal, and it means **trace richness is per-adapter**, so any downstream eval lens must tolerate missing tool spans, not assume them.
- **OTLP-conformant ≠ collector-tested.** We validated the structure by schema, not by feeding a running OpenTelemetry Collector `otlpjsonfilereceiver`. Structurally it matches; a live round-trip is still unproven. *(Cheap follow-up.)*
- **Turn detection is heuristic.** We key turns on non-meta `user` entries with text content; queued user messages (`queue-operation` entries — e.g. mid-turn interjections) are currently **not** captured as turns. Visible in this very session (2 turns detected, but there were more interjections).
- **Raw tool input/output is deliberately NOT on the trace** — only byte sizes. Good default (dodges secrets-in-trace, keeps size down), but the eval lens will eventually need *some* content; that's a guardrails/redaction design point, not a free addition.
- **Tree depth is shallow.** Subagent/`Task` calls aren't nested under their sub-session yet (the `Agent` tool shows as a single span). Real nesting needs sidechain-transcript linking.
- **Span durations are wall-clock, including idle.** Tool spans are real latency (meaningful — `AskUserQuestion 17.2m` is genuine think-time). But a **turn** span is tiled to run until the next prompt, so it conflates response + idle (e.g. `turn: deep dive… 1414.1m` is mostly idle). The future eval lens must **not** treat turn duration as active-work time, or it'll flag idle gaps as pathological "slow operations".

### Harvest list → `app/`

When we promote (the method's step 5):

| From experiment | To `app/` | Notes |
|---|---|---|
| `core/event.mjs`, `core/ids.mjs`, `core/spans.mjs`, `core/otlp.mjs` | `app/evolution/observability/` | the host-agnostic trace core — Observability is the keystone under "evolve" |
| `adapters/host-adapter.mjs` (contract) + `registry.mjs` | `app/runtime/host-adapter/` | the observe-model seam lives under "run" |
| `adapters/claude-code.mjs`, `adapters/gemini-cli.mjs` | `app/runtime/host-adapter/adapters/` | per-host shims |

Harvest is a **separate step** (not done today) — promote only once a second experiment hasn't forced a core change.

### Candidate next experiments

- **Exp 2 — collector round-trip:** feed `out/*.otlp.jsonl` into a real OTel Collector `otlpjsonfilereceiver` → prove drop-in interop (and to a viewer like Jaeger/Tempo).
- **Exp 2/3 — Gemini checkpoint adapter:** parse Gemini checkpoint files to recover the missing tool spans → close the completeness gap for a second host.
- **Live capture (hooks):** Claude Code `PostToolUse`/`Stop` → append spans in real time, reconciled against the transcript at session end.
- **Subagent nesting:** link sidechain transcripts so `Task`/`Agent` spans become real sub-trees.
- **First eval lens:** run the README's cheap signals over a captured trace (retire-unused-tool, high tool-failure) — the first taste of the evolution engine.

---

## Experiment 2 — live session lifecycle (the entire.io "enable once, then invisible" model)

> Phase 2 of the trace work. Where Experiment 1 captured **post-hoc** (you run `mns capture` after coding), this makes capture **live and invisible**: enable once, then your agent sessions are recorded automatically as they happen — opened on start, closed on end, and reconciled if the terminal is killed.

### Hypothesis

We can drive the [Session lifecycle primitive](../mns/session.mjs) (`opening → active → completed | abandoned | crashed`) from a host's **lifecycle hooks**, non-intrusively, without rebuilding any trace logic — and we can recover **lost** sessions (killed terminals, which emit no end signal) after the fact.

### Where the code lives (note)

Unlike Experiment 1 (throwaway spike in `experiments/`), this is **product code** — it's the `mns` CLI's live surface. So the implementation lives in **`mns/`**, and this folder is the *experiment record* (hypothesis + findings):

- `mns/commands/{enable,disable,hook}.mjs` — the CLI verbs + the hook callback.
- `mns/live/{install,live-store,reconcile}.mjs` — settings install, liveness records, lost-session reconcile.
- `mns/commands/doctor.mjs` — runs reconcile.

### Key findings (verified, not assumed)

1. **`SessionEnd` ≠ `Stop` (the gating fact).** Verified against the docs *and* this repo's own transcript: `Stop` fires at the **end of every turn** (8× in one session), `SessionStart` once, and **`SessionEnd`** once when the session truly ends — with a `reason` (`clear|logout|prompt_input_exit|…`). So `SessionEnd` is the clean-end signal; treating `Stop` as "completed" would be wrong (it'd "complete" every turn).
2. **Design B — the hook is a SIGNAL + re-capture TRIGGER, never a span builder.** Every hook payload carries `transcript_path`; on each signal we re-run Experiment 1's proven `parse → eventsToSpans → toExportRequest` path wholesale. Because ids are deterministic, re-capture is idempotent. This avoids rebuilding span construction across short-lived hook processes — the exact problem that pushed Exp 1 to transcript-first — and gives correct durations + `tool_use_id` pairing for free. **No incremental span state, no PreToolUse stack, no parallel-tool caveat.**
3. **Lost sessions are reconciled, not signalled.** A killed terminal sends no `SessionEnd`, so its live record just stops getting heartbeats. **`mns doctor`** detects staleness and — because the **transcript is still on disk** — does a *full, correct* capture of the abandoned session before closing it. Nothing is lost on a kill. (`mns status` only displays; it doesn't reconcile.)
4. **Non-intrusive by construction.** Minimal hook set (`SessionStart/Stop/SessionEnd` — not the per-tool hooks, since we re-parse). Every hook command is wrapped `… || true` so it **always exits 0**; if `mns`/node is missing it degrades silently and never breaks your agent. Plus `permissions.deny: Read(./.mns/**)` so the agent can't read its own trace output (no feedback loop) — entire.io's pattern.

### Lifecycle mapping

| Hook | Action |
|---|---|
| `SessionStart` | open live record (`active`) + capture |
| `Stop` (per turn) | heartbeat + re-capture (stays `active`) |
| `SessionEnd` | capture as `completed` + close live record |
| *(no signal — killed)* | stale heartbeat → `mns doctor` captures as `abandoned` |

### Use it

```bash
mns enable      # installs the hooks into .claude/settings.json (this repo)
## …restart your agent, then just work. Sessions capture themselves.
mns status      # see them as active → completed
mns doctor      # reconciles any lost (killed) sessions
mns disable     # remove the hooks
```

### Honest limitations

- **Lazy lost-session detection.** A killed session reads `active` until the next `mns doctor` reconciles it (no kill signal exists — entire has the same constraint).
- **Shared index has a concurrency limit.** `.mns/sessions.json` is a single shared file; writes are atomic (no corruption), but two `mns`-enabled sessions in the *same repo* at once can still lose an index update via interleaved read-modify-write (trace blobs are per-session, so unaffected). Phase 3: per-session record files or locking. For the real-agent run, use a single terminal.
- **Not yet proven against a *real* live agent run.** Validated by hermetic tests + piping synthetic payloads through the real `mns hook` binary; enabling on a live Claude session and watching real hooks fire is the remaining real-world proof (deferred to avoid disrupting an in-flight session).
- **`Stop` re-captures every turn** — fine at our scale (idempotent, fast), but it's repeated work; a future optimization could diff.
- Claude Code only so far (it has the richest hook lifecycle). Gemini/others: thinner or transcript-reconcile fallback (future).



---

### Conclusions

**Verdict: hypothesis confirmed.** The session lifecycle can be driven non-intrusively from Claude Code's lifecycle hooks, reusing Experiment 1's capture path unchanged, with lost sessions recovered from the on-disk transcript. The `mns enable → invisible live capture` model works; demonstrated end-to-end through the real binary (synthetic payloads) and covered by 7 hermetic tests.

### What worked

- **Design B was the unlock.** Making the hook a *signal + re-capture trigger* (not a span builder) collapsed the hard part. The cross-process span-correlation problem that defined Exp 1 simply doesn't exist here — we re-parse the whole transcript on each signal, idempotently. The genuinely new code is tiny: liveness records + reconcile + the settings installer.
- **Verifying `SessionEnd` vs `Stop` before wiring saved a correctness bug.** Mapping `Stop`→completed would have "completed" the session every turn. `SessionEnd` (once, with `reason`) is the real end; `Stop` is a per-turn heartbeat.
- **Lost-session recovery is lossless,** because a killed terminal leaves its transcript on disk — reconcile captures the full abandoned session, not a stub.
- **Graceful degradation is real:** every hook command is `… || true` → exit 0; piped events through the binary all returned 0; a missing `mns` can't break the agent.
- **The lifecycle state machine from Phase 1 now actually transitions** (`active → completed`, `→ abandoned`), validated in `tests/regression/live-lifecycle.test.mjs`.

### What we learned / honest limits

- **Detection of kills is lazy** (next `mns doctor`), not instant — unavoidable without a kill signal; entire.io has the same limitation. (`status` only displays.) Documented in the README.
- **Shared-index concurrency.** `.mns/sessions.json` writes are atomic (tmp+rename → no corruption), but concurrent upserts from two sessions in one repo can still lose an update. Per-session record files (or locking) is the Phase-3 fix; trace blobs are per-session and unaffected.
- **No real-agent live run yet.** Everything is proven via hermetic tests + piping synthetic payloads through `mns hook`. Enabling on an actual live Claude session (real hooks firing on real turns) is the remaining proof; deferred deliberately to avoid disrupting an in-flight working session.
- **The live record id vs index id can differ** if `payload.session_id` ≠ the transcript's session id. In real Claude sessions they match; worth asserting once during the real-agent run.
- **`Stop` re-captures each turn** — repeated full parse. Fine now (fast, idempotent); a diff/debounce is a later optimization.
- **Claude Code only.** It has the richest lifecycle hooks. Gemini and thinner hosts need a transcript-reconcile fallback (no live signals) — future work.

### What graduates / next

- The live machinery already lives in `mns/` (product), so there's nothing to "harvest" — but the **trace core + Session primitive** (Exp 1 + 2) are now proven enough to move from `experiments/` into `app/evolution/observability/` + `app/runtime/host-adapter/` (the deferred harvest).
- **Next experiments:** a real-agent live run (the remaining proof); git-native traces on an orphan branch `mns/traces` (currently blobs are local-only); Gemini live/checkpoint support; the first **eval lens** over captured sessions (the evolution engine — the actual differentiator).

---

## Experiment 3 — provider coverage (real-data-verified)

> Pressure-test the host-agnostic claim by adding **more real providers** — Claude Code and Gemini proved the core works across two shapes; this extends it to Codex and OpenCode, each validated against **wire data the host actually produced**, not docs or hand-written fixtures.

### Hypothesis

The host-agnostic core (normalized `Event` → OTel spans) accepts any host's session format behind a thin adapter. If true, adding Codex and OpenCode is *just another adapter each*, with **zero core changes** — and we can prove it on real output, not assert it.

### The honesty rule (why this experiment is shaped this way)

Building an adapter from a vendor's docs and testing it against a fixture *we* wrote is circular — it proves "we can read JSON we invented," not "we read real Codex/OpenCode output." So for each provider: **install the real CLI → run one real session → build the adapter against the actual wire data → capture it for real.** Fixtures are then derived from the confirmed real shape (for hermetic regression), and the real capture is the verification.

### Status

| Provider | Format | Verified against real data | Capture |
|---|---|---|---|
| **Codex** | `~/.codex/sessions/**/rollout-*.jsonl` — `{timestamp,type,payload}`; `session_meta`, `response_item` (message / `function_call` / `function_call_output`, flat by `call_id`), `event_msg` | ✅ a real `codex exec` session | rich — `session → turn → tool`, real durations |
| **OpenCode** | `~/.local/share/opencode/opencode.db` — **SQLite** (`session`/`message`/`part` tables; `data` columns are JSON), read via built-in `node:sqlite` (zero-dep) | ⏳ pending one real `opencode run` session | — |

Adapters live with the others in [`../experiment-1-trace-capture/adapters/`](experiment-1-trace-capture/adapters/) and register in `registry.mjs`; the core was **not touched** — that's the agnosticity result.

### Codex findings (verified)

- Turns come from `event_msg/user_message` (clean prompt text) — *not* the `response_item/message role:developer|user` entries, which include injected `<permissions instructions>` / `<environment_context>` noise.
- Tool spans pair `function_call` ↔ `function_call_output` by **`call_id`** (flat, not nested) → real durations. Confirmed on a live `codex exec "list the files…"`: `session → turn → exec_command (79ms)`.
- Codex tool output carries **no explicit error flag** in the sample, so tool status defaults to `OK` (a refinement once we see a failing call).

### OpenCode notes

- v1.16.2 stores sessions in **SQLite**, not JSON files (the migration the docs mention has happened). `session`/`message`/`part` tables with JSON `data` blobs.
- `node:sqlite` (built-in, Node ≥22, no flag on Node 25) reads it → still zero external deps.
- Needs a real `opencode run` session to confirm the `message.data`/`part.data` JSON shapes before the adapter is trustworthy (in progress).



---

### Conclusions

**Verdict: host-agnosticity holds on real data — across four hosts.** Adding Codex *and* OpenCode each required **zero core changes** — a new adapter against real wire data, flowing through the existing `parse → eventsToSpans → toOTLP` path. `playground-4` is now **4 real providers** (Claude rich, Gemini thin, Codex rich, OpenCode rich).

### OpenCode findings (verified)

- v1.16.2 stores sessions in **SQLite** (`opencode.db`), tables `session`/`message`/`part` with JSON `data` blobs — read via built-in **`node:sqlite`** (zero-dep; loaded *lazily* via `createRequire` so it can't break the other adapters on Node <22).
- Real shapes (confirmed on a live `opencode run` with the Google/Gemini provider): message `data.role`; the user prompt is a `text` **part**; tool calls are `type:"tool"` parts with `{tool, callID, state:{status, input, output, time:{start,end}}}` → real durations + status. Part types also include `reasoning`/`step-start`/`step-finish` (ignored).
- Adapter splits SQLite I/O from a pure `buildTrace({session,messages,parts})` → normalization is hermetically tested; the real `mns capture --host opencode` validates the DB read. Captured `session → turn → bash` on a real session.
- **Strategic note:** the read-adapter here is the post-hoc path; the live plugin (`mns enable --host opencode`) is built + verified in [experiment-4(experiment 4, below). OpenCode's events are finer-grained than Claude's at the tool/message level, but its *session lifecycle* turned out to be the **same shape** as Claude (idle ≈ per-turn Stop; no clean end) — an earlier "cleaner than Claude" claim was corrected after observing real events.

### What worked

- **Real-data-first paid off.** The Codex docs explicitly warn "trust wire data, not docs" — and indeed the clean turn signal was `event_msg/user_message`, not the `message` items a docs-only adapter would have used (those carry injected permissions/environment noise). Only a real session surfaced that.
- **The core didn't move.** Codex is a 4th span shape; the normalized `Event` + deterministic-id pipeline absorbed it unchanged. That *is* the agnosticity claim, now demonstrated on three real hosts.
- **`call_id` pairing** gave real tool durations for free (flat call→output linkage, same idea as Claude's `tool_use_id`).

### Honest limits

- **Codex tool status is `OK`-only** for now — its output has no explicit error flag in the captured sample; needs a failing-tool session to model errors.
- **OpenCode is SQLite, not JSON** (v1.16.2). Reading it needs `node:sqlite` (built-in, Node ≥22) — fine here, but it raises the Node floor for that one adapter, and it's experimental. Pending a real `opencode run` session to lock the `data`-blob shapes; until then there is **no** OpenCode adapter (correctly reported as "no adapter" by `playground-4`, never faked green).
- These adapters were validated on a *single* real session each (one shape). More sessions (parallel tools, failures, multi-turn) would harden them.

### Next

- OpenCode: capture one real session → confirm `message.data`/`part.data` JSON → build the SQLite adapter (separate the SQLite I/O from a pure `buildTrace(rows)` so the normalization stays hermetically testable) → real capture + regression.
- Codex: a session with a failing tool to model error status.
- Then the deferred harvest of the trace core + adapters into `app/`.

---

## Experiment 4 — OpenCode plugin (live capture)

> The live-capture path for OpenCode, and the first piece of the "MNS as an OpenCode plugin / default host" strategy (DESIGN §6 (`docs/DESIGN.md`)). Where [experiment-3(experiment 3, above) reads OpenCode's SQLite store *post-hoc*, this captures sessions **live and invisibly** via OpenCode's plugin bus — the OpenCode analog of `mns enable`'s Claude hooks.

### Hypothesis

OpenCode's plugin API (`@opencode-ai/plugin`) can drive the same Session lifecycle as the Claude hooks, non-intrusively, reusing the existing capture path (Design B: signal + re-capture trigger, never a span builder).

### What we verified (by observing real events — the gating step)

Before wiring anything, a throwaway logger plugin (`event: ({event}) => log(event.type)`) was dropped into `.opencode/plugin/` and a real `opencode run` was observed. Findings (these **corrected** a docs-based assumption):

- Plugins load from **`.opencode/plugin/`** (singular) as **`.js`**, via a named async export returning `{ event }`.
- The session id is at **`event.properties.sessionID`**.
- Real lifecycle order: **`session.created`** (once, start) → many `message.part.updated`/`session.updated` → **`session.idle`** (once, at the end of the turn).
- **`session.idle` is the per-turn "done" signal** (the analog of Claude's `Stop`), *not* a session-end marker — in an interactive TUI it fires after every turn.
- **`session.deleted` does NOT fire on normal completion** (delete-only). So OpenCode, like Claude, has **no clean end-of-session signal** → ended/killed sessions reconcile via staleness (`mns doctor`).

> This falsified an earlier "OpenCode gives a cleaner lifecycle/kill signal than Claude" claim (it was prose from event *names*, not behavior). The README/CONCLUSIONS were corrected: OpenCode is a **peer** live-capture host, not a categorically better one.

### What we built

- `mns enable --host opencode` writes `.opencode/plugin/mns.js` (project-scoped) — a graceful shim that, on `session.created` / `session.idle` (/ `session.deleted`), spawns `node <mns> hook <event> --host opencode --session <id>` detached (never throws into OpenCode). `mns disable --host opencode` removes it.
- The hook handler (`mns/commands/hook.mjs`) was generalized host-agnostically: `open`/`turn`/`end` map across `{SessionStart,Stop,SessionEnd}` (Claude) and `{session.created,session.idle,session.deleted}` (OpenCode). The capture `ref` is the transcript path for Claude, the `sessionID` for OpenCode (its adapter re-reads the SQLite store). Spawns the real `node` (not bun) so `node:sqlite` works.

### Verified (live, real data)

`mns enable --host opencode` → `opencode run "…bash…"` → **`mns status` showed the session captured live as `active`** (1 turn / 1 tool), with no manual `mns capture`. Disable cleanly removes the plugin.

### Honest limits

- **Same lazy-end constraint as Claude** — no clean end signal; a finished/killed OpenCode session reads `active` until `mns doctor` reconciles it.
- `session.idle` re-captures each turn (idempotent, fast; a debounce is a later optimization).
- The plugin spawns one detached `mns` per lifecycle event — fine (lifecycle events are few), and deliberately *not* wired to `tool.execute.*`/`message.part.updated` (those fire many times per turn).



---

### Conclusions

**Verdict: confirmed — MNS works as a live OpenCode plugin.** A real `opencode run` was captured live (status `active`, no manual `mns capture`) through a `.opencode/plugin/mns.js` shim that fires the host-agnostic mns hook on OpenCode's bus events. The Phase-2 lifecycle model generalized to a second host with no core change — only the hook handler's event-name map and capture `ref` differ per host.

### What worked

- **Observe-before-wire paid off again.** Logging real events first corrected two wrong assumptions: `session.idle` is per-turn (not end), and `session.deleted` is delete-only (not normal completion). Had I wired from the docs, the lifecycle would have been wrong *and* I'd have shipped a false "cleaner than Claude" claim (which I'd already written and then corrected).
- **Design B held.** The plugin is a thin signal shim; all capture is the existing `opencode adapter → eventsToSpans → OTLP` path. Nothing about spans lives in the plugin.
- **Host-agnostic hook handler.** `open/turn/end` normalized across Claude and OpenCode; the only host-specific bit is the capture ref (transcript path vs sessionID). Claude's live tests still pass unchanged (50 total).
- **Graceful + correct runtime.** The plugin spawns the real `node` (not OpenCode's bun) so `node:sqlite` works, detached and try-wrapped so it can never break OpenCode.

### Honest limits / corrections

- **OpenCode is a peer, not a superior, live host.** Same no-clean-end constraint as Claude; killed/finished sessions reconcile via staleness (`mns doctor`). The earlier README claim was corrected.
- **Lazy end detection** (next `mns doctor`), per-turn re-capture on `idle` (idempotent), one detached spawn per lifecycle event (lifecycle events only — never per tool).
- Verified on a single-turn `opencode run`; multi-turn interactive + a killed-then-reconciled OpenCode session are the next checks.

### Strategic upshot

The "MNS as an OpenCode plugin" half of the DESIGN §6 (`docs/DESIGN.md`) strategy is now **real and verified** — the basis for OpenCode-as-default-host. The **credits** half (gateway vs Zen-reseller) remains a flagged, unbuilt business decision.

### Next

- Multi-turn + killed-session reconcile for OpenCode (parity with the Claude checks).
- The deferred harvest of the trace core + adapters into `app/`.
- The first eval lens over captured sessions (the evolution engine — the actual differentiator).

---

## Experiment 5 — the faculty home (`mns init`)

> Day 1 built **observe** (traces). This builds the first slice of **serve**: an opinionated, on-disk home for the agent's faculties, scaffolded git-style by `mns init`. It is the design’s §6 *filesystem serving surface* (`docs/DESIGN.md`) (the smfs model) made concrete — the host agent reads its faculties with its own Read/Grep tools, zero MCP.

### Hypothesis

The filesystem is a sufficient first faculty-serving surface: scaffold `knowledge/ memory/ actions/ instructions/` under `.mns/`, point the host agent at them via an injected instruction-file block, and the agent will actually read and follow them.

### The opinionated layout (v1)

```
.mns/
  mns.json        manifest {version, initializedAt, layout}
  knowledge/      semantic — what's TRUE (entity resolution's target, next)
  memory/         episodic — what HAPPENED (curated from traces/)
  actions/        procedural — named runbooks/skills
  instructions/   cognition steering + guardrails (merged in v1 — advisory text;
                  no enforcement runtime yet, kept conceptually separable)
  sessions.json / traces/ / live/   (observe layer, day 1)
```

Mapping to the faculty model: 4 us-owned faculties get folders; **Cognition is host-owned** so it gets *steering* (the injected block + `instructions/`), not a folder of its own; **Workspace** = the project root itself; **Model** = the host's.

### Git-init semantics (the contract)

| State | Behavior |
|---|---|
| empty dir | greenfield: full scaffold + create `AGENTS.md`+`CLAUDE.md` with the faculty block |
| project, no `.mns/` | brownfield: scaffold + **inject** the block into existing CLAUDE/AGENTS/GEMINI.md (user text untouched); append `.gitignore` lines |
| `.mns/` exists | **"Reinitialized"**: create missing pieces only — byte-identical no-op on a complete home; user edits to seeds always survive |

Injection is delimiter-blocked (`<!-- >>> mns:faculties:v1 >>> -->` … `<!-- <<< mns:faculties <<< -->`), versioned, replace-own-block-only — the supermemory coexistence pattern. Removal (`mns deinit`) is future work; the block is hand-deletable.

### What this forced (a real conflict caught)

`mns enable`'s Claude hook install wrote `permissions.deny: Read(./.mns/**)` (entire's no-feedback-loop rule). With faculties under `.mns/`, that would have **blocked the agent from its own knowledge**. The deny is narrowed to `Read(./.mns/traces/**)` + `Read(./.mns/live/**)`, with migration of the legacy blanket rule on the next `enable`/`disable`.

### Where the code lives

Product surface, in `mns/`: `scaffold.mjs` (layout contract + no-clobber plan/apply), `inject.mjs` (pure block injection), `commands/init.mjs` (mode detection), `commands/doctor.mjs` (home check). Tests: `tests/unit/{scaffold,inject}.test.mjs`, `tests/regression/init-modes.test.mjs` (drives the real binary in temp dirs).

### Honest limits

- **The serving hypothesis is only half-proven.** Scaffold + injection are verified (65 tests, three modes byte-exact). The *other half* — a live host agent actually reading `knowledge/` and following `instructions/` because the block told it to — needs a real session in a scaffolded project. **Remaining proof, same pattern as exp-2/4.**
- Guardrails here are **advisory text**, not enforcement — v1 honesty; the gate pipeline comes later.
- Faculty folders are seeded contracts, mostly empty — entity resolution (next) is what starts filling `knowledge/`.

---

### Conclusions

**Verdict so far: the git-init contract holds.** `mns init` is context-aware (greenfield / brownfield / reinit), idempotent (second run = byte-identical, regression-asserted via filesystem snapshot), and never destructive (user edits to seeded files and to instruction files survive every re-run). 65 tests pass; all three modes verified through the real binary in temp dirs.

### What worked

- **Plan/apply split** (`planScaffold` → `applyScaffold`) made no-clobber trivial and testable: apply only ever creates what plan says is missing.
- **Versioned delimiter blocks** for instruction files: re-inject replaces only our block (any older version), so upgrading the steering text later is one version bump — user prose is never touched.
- **Rooting init at the git toplevel** (same base the store uses) avoids the two-homes bug when run from a subdirectory.
- **The deny-rule catch.** Designing serve *after* observe surfaced a real conflict (blanket `.mns` deny would starve the faculties); narrowed + legacy-migrated, with tests.

### Honest limits / open

- **Serving is not yet proven end-to-end** — no live agent session has been observed reading `knowledge/` because the block pointed it there. That's the next dogfood check (run a real session in a scaffolded project; watch the trace for Reads of `.mns/knowledge/`). Until then this is verified scaffolding, asserted-not-proven serving.
- Greenfield "onboarding" is 3 lines of next-steps, not an interactive wizard — deliberately minimal until real usage says what's needed.
- `instructions/` merges guardrails (advisory) — enforcement is future; don't mistake the text for a gate.
- No `mns deinit` yet (block + home removal); hand-deletable meanwhile.

### Next

- **Entity resolution** (the day-2 headline): the pipeline that distills sessions/sources into `knowledge/` — the first *content* for the scaffolded home, and the quality gate for the whole memory stack.
- The live serving proof above; then MCP as the second serving surface for hosts where files are weak.

---


## Experiment 6 — the Guardrails gate (and the 5+3 taxonomy)

> **Correction to experiment 5 (2026-06-10):** exp-5 merged guardrails into `instructions/` as advisory text "until an enforcement runtime exists." Superseded — the taxonomy was rethought (see below) and the enforcement runtime now exists; `.mns/guardrails/` is a first-class faculty surface. New scaffolds get it; existing homes gain it on re-init (no-clobber).

### The taxonomy rethink (brainstormed, adopted)

Stress-testing "7 faculties, 4/3" against an operational definition (us-owned · contents accumulate from traces · graduate via proposals · pinned in generations · served) found one gap and one inconsistency:
- **Gap:** the pinned `system_prompt`/steering artifact passed every faculty test but had no faculty name → promoted as **Instructions** (directive; cognitive analog: self-schema/values).
- **Inconsistency:** Cognition/Model/Workspace are a process/engine/arena, not faculties → reframed as **host anatomy**.

Canonical now (**DESIGN §3①**): **5 faculties** (Knowledge · Memory · Actions · Instructions · Guardrails) **+ 3 host anatomy**. The five map cleanly to cognitive systems (semantic/episodic/procedural memory, self-schema, inhibitory control). The `mns init` scaffold now matches 1:1.

### Hypothesis (the build half)

Guardrails can be a *built, enforced* faculty today — not advisory text — using Claude Code's `PreToolUse` hook as the gate.

### What was built

- **Rules as data:** `.mns/guardrails/rules.json` — `{id, action: deny|ask|allow, tool, pattern, reason}`, ordered, declarative; seeded conservatively (root-wipe deny, secret-read deny, force-push ask). A *definition*: versioned in git, pinned like everything else.
- **The gate:** `mns enable` now also installs `PreToolUse` → `mns hook PreToolUse` evaluates the call and prints the **verified** decision schema (`hookSpecificOutput.permissionDecision: deny|ask` + reason); silence = defer to the host's normal flow. `ask` is the v1 `RequireApproval`.
- **Severity wins** (deny > ask > allow) — file order can never silently disarm a deny.
- **Fail-open everywhere:** malformed rules, bad regex, missing file, garbage stdin → no decision, exit 0. A guardrail bug must never brick the agent. Verified by tests.
- **Observed:** matched decisions append to `.mns/live/guardrails-<session>.jsonl` — the GUARDRAIL-span precursor (the safety trail joins the trace later).
- **Block v2:** the injected faculty block bumped to v2 (mentions the enforced gate); `mns init` learned **version-aware re-injection** (upgrades a v1 block in place — first real use of the versioned markers).

### Verified

Schema checked against the hooks docs *before* wiring (real-wire-data rule); end-to-end through the real binary in a scaffolded temp project: root-wipe → `deny` JSON, force-push → `ask`, benign → silence, all exit 0; decisions logged; 74 tests pass (engine unit + gate regression + v2 upgrade).

### Honest limits

- **Not yet observed firing in a live agent session** (the gate ran against piped payloads + the real binary, not a real Claude turn) — the remaining proof, same pattern as exp-2/4/5.
- Pattern-matching over stringified tool input is v1 coarseness — no structured per-field matching, no input *rewriting* (`updatedInput` exists in the schema; unused).
- Claude Code only; OpenCode's `tool.execute.before` is the next rung. The full inspector pipeline (PII/injection/moderation, output side) remains design.
- The gate sits on the hot path (every tool call spawns node) — fast in practice; measure before optimizing.

## Experiment 7 — Knowledge substrate + entity resolution (issue #6 · v0.2)

### Hypothesis

The Knowledge faculty can be real on day one — items with **text + attributes + typed relations + provenance**, registry-governed, searchable three ways (SQL · graph · semantic) — with candidates flowing from real sessions through **entity resolution** and a **human gate**, all zero-dep and local-first.

### What was built

- **Files as truth, SQLite as the index** (the AGE pattern, zero-dep): canonical items are git-diffable markdown (`.mns/knowledge/items/`); the derived `index.db` (`node:sqlite`, git-ignored, regenerable) serves lexical search, attribute/type filters (SQL), graph traversal via recursive CTEs, and a vector store. This is the substrate ladder's L0→L1 in one move — Cypher *syntax* arrives only at the real AGE rung.
- **Registry governance** (refined from the Notes vault): types/attributes/relations with value validation and relation **inverses**; where Notes silently auto-registers keys at ≥3 uses, here repeated unknown keys file a **registry proposal** — the human gate covers the schema too.
- **Entity resolution** (mechanical v1): exact/slug id → same-type stemmed-token fuzzy + shared-attribute corroboration → `new | duplicate | enrich`, biased toward `new` (a false duplicate silently loses knowledge; a false new is just a reviewable proposal). `enrich` merges without overwriting.
- **Proposals** — the first build of DESIGN's Proposal entity, as files with evidence; resolved ones archive (auditable). **`mns review`**: interactive y/n/e/s/q gate; `mns proposals` for non-TTY.
- **Two candidate sources**: `mns distill` (mechanical miners over real host transcripts: recurring commands, hot files, failing tools — our OTLP traces carry byte-sizes only by privacy design, so mining reads the host log directly, on-machine) and the **agent inbox** (faculty block v3: agents propose one fact per file in `knowledge/inbox/`, never write items directly).
- **Embeddings**: ollama-if-present (optional local service; no npm deps, no keys); absent → semantic search honestly unavailable.

### Verified

95 tests (round-trip grammar, registry validation, deterministic reindex, CTE traversal, ER goldens incl. the duplicate-vs-enrich boundary, proposal lifecycle, registry-proposal flow, piped review through the real binary, miner goldens). **Real data:** `mns distill --all` over this repo's 29 real sessions → 23 evidence-backed proposals — the hot files are genuinely this repo's hot files, the failing-tool facts match lived experience. Smoke caught two real bugs pre-test: a readline-pipe race in `mns review`, and an ER threshold sunk by morphology (fixed with a light stemmer).

### Honest limits

- ER is mechanical: same-type constraint + token overlap — cross-type near-dupes and paraphrases land as `new` for the human to merge; an LLM-judge pass is a later, separate rung.
- The distill miners are Claude-Code-only v1 (richest transcript); other hosts need per-host miners.
- Semantic search requires a local ollama; un-embedded until then (the vector tier is earned, not faked).
- The 23 real proposals from this repo await the actual human gate — approval is the user's, by design.

## Experiment 8 — live-fire: the faculties served to a real host session (2026-06-10)

### Hypothesis

The whole 0.2.0 loop holds against a *real* Claude Code session in a fresh arena: knowledge is **served** (the agent answers from `.mns/knowledge/`, not by re-deriving), the **inbox** contract is followed, and the **gate** enforces deny/ask in-session — with lifecycle capture running invisibly underneath.

### Setup

Fresh arena `~/Documents/mns-livefire-2` (tiny npm project + decoy `.env`), `motorsandsensors@0.2.0` **from the npm registry**, then `mns init` → `mns remember` ×2 → `mns enable`; a **local bare repo** as `origin` so the force-push test can't touch anything real.

**Honest mode caveat:** the four prompts ran **headless** (`claude -p`, agent-driven at the user's request), not interactive — scoped `--allowedTools` only, no permission bypass. This validates the *mechanics*; the interactive-first UX claim (the `ask` prompt actually prompting a human) remains unexercised: in headless, `ask` surfaces as a block carrying the guardrail's reason (no TTY to prompt). Six sessions total; all captured `completed` via SessionStart/Stop/SessionEnd firing in print mode, linked to commit `1d13930`, tool/error counts correct.

### Results — 4/4 behaviors proven, with two findings the lab tests couldn't have produced

1. **Serving ✅** — "What do we know about this project's test command?" → answered `npm test` *citing the knowledge base*. Transcript evidence: the session's only `Read` was `.mns/knowledge/items/the-test-suite-runs-with-npm-test-….md`; it never opened `package.json`. (Span attributes carry byte-sizes only by privacy design — target evidence comes from the host transcript, same as exp-7's miners.)
2. **Inbox ✅** — "Note down for the future: releases must always be tagged…" → one file appeared in `knowledge/inbox/`, `items/` untouched, and the agent *explained the review gate unprompted*.
3. **Gate deny ✅, with a finding** — first attempt: the agent **self-censored** — it read `rules.json`, declined politely, and never issued the tool call (no decision logged). The steering block preempted the gate; good behavior, but it means a compliant model can make the gate look proven when it isn't. Re-run instructing an actual attempt: `Read(.env)` → in-session error `guardrail no-secret-reads: secret material should not enter the context`, deny appended to `live/guardrails-<session>.jsonl`. **The reason in the refusal is the gate's, verbatim.**
4. **Gate ask ✅ engine / ❌ seeded rule — a real bypass found.** Asked plainly to force-push, the agent ran `git -C /path push --force-with-lease origin main` — and the seeded pattern `git\s+push\s+.*--force` requires `push` adjacent to `git`, so **the `-C` flag walked straight past the gate** and the push executed (harmless: local bare origin, already up-to-date). Re-run with exact `git push --force origin main`: gate fired, `ask` logged (`confirm-force-push`), command blocked with the guardrail's reason, nothing pushed. Verdict: the *engine* evaluates/logs/blocks correctly; the *seeded rule* is too narrow. Fix queued: pattern → `git\b.*\bpush\b.*--force` (catches `-C`, `--work-tree`, also `--force-with-lease`) + a regression test pasted from this real bypass.

### Conclusions

- The faculty loop is live end-to-end on the published package: steer → serve → propose → enforce → observe, in real host sessions.
- **Live-fire earns its keep**: both findings (steering preempts the gate; `git -C` bypass) are invisible to piped-payload tests — they came from a real model making real choices. The bypass is now a pasted-from-reality regression case, per the golden-ids convention.
- Still open: the same script driven **interactively** by a human (the `ask` → real permission prompt path), and the OpenCode twin of this arena.

## Experiment 9 — the session contract: grounded sessions on Claude Code (2026-06-10)

### Hypothesis

The efficiency corollary (DESIGN §2) needs a concrete first move: a session that **opens grounded** — the agent receives a deterministic faculty brief at start instead of re-deriving context every turn — should make the faculty value visible *and* cheap. Built as an opinionated session contract on Claude Code's official `SessionStart`/`PreToolUse` hooks, designed host-agnostic so Gemini/Codex/OpenCode/pi become delivery tiers later (Spec 1 of the Stage-1 wrapper).

### Host-mechanism survey first (real-docs, June 2026)

Before building, surveyed all five hosts' *official* faculty mechanisms (parallel research agents, doc-cited). Findings that shaped the design:
- **Every host now ships a hook surface** that can inject context at start, signal lifecycle, and gate tool calls — Claude Code (`SessionStart` `additionalContext` + `PreToolUse`), **Gemini CLI** (11-event system incl. `BeforeTool`), **Codex** (`SessionStart`/`PreToolUse` + `systemMessage`), OpenCode (`tool.execute.before` + `chat.system.transform`), pi (`before_agent_start` + `tool_call` block). DESIGN's "thinner on Gemini/Codex" assumption is **outdated** — both have full hook systems now (docs-verified, *not yet real-wire-verified* — staged accordingly).
- **`SKILL.md` is a cross-host Agent-Skills standard** (Claude/Gemini/Codex/pi all consume it; Codex+pi share `.agents/skills/`) → recorded as the runbook substrate for the Actions faculty (Spec 2).
- **No host has a real knowledge substrate** (Codex Memories is closest, off-by-default + geo-restricted) — our registry-governed, provenance-carrying, gated store stays the differentiated core; hosts give us *serving* surfaces, not competing substrates.

### What was built (Spec 1, 16 commits, subagent-driven TDD)

- **`mns digest`** (`mns/digest.mjs`, pure/deterministic/zero-network/no-model) → `{ text, sections }`: Instructions (the steering, or an **interview directive** when `project.md` is still the placeholder — empty `.mns` becomes a conversation the agent starts), Knowledge (newest-first, capped, `renderedCount`), Proposals (pending-only, conditional), Guardrails (rule count + "refusals are policy"). **Fail-soft per faculty** (one broken faculty never sinks the brief); priority-ordered budget truncation (Instructions + Guardrails never dropped). CLI: `mns digest [--json] [--budget N]`.
- **`SessionStart` injection** (`mns/commands/hook.mjs`): the hook now also emits the digest as Claude's `{ hookSpecificOutput: { hookEventName, additionalContext } }`. **Fail-open, exit 0 always.** Capture and digest emit live in **independent** try/catch blocks — a capture (`openLive`) throw can't suppress the digest, and vice-versa (the one defect the two-stage review caught; the helper alone wasn't enough).
- **Faculty block v4** (`mns/inject.mjs`): rewrote the directory-listing block into the three-ritual **contract** — *ground* on the digest (don't re-derive), *cite* in-flight (`from knowledge: <id>`), *harvest* at close (one-fact files → `knowledge/inbox/` → `mns review`). Ships via the exp-6 version-aware in-place upgrade (v3→v4, no clobber).
- **First-run polish**: `doctor` (git-absence is neutral info, never "all good" under warnings), `status` (this-project block first, machine inventory below), `recall` (honest no-items-vs-no-matches), `init` (digest hint).

### Verified

112 tests pass (was 96; +16: digest sections/budget/json, hook fail-open + capture/digest independence, block-v4 upgrade, doctor summary, recall empty-state). Playground 4/0/0. **Dogfood on this repo: the digest is ~456 chars ≈ 114 tokens** — and it honestly reports this repo's own state (instructions empty → interview directive, 23 pending proposals, 3 guardrail rules, 0 knowledge items). End-to-end smoke through the real binary: a `SessionStart` with a bogus transcript path emitted the full digest JSON and exited 0 — proving capture-failure/digest independence on the wire.

### Honest limits

- **Not yet observed in a real interactive Claude turn.** Verified via unit tests + the real-binary smoke (piped payload), not a live `claude` session reading the injected `additionalContext` — the same remaining-proof pattern as exp-2/4/8. The interactive-first UX claim stays unproven until that run.
- **Claude Code only.** The digest is host-agnostic by construction, but Gemini/Codex/OpenCode/pi delivery needs each hook surface *observed* before wiring (real-wire-data rule — the survey is docs-only).
- **Harvest is steering-led, not mechanical.** `SessionEnd` fires too late to prompt the model, so close-out quality rides the contract (exp-8: steering is strong but soft). Mechanical close-out (`SessionEnd` auto-distill) is the queued next slice.
- The Knowledge salience heuristic is cheap (newest-first), not semantic — semantic ranking on the hot path is a later rung.
- The Actions index section is **intentionally deferred to Spec 2** (the actions engine); the digest's `sections` shape leaves an additive seam for it.

### Conclusions

- The efficiency thesis now has a measured number to point at: deterministic grounding for ~114 tokens, versus an agent re-reading faculty files every session. The observe layer can A/B this against bare setups — the corollary's benchmark gets its instrument.
- **Two-stage review earned its keep again**: spec-then-quality caught a real fail-open defect (shared try/catch on the hook path) that all unit tests passed through — exactly the class of bug that bricks a host in production.
- Spec 2 (the Actions engine — `mns act`, manifest + JSON-Schema, progressive disclosure, MCP-converter bridge, borrowing pi's info-architecture and zuzuu `_labs`' contract patterns *without their runtimes*) is specced and plugs into the digest's Actions seam.

## Experiment 10 — the Actions faculty: a script-powered tool collection + its crystallization gate (2026-06-10)

### Hypothesis

The Actions faculty can be *extremely efficient* for a filesystem-based local workspace — runnable scripts the agent invokes by name, served by progressive disclosure (token-cheap), convertible to MCP/OpenAI/Anthropic tool defs for free — **and** it can graduate the same way Knowledge does: agent proposes → human gate → activate. All zero-dep, observe-not-drive, host-safe. (Spec 2, built as Plan 2a = the engine, Plan 2b = the crystallization gate.)

### Borrowed information architecture (not runtimes)

Surveyed two real tool-infra sources and lifted *patterns*, not their execution models (both **drive**; mns must not):
- **pi** (badlogic/pi-mono): progressive disclosure (index in context, body read on demand — "no loader tool, ride the host's read"), registered-vs-active, throw-to-fail, result-as-patch (content vs details), `prepareArguments` forward-compat, manifest-driven bundles.
- **zuzuu `_labs`** (a real Python/TS tool sandbox): JSON-Schema-as-single-truth, the strict `main(args) → object` entry contract, preamble/postamble result-marker extraction, OpenAI/Anthropic/MCP converters, depth-counter composition.

**The canon reconciliation (the central decision):** the host's own Bash runs the script; **`mns act` only dispatches + validates**. `mns act <slug>` is the same category of agent-invoked CLI as `mns recall` — never a driver of the agent loop. Consequences, all free: every action call is an observable span; it already passes the guardrails gate (it's a Bash command); zero-dep (a hand-rolled JSON-Schema-subset validator, not Ajv).

### What was built

**Plan 2a — the engine.** `mns/actions/`: `schema.mjs` (zero-dep JSON-Schema-subset validator: validate / validateInputs(merge defaults) / validateOutputs(the object contract)); `manifest.mjs` (`action.json` loader + `listActions(baseDir)` classifying `script` vs the cross-host `SKILL.md` `runbook` standard); a spawn-isolated runner (`runner.mjs`, never imported — `marker.mjs` holds the sentinel) + `dispatch.mjs` (`runAction`: prepare→validate→`main`→validate→emit `__MNS_ACT_RESULT__` marker; **timeout + depth-cap + anchored stdout-only marker + log truncation**); `convert.mjs` (manifest → MCP/OpenAI/Anthropic — the DESIGN §6 "Actions over MCP" bridge, zero rework). CLI `mns act list|show|run|new|schema` with path-traversal-safe slugs. The digest gained an `## Actions` section (progressive disclosure: slug · snippet only).

**Plan 2b — the crystallization gate.** `actions/inbox/` scaffolded; `inbox.mjs` (`activateAction` moves inbox→active, conflict- + manifest-guarded, **never auto-activates**; `rejectAction`); `mns act propose` (agents scaffold into the inbox) + `mns act inbox|approve|reject` (non-interactive gate); **`mns review` gained an actions pass** sharing the knowledge gate's piped-stdin line-queue (one gate, both faculties); faculty block **v5** steers agents to propose actions; A7 **fail-soft outcome trail** (`.mns/live/actions.jsonl`) — the "details" side of pi's result-as-patch.

### Verified

163 tests (validator goldens incl. array/nested/enum; dispatch happy + every error path + depth-cap + prepareArguments + marker-survival; converters; inbox activate/reject/conflict/malformed/unsafe-slug; the **actions+knowledge composition test** — one piped stdin driving both review passes; trail fail-soft; block v5 upgrade). Playground 4/0/0. **Dogfood:** a real `run-tests` action runs `npm test` and returns a validated `pass N / fail 0` (Plan 2a); and the full **propose → `mns review` (y) → activate → run → trail → digest** loop, end-to-end through the real binary (Plan 2b).

### What the two-stage review caught (invisible to happy-path tests)

- **No spawn timeout** — a runaway action would hang `mns act`, hence the host turn (a direct "never break the host" violation). Added `timeout` + `res.error`/`res.signal` mapping.
- **stderr marker-spoofing** — the parser scanned stdout+stderr, so an action's `console.error('__MNS_ACT_RESULT__…')` could inject a fake result. Fixed: scan **stdout only**, anchored at line start.
- **Path traversal** — `mns act new ../../x` escaped `.mns/actions/`. Fixed: `isSafeSlug` at the CLI layer *and* inside the lib (`scaffoldAction`/`activate`/`reject`), so containment doesn't depend on the CLI alone.

### Honest limits

- **Not yet observed firing in a real interactive host turn** — verified via unit/integration tests + real-binary smoke (the same remaining-proof caveat as exp-8/9). An agent actually choosing to `mns act` mid-session, and the MCP-served path, are unexercised.
- **Claude Code only in practice**; the SKILL.md runbook kind is cross-host by standard, but other hosts' action-serving is unwired (real-wire-data rule).
- **Secrets/sandboxing out of scope** — actions inherit the host shell env in v1 (same trust as the agent); no secret vault, no isolation beyond the spawned process + timeout.
- **ER for actions is by-slug only** — no dedup of near-duplicate proposed actions; an LLM-judge pass is a later rung. The review summary counts knowledge outcomes, not action outcomes (per-item logged, no aggregate).
- **The dogfood `run-tests` action runs the full suite in a child** — fine for a demo, not a latency-optimized executor (the `_labs` persistent-executor daemon was deliberately not borrowed).

### Conclusions

- The Actions faculty is real and graduating: author-or-propose → gate → serve → run → observe, zero-dep and host-safe. The manifest authored once for `mns act` is also an MCP/OpenAI/Anthropic tool def — the Stage-2/OpenCode bridge exists before Stage 2 does.
- **Crystallization is now built, not just asserted** (DESIGN's "Actions crystallization = the same governed pipeline as Knowledge"): the same `mns review` gate, the same inbox→human→activate shape, kept deliberately *out* of the knowledge ER/registry machinery.
- Three of the project's load-bearing invariants were enforced under adversarial review — never-break-the-host (timeout), result integrity (anchored stdout marker), and containment (slug guard at both layers) — none of which the happy-path tests would have caught.

## Experiment 11 — Gemini CLI + Codex: live capture + the guardrails gate (2026-06-10)

### Hypothesis

The Stage-1 wrapper gap closes: bring Gemini CLI and Codex up to live-capture + enforced-gate parity with Claude Code and OpenCode — `mns enable --host gemini-cli|codex` installs each host's native lifecycle + pre-tool hooks, Design B unchanged. **The real-wire-data rule governs:** no event mapping or gate code written from docs; observe each host's actual hook payloads first.

### Method — probe-first (Phase 0 → Phase 1)

A throwaway `mns/live/probe.mjs` recorded exactly what each host hands a hook (argv + stdin + cwd). Installed per-host for every candidate event; sessions run for real; captures committed as golden fixtures (`tests/fixtures/hooks/{gemini-cli,codex}.probe.jsonl`). **The plan was written *from* the captures**, never the docs.

### Phase-0 findings (real-wire — several contradict the docs)

- **Gemini CLI** — fires hooks **headless and interactive**; **project-level `.gemini/settings.json` is honored** (docs were silent). Events: SessionStart(open) · BeforeAgent/AfterAgent(turn) · BeforeTool(gate: `tool_name`+`tool_input`) · AfterTool · **SessionEnd (a clean end** — rarer than Claude/OpenCode). Payload = stdin JSON, Claude-shaped (`session_id`, `transcript_path`, `hook_event_name`). Block = stdout `{decision:"deny",reason}` (exit 0).
- **Codex** — **`codex exec` (headless) fires NOTHING**: not hooks (repo-local *or* global config.toml), not `notify` — proven three ways. Hooks are **interactive-TUI-only** in 0.138.0. Interactively, all fire: SessionStart(open) · UserPromptSubmit/Stop(turn) · PreToolUse(gate) · PostToolUse. Payload = stdin JSON, essentially Claude-identical (`session_id`, `turn_id`, `transcript_path` = the rollout JSONL, `tool_name`="Bash", `tool_input`). **Block schema is byte-identical to Claude's `hookSpecificOutput`.** Interactive honors **repo-local `.codex/hooks.json` alone** (the #17532 "repo-local ignored" bug is exec-specific). No clean end (Stop is per-turn) → staleness reconcile, like Claude.
- **Probe bug found + fixed:** a blocking `readFileSync(0)` hung Codex hooks for 36 min (Codex leaves stdin open; Gemini closes it). Fix: read stdin only when fd 0 is a pipe/file.

### What was built (Phase 1 — 6 wiring commits, from the captures)

- **`toGeminiDecision`** (`guardrails.mjs`) — Gemini's `{decision:"deny",reason}` block shape; Codex/Claude reuse `toPreToolUseDecision` unchanged (identical schema).
- **`hook.mjs`** — TURN gains `AfterAgent`(gemini)+`UserPromptSubmit`(codex); `runHook` parses stdin JSON for claude/gemini/codex (opencode stays `--session`); per-host capture `ref` (gemini derives `logs.json` from `transcript_path`; codex/claude use `transcript_path` directly; opencode=id); `gateDecision({host})` routes both `PreToolUse`+`BeforeTool` with the per-host serializer, fail-open, logs `{host,…}`.
- **`install.mjs`** — extracted host-agnostic `addHookEntries`/`removeHookEntries` (the `{hooks:{Event:[…]}}` shape is shared across all three).
- **`enable.mjs`** — `mns enable/disable --host gemini-cli` (project `.gemini/settings.json`, events SessionStart/AfterAgent/SessionEnd/BeforeTool) + `--host codex` (repo `.codex/hooks.json`, SessionStart/Stop/PreToolUse); generated configs git-ignored.
- **Bug fixed (pre-existing, all hosts):** `SIGNATURE='mns.mjs hook'` never matched the real *quoted* command `node "…/mns.mjs" hook …`, so re-enable duplicated hooks and disable was a no-op — for Claude too. Now `SIGNATURE='mns.mjs'` (quote-agnostic), with a regression test using the real quoted form.

### Verified — both hosts, end-to-end (real sessions)

172 hermetic tests (incl. the golden fixtures, per-host gate serializers, event mapping, idempotent install). **Dogfood, real hosts:**
- **Gemini** (headless, self-served): live session captured via the mns hooks (`f82fafcb` in the arena index); the gate **blocked** a `read_file` on a gated file — model reported *"blocked by an mns guardrail (block-notes)"*, decision logged `{host:"gemini-cli",tool:"read_file",action:"deny"}`. (SessionStart digest injection also fired — the model noticed the empty `project.md`.)
- **Codex** (interactive, user-run): live session captured (`019eb241` + trace blob) via repo-local `.codex/hooks.json` **alone**; the gate **blocked** a Bash read, logged `{host:"codex",tool:"Bash",action:"deny"}`.

### Honest limits

- **Codex live/gate are interactive-only** — `codex exec` fires no hooks/notify in 0.138.0. This fits interactive-first canon (it's not a compromise), but headless Codex gets post-hoc `mns capture` only.
- The first Gemini `.env` attempt **self-censored** (the exp-8 pattern) — a compliant model can mask whether the gate fired; the clean test used a neutrally-named gated file to force the tool call. Gate enforcement is real, but "did the model even try" is a confound to watch.
- Gemini capture still uses the prompt-only `logs.json` adapter (the richer per-session `chats/*.json` transcript with tool calls is a later capture-depth rung, deliberately out of scope).
- Codex "ask"-action rules: Gemini has no `ask` decision → `toGeminiDecision` defers ask to Gemini's own approval (only `deny` hard-blocks).

### Conclusions

- All **four** hosts now have live capture; **all four** have an enforced PreToolUse-equivalent gate (Claude, OpenCode, Gemini, Codex). The Stage-1 wrapper is no longer "thinner on Gemini/Codex" — it's parity, host-honestly scoped (Codex interactive-only).
- **The real-wire-data rule paid for itself five times:** project-level Gemini hooks work (docs silent), Codex exec fires nothing (docs implied otherwise), repo-local Codex hooks work interactively (#17532 is exec-only), the probe stdin-blocking hang, and the pre-existing quoted-`SIGNATURE` bug — none visible from docs, all caught by observing + dogfooding real runs.
