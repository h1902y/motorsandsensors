# zuzuu

[![ci](https://github.com/h1902y/motorsandsensors/actions/workflows/ci.yml/badge.svg)](https://github.com/h1902y/motorsandsensors/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/zuzuu)](https://www.npmjs.com/package/zuzuu) [![node](https://img.shields.io/node/v/zuzuu)](package.json) [![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**Give the coding agent you already run an evolving Memory, Knowledge, Actions, and Guardrails — grown from how you actually work.**

Your host agent — Claude Code, Codex, Gemini CLI, OpenCode — supplies the *brain* (the reasoning loop + the model). zuzuu wraps the host you already pay for: it **serves** faculties to it, **observes** every session as an OpenTelemetry trace, and (the end-game) **evolves** the faculties from those traces — human-gated, across versioned generations. We never run a competing agent loop and never drive the host headlessly.

> The CLI is `zuzuu` (package `zuzuu`, v1.0.0); **`mns` still works as a legacy alias** for every command below.

> **Status (honest):** early build, moving fast. **Observe** works (5 real hosts, verified). **Serve** delivers the faculty home (`zuzuu init`), a session digest to every host, an **enforced guardrails gate** on all 5, and five faculties sharing one proposal/review spine. **Evolve** is now **wired and tested** — trace miners → a mechanical eval lens → human-gated `zuzuu review` → versioned **generations** (mint / rollback / drift-check) — but **not yet proven on a real graduation corpus** (the loop runs + passes hermetic tests; it hasn't yet improved an agent from real sessions end-to-end). Full design: [`docs/DESIGN.md`](docs/DESIGN.md).

## What works today

```bash
npm install -g zuzuu   # zero dependencies — installs the `zuzuu` command (`mns` stays as a legacy alias)

# no coding agent yet? one command gives you a fully faculty-equipped one:
zuzuu code        # scaffold the faculty home, install + wire OpenCode, launch it (capture + gate + grounding)

# already run Claude Code / Gemini / Codex / OpenCode / pi? wrap the one you have:
zuzuu init        # scaffold your project's agent home (agent/) — git-style, open
zuzuu explain     # the 5 faculties + how graduation works (you're always in the loop)
zuzuu inbox       # what's pending your approval · zuzuu review to approve/reject
zuzuu capture     # turn your latest agent session into an OpenTelemetry trace
zuzuu trace --last
zuzuu enable [--host gemini-cli|codex|opencode|pi]   # live capture + the guardrails gate
zuzuu doctor      # health + lost-session reconciliation
```

`zuzuu code` is the **bundled-host** path (Stage 2): it detects OpenCode (installs it on first run, with your OK — never an npm dependency, the zero-dep policy holds), wires the zuzuu plugin, and launches the real `opencode` — we configure + launch, never fork or drive it.

| | Claude Code | Gemini CLI | Codex | OpenCode | pi |
|---|---|---|---|---|---|
| post-hoc capture | ✅ rich | ✅ thin | ✅ rich | ✅ rich | ✅ rich |
| live capture | ✅ hooks | ✅ hooks | ✅ hooks¹ | ✅ plugin | ✅ extension |
| guardrails gate | ✅ PreToolUse | ✅ BeforeTool | ✅ PreToolUse¹ | ✅ tool.execute.before | ✅ tool_call |

¹ **Codex is interactive-only** — `codex exec` (headless) fires no hooks (verified, v0.138.0), so live capture + gate work when you run Codex interactively; headless Codex still gets post-hoc `zuzuu capture`.

All five verified against **real sessions** — never fixtures; every host's live capture + gate was wired from **real captured hook payloads** and dogfooded end-to-end ([`experiments/LOG.md`](experiments/LOG.md) exp-11 Gemini/Codex, exp-12 OpenCode/pi). Gate semantics are host-honest: deny hard-blocks everywhere; `ask` maps to a native prompt on Claude, defers to the host elsewhere.

**Prerequisites:** Node ≥ 22 — that's it. You need at least one supported agent you've already used, so a session exists to capture. (Hacking on zuzuu itself? `git clone https://github.com/h1902y/motorsandsensors && cd motorsandsensors && npm link`.)

**`zuzuu init`** behaves like `git init`: empty dir → scaffolds the agent home + `AGENTS.md`/`CLAUDE.md`; existing project → adds `agent/` and injects a small delimiter-marked block into your existing instruction files (your text is never touched); already initialized → restores missing pieces only. The home is **open and self-explaining** — a visible `agent/` dir you can read and version in git: `agent/README.md` (the explainer) · `knowledge/` (verified facts) · `memory/` (curated episodes) · `actions/` (runbooks) · `instructions/` (steering) · `guardrails/` (enforced rules), plus `generations/` (your checkpoints). Machine internals are dot-prefixed + git-ignored (`agent/.traces/`, `agent/.live/`). Legacy `.mns/` projects auto-migrate on the next `zuzuu init` (or `zuzuu migrate --home`).

**Live capture** (`zuzuu enable`) is invisible by design: a minimal lifecycle hook set (Claude Code, Gemini CLI, Codex), a bus plugin (OpenCode), or an extension (pi) — each wrapped so it **always exits 0 / fails open — it can never break your agent**. The same hook carries the guardrails gate, applied in each host's own idiom (Claude/Codex `hookSpecificOutput`, Gemini `{decision:"deny"}`, OpenCode throws from `tool.execute.before`, pi returns `{block:true}` from `tool_call`). Most hosts emit no clean end-signal when a terminal is killed, so `zuzuu doctor` *reconciles* lost sessions afterward from the transcript still on disk (nothing lost).

**Where your data lives:** transcripts are read **read-only**; output is git-native in your repo — `agent/sessions.json` (small tracked index, each session linked to a commit) + `agent/.traces/*.otlp.jsonl` (local, git-ignored). **Nothing is uploaded**; no raw tool input/output on the trace (byte sizes only).

**Verify / troubleshoot:** `npm test` (hermetic) · `npm run playground` (⏭️ skip = that host isn't on *your* machine, not a failure) · `zuzuu doctor` (env + session health). "No host detected" → use a supported agent once in the repo, then retry.

## The idea in one diagram

```
   the host agent (yours)          zuzuu
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
| [`zuzuu/`](zuzuu/) + `bin/zuzuu.mjs` | the CLI — capture, live lifecycle, faculty home (product surface) |
| [`experiments/`](experiments/) | spike code + [`LOG.md`](experiments/LOG.md) — the build journal (hypothesis → real-data proof → conclusions per experiment) |
| [`app/`](app/) | the durable application skeleton (be / run / evolve) — proven code harvests here |
| [`tests/`](tests/) | hermetic unit + regression (`npm test`) + real-data smoke playgrounds (`npm run playground`) |
| [`docs/`](docs/) | [`DESIGN.md`](docs/DESIGN.md) (the canon) + [`inspiration/`](docs/inspiration/) (the research shelf: 100-project survey + 5 audits) |

## How this is built (the method)

**Experiment → prove on real data → conclude → harvest.** Every capability starts as a numbered experiment with a hypothesis; it must be verified against *real* sessions/wire data (never invented fixtures) before it counts; lessons land in the experiment’s Conclusions section; proven parts graduate into `app/`. Built in public — day-by-day on X ([@h1902y](https://x.com/h1902y)).

## License & status

Personal project, early and changing daily. Issues/ideas welcome.
