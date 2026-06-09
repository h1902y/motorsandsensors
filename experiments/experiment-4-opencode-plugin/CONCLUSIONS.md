# Experiment 4 — Conclusions

**Verdict: confirmed — MNS works as a live OpenCode plugin.** A real `opencode run` was captured live (status `active`, no manual `mns capture`) through a `.opencode/plugin/mns.js` shim that fires the host-agnostic mns hook on OpenCode's bus events. The Phase-2 lifecycle model generalized to a second host with no core change — only the hook handler's event-name map and capture `ref` differ per host.

## What worked

- **Observe-before-wire paid off again.** Logging real events first corrected two wrong assumptions: `session.idle` is per-turn (not end), and `session.deleted` is delete-only (not normal completion). Had I wired from the docs, the lifecycle would have been wrong *and* I'd have shipped a false "cleaner than Claude" claim (which I'd already written and then corrected).
- **Design B held.** The plugin is a thin signal shim; all capture is the existing `opencode adapter → eventsToSpans → OTLP` path. Nothing about spans lives in the plugin.
- **Host-agnostic hook handler.** `open/turn/end` normalized across Claude and OpenCode; the only host-specific bit is the capture ref (transcript path vs sessionID). Claude's live tests still pass unchanged (50 total).
- **Graceful + correct runtime.** The plugin spawns the real `node` (not OpenCode's bun) so `node:sqlite` works, detached and try-wrapped so it can never break OpenCode.

## Honest limits / corrections

- **OpenCode is a peer, not a superior, live host.** Same no-clean-end constraint as Claude; killed/finished sessions reconcile via staleness (`mns doctor`). The earlier README claim was corrected.
- **Lazy end detection** (next `mns doctor`), per-turn re-capture on `idle` (idempotent), one detached spawn per lifecycle event (lifecycle events only — never per tool).
- Verified on a single-turn `opencode run`; multi-turn interactive + a killed-then-reconciled OpenCode session are the next checks.

## Strategic upshot

The "MNS as an OpenCode plugin" half of the README §6 strategy is now **real and verified** — the basis for OpenCode-as-default-host. The **credits** half (gateway vs Zen-reseller) remains a flagged, unbuilt business decision.

## Next

- Multi-turn + killed-session reconcile for OpenCode (parity with the Claude checks).
- The deferred harvest of the trace core + adapters into `app/`.
- The first eval lens over captured sessions (the evolution engine — the actual differentiator).
