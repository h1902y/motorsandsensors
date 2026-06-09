# playground/

Application-level **smoke scenarios**. Each `playground-N-*/play.mjs` runs an end-to-end scenario against **this machine's real host sessions**, prints a readable narrative, and reports pass / skip / fail. It answers *"did the experimentation actually run, and is everything working on this machine?"* — coarse and integration-level, distinct from [`../tests/`](../tests/), which proves logic hermetically.

```bash
npm run playground            # run all
node playground/run.mjs 2     # run only playground-2
```

## The three-state contract

A playground exercises **real** on-disk data, which may or may not be present. So it has three outcomes, signalled by exit code (see `_harness.mjs`):

| State | Exit | Meaning |
|---|---|---|
| ✅ pass | 0 | scenario ran and every check held |
| ⏭️ skip | 2 | required host data absent — **not** a failure |
| ❌ fail | other | data was present but the pipeline broke |

Skip ≠ fail is the whole point: on a fresh checkout with no host sessions, the playground stays green-by-skip; it only goes red when something that *should* work doesn't. (A genuine crash exits 1, so it still reads as fail — never a false skip.)

## Scenarios

| # | Checks |
|---|--------|
| 1 | [trace-capture](playground-1-trace-capture/) — capture this repo's real Claude session → sane `session→turn→tool` tree |
| 2 | [host-agnostic](playground-2-host-agnostic/) — ≥2 real hosts through the **same core** → both valid; rich-vs-thin contrast |
| 3 | [otlp-validity](playground-3-otlp-validity/) — a captured trace is structurally conformant OTLP/JSON |
| 4 | [provider-journey](playground-4-provider-journey/) — capture→OTLP across the four major hosts; honest real/no-data/no-adapter matrix |

> Playgrounds reuse Experiment 1's `core/` + `adapters/`. Imports re-point to `app/` once that code harvests in.
