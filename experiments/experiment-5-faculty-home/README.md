# Experiment 5 — the faculty home (`mns init`)

> Day 1 built **observe** (traces). This builds the first slice of **serve**: an opinionated, on-disk home for the agent's faculties, scaffolded git-style by `mns init`. It is the README §6 *filesystem serving surface* (the smfs model) made concrete — the host agent reads its faculties with its own Read/Grep tools, zero MCP.

## Hypothesis

The filesystem is a sufficient first faculty-serving surface: scaffold `knowledge/ memory/ actions/ instructions/` under `.mns/`, point the host agent at them via an injected instruction-file block, and the agent will actually read and follow them.

## The opinionated layout (v1)

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

## Git-init semantics (the contract)

| State | Behavior |
|---|---|
| empty dir | greenfield: full scaffold + create `AGENTS.md`+`CLAUDE.md` with the faculty block |
| project, no `.mns/` | brownfield: scaffold + **inject** the block into existing CLAUDE/AGENTS/GEMINI.md (user text untouched); append `.gitignore` lines |
| `.mns/` exists | **"Reinitialized"**: create missing pieces only — byte-identical no-op on a complete home; user edits to seeds always survive |

Injection is delimiter-blocked (`<!-- >>> mns:faculties:v1 >>> -->` … `<!-- <<< mns:faculties <<< -->`), versioned, replace-own-block-only — the supermemory coexistence pattern. Removal (`mns deinit`) is future work; the block is hand-deletable.

## What this forced (a real conflict caught)

`mns enable`'s Claude hook install wrote `permissions.deny: Read(./.mns/**)` (entire's no-feedback-loop rule). With faculties under `.mns/`, that would have **blocked the agent from its own knowledge**. The deny is narrowed to `Read(./.mns/traces/**)` + `Read(./.mns/live/**)`, with migration of the legacy blanket rule on the next `enable`/`disable`.

## Where the code lives

Product surface, in `mns/`: `scaffold.mjs` (layout contract + no-clobber plan/apply), `inject.mjs` (pure block injection), `commands/init.mjs` (mode detection), `commands/doctor.mjs` (home check). Tests: `tests/unit/{scaffold,inject}.test.mjs`, `tests/regression/init-modes.test.mjs` (drives the real binary in temp dirs).

## Honest limits

- **The serving hypothesis is only half-proven.** Scaffold + injection are verified (65 tests, three modes byte-exact). The *other half* — a live host agent actually reading `knowledge/` and following `instructions/` because the block told it to — needs a real session in a scaffolded project. **Remaining proof, same pattern as exp-2/4.**
- Guardrails here are **advisory text**, not enforcement — v1 honesty; the gate pipeline comes later.
- Faculty folders are seeded contracts, mostly empty — entity resolution (next) is what starts filling `knowledge/`.
