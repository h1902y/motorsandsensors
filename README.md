# motors & sensors

**Give the coding agent you already run an evolving Memory, Knowledge, Actions, and Guardrails — grown from how you actually work.**

Your host agent — Claude Code, Codex, Gemini CLI, OpenCode — supplies the *brain* (the reasoning loop + the model). motors & sensors wraps the host you already pay for: it **serves** faculties to it, **observes** every session as an OpenTelemetry trace, and (the end-game) **evolves** the faculties from those traces — human-gated, across versioned generations. We never run a competing agent loop and never drive the host headlessly.

> **Status (honest):** early build, moving fast. The **observe** layer and the first slice of **serve** work today and are verified against real sessions. The **evolve** engine — the actual differentiator — is designed, not yet built. Full design: [`docs/DESIGN.md`](docs/DESIGN.md).

## What works today

```bash
git clone https://github.com/h1902y/motorsandsensors.git && cd motorsandsensors
npm link        # zero dependencies, no build — puts `mns` on your PATH

mns init        # scaffold your project's agent faculty home (.mns/) — git-style
mns capture     # turn your latest agent session into an OpenTelemetry trace
mns trace --last
mns enable      # live capture + the guardrails gate (Claude Code hooks / OpenCode plugin)
mns doctor      # health + lost-session reconciliation
```

| | Claude Code | Gemini CLI | Codex | OpenCode |
|---|---|---|---|---|
| post-hoc capture | ✅ rich | ✅ thin | ✅ rich | ✅ rich |
| live capture | ✅ hooks | — | — | ✅ plugin |

All four verified against **real sessions** — never fixtures ([`playground-4`](playground/playground-4-provider-journey/play.mjs)).

**Prerequisites:** Node ≥ 22 and git — that's it (zero dependencies, nothing else installs). You need at least one supported agent you've already used, so a session exists to capture.

**`mns init`** behaves like `git init`: empty dir → scaffolds the faculty home + `AGENTS.md`/`CLAUDE.md`; existing project → adds `.mns/` and injects a small delimiter-marked block into your existing instruction files (your text is never touched); already initialized → restores missing pieces only. The home: `knowledge/` (verified facts) · `memory/` (curated episodes) · `actions/` (runbooks) · `instructions/` (steering + rules).

**Live capture** (`mns enable`) is invisible by design: a minimal lifecycle hook set (Claude Code) or a bus plugin (OpenCode), wrapped so it **always exits 0 — it can never break your agent**. No host emits a clean end-signal when a terminal is killed, so `mns doctor` *reconciles* lost sessions afterward from the transcript still on disk (nothing lost).

**Where your data lives:** transcripts are read **read-only**; output is git-native in your repo — `.mns/sessions.json` (small tracked index, each session linked to a commit) + `.mns/traces/*.otlp.jsonl` (local, git-ignored). **Nothing is uploaded**; no raw tool input/output on the trace (byte sizes only).

**Verify / troubleshoot:** `npm test` (hermetic) · `npm run playground` (⏭️ skip = that host isn't on *your* machine, not a failure) · `mns doctor` (env + session health). "No host detected" → use a supported agent once in the repo, then retry.

## The idea in one diagram

```
   the host agent (yours)          motors & sensors
  ┌─────────────────────┐     ┌──────────────────────────────┐
  │ Cognition · Model · │ ◄── │ SERVE   faculties:           │
  │ Workspace           │     │   knowledge · memory ·       │
  │  (we never drive)   │     │   actions · instructions ·   │
  │                     │     │   guardrails (enforced)      │
  └──────────┬──────────┘     ├──────────────────────────────┤
             │ sessions       │ OBSERVE traces (OTel,        │
             └──────────────► │         git-native)          │
                              ├──────────────────────────────┤
                              │ EVOLVE  eval → propose →     │
                              │         human gate → new     │
                              │         generation  [design] │
                              └──────────────────────────────┘
```

**Five faculties**, each mapping onto a cognitive system — **Knowledge** (semantic: what's true), **Memory** (episodic: what happened), **Actions** (procedural: how to do things), **Instructions** (directive: who the agent is), **Guardrails** (protective: what it must not do — *enforced* on tool calls, fail-open). They improve across **versioned generations**, proposals mined from traces, **always human-approved**. That loop is the product; everything here is a step toward it.

## Repo map

| Path | What |
|---|---|
| [`mns/`](mns/) + `bin/mns.mjs` | the CLI — capture, live lifecycle, faculty home (product surface) |
| [`experiments/`](experiments/) | spike code + [`LOG.md`](experiments/LOG.md) — the build journal (hypothesis → real-data proof → conclusions per experiment) |
| [`app/`](app/) | the durable application skeleton (be / run / evolve) — proven code harvests here |
| [`playground/`](playground/) | real-data smoke checks (pass / skip / fail) |
| [`tests/`](tests/) | hermetic unit + regression suite (`npm test`) |
| [`docs/DESIGN.md`](docs/DESIGN.md) | the canonical design — architecture, decisions, roadmap |
| [`inspiration/`](inspiration/) | the research shelf: a 100-project field survey + 5 source-level audits |

## How this is built (the method)

**Experiment → prove on real data → conclude → harvest.** Every capability starts as a numbered experiment with a hypothesis; it must be verified against *real* sessions/wire data (never invented fixtures) before it counts; lessons land in the experiment’s Conclusions section; proven parts graduate into `app/`. Built in public — day-by-day on X ([@h1902y](https://x.com/h1902y)).

## License & status

Personal project, early and changing daily. Issues/ideas welcome.
