# experiments/

The lab. Each experiment is a **numbered, self-contained spike** with a hypothesis. We build the smallest thing that tests it, prove it against real data, then **harvest the good parts into [`../app/`](../app/)** and write down what we learned. Experiments are allowed to be throwaway; `app/` is not.

## The method (spike → harvest → lessons)

1. **Hypothesis** — each `experiment-N-*/README.md` states what we're testing and the success criteria *before* building.
2. **Spike** — build the minimal functional thing. Dead-minimal by default: plain Node `.mjs`, no build step, no deps unless a dependency *is* the thing under test.
3. **Prove** — run it against real on-disk data, not toy fixtures, wherever possible.
4. **Conclude** — `CONCLUSIONS.md` records what worked, what didn't, the **harvest list** (what graduates to `app/` and where), and candidate next experiments.
5. **Harvest** — promote the proven parts into `app/`, leaving the experiment as the record of how we got there.

> An experiment's value is the lesson + the harvest, not the code. Don't polish a spike; conclude it.

## Index

| # | Name | Hypothesis | Status |
|---|------|------------|--------|
| 1 | [trace-capture](experiment-1-trace-capture/) | Host-agnostic, OTel-shaped trace capture via transcript parsing — same core, ≥2 hosts | ✅ proven; harvest pending |
| 2 | [live-sessions](experiment-2-live-sessions/) | Live, invisible session lifecycle from host hooks (`mns enable`); lost sessions reconciled | ✅ proven (real-agent run pending); code in `mns/` |
| 3 | [provider-coverage](experiment-3-provider-coverage/) | Extend host-agnosticity to more providers, validated against **real** wire data (not docs/fixtures) | ✅ Codex + OpenCode (both real); core unchanged → 4 real hosts |

## Conventions

- `experiment-N-<kebab-name>/` — `README.md` (hypothesis) + `CONCLUSIONS.md` (lessons) + the spike.
- `out/` inside any experiment is generated and git-ignored.
- Run from the repo root: `npm run capture`, `npm run inspect -- <file>` (see Experiment 1).
