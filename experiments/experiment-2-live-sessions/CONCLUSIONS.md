# Experiment 2 — Conclusions

**Verdict: hypothesis confirmed.** The session lifecycle can be driven non-intrusively from Claude Code's lifecycle hooks, reusing Experiment 1's capture path unchanged, with lost sessions recovered from the on-disk transcript. The `mns enable → invisible live capture` model works; demonstrated end-to-end through the real binary (synthetic payloads) and covered by 7 hermetic tests.

## What worked

- **Design B was the unlock.** Making the hook a *signal + re-capture trigger* (not a span builder) collapsed the hard part. The cross-process span-correlation problem that defined Exp 1 simply doesn't exist here — we re-parse the whole transcript on each signal, idempotently. The genuinely new code is tiny: liveness records + reconcile + the settings installer.
- **Verifying `SessionEnd` vs `Stop` before wiring saved a correctness bug.** Mapping `Stop`→completed would have "completed" the session every turn. `SessionEnd` (once, with `reason`) is the real end; `Stop` is a per-turn heartbeat.
- **Lost-session recovery is lossless,** because a killed terminal leaves its transcript on disk — reconcile captures the full abandoned session, not a stub.
- **Graceful degradation is real:** every hook command is `… || true` → exit 0; piped events through the binary all returned 0; a missing `mns` can't break the agent.
- **The lifecycle state machine from Phase 1 now actually transitions** (`active → completed`, `→ abandoned`), validated in `tests/regression/live-lifecycle.test.mjs`.

## What we learned / honest limits

- **Detection of kills is lazy** (next `mns doctor`), not instant — unavoidable without a kill signal; entire.io has the same limitation. (`status` only displays.) Documented in QUICKSTART.
- **Shared-index concurrency.** `.mns/sessions.json` writes are atomic (tmp+rename → no corruption), but concurrent upserts from two sessions in one repo can still lose an update. Per-session record files (or locking) is the Phase-3 fix; trace blobs are per-session and unaffected.
- **No real-agent live run yet.** Everything is proven via hermetic tests + piping synthetic payloads through `mns hook`. Enabling on an actual live Claude session (real hooks firing on real turns) is the remaining proof; deferred deliberately to avoid disrupting an in-flight working session.
- **The live record id vs index id can differ** if `payload.session_id` ≠ the transcript's session id. In real Claude sessions they match; worth asserting once during the real-agent run.
- **`Stop` re-captures each turn** — repeated full parse. Fine now (fast, idempotent); a diff/debounce is a later optimization.
- **Claude Code only.** It has the richest lifecycle hooks. Gemini and thinner hosts need a transcript-reconcile fallback (no live signals) — future work.

## What graduates / next

- The live machinery already lives in `mns/` (product), so there's nothing to "harvest" — but the **trace core + Session primitive** (Exp 1 + 2) are now proven enough to move from `experiments/` into `app/evolution/observability/` + `app/runtime/host-adapter/` (the deferred harvest).
- **Next experiments:** a real-agent live run (the remaining proof); git-native traces on an orphan branch `mns/traces` (currently blobs are local-only); Gemini live/checkpoint support; the first **eval lens** over captured sessions (the evolution engine — the actual differentiator).
