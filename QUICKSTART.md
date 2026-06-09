# Quickstart

Turn the coding-agent sessions you already run into **OpenTelemetry traces you own** — local-first, zero-install, host-agnostic. No account, no API key, no server, nothing leaves your machine.

> **Status — honest:** this is **design / experiment stage**. What works today is **host-agnostic trace capture** via the `mns` CLI (reading session logs your agent already writes). The invisible, always-on live capture (`mns enable`) is **planned, not built** — see [Where this is headed](#where-this-is-headed). Nothing here uploads your data.

## What you get today

`mns` reads the transcript your coding agent already wrote and turns it into a tree-shaped OTLP/JSON trace, recorded git-natively in your repo.

| Host | Today | Capture richness |
|---|---|---|
| **Claude Code** | ✅ | rich — `session → turn → tool`, real durations, OK/ERROR status |
| **Gemini CLI** | ✅ | thin — `session → turn` (prompts; tool calls live in checkpoints, not yet read) |
| **Codex / OpenCode** | ⏳ planned | — |

Completeness varies by host *by design* — it's the same core, with a thinner adapter where the host logs less.

## Prerequisites

- **Node.js 20+** (22 LTS recommended; the test suite's glob needs ≥21). No other dependencies — **this project installs nothing.**
- **git** (so each captured session can be linked to a commit).
- At least one **supported agent you've already used** in the repo, so a transcript exists on disk.

## Install (30 seconds)

```bash
git clone https://github.com/h1902y/motorsandsensors.git
cd motorsandsensors
npm link        # puts `mns` on your PATH — no deps to install
```

Prefer not to link? Use `node bin/mns.mjs <cmd>` or `npm run mns -- <cmd>` anywhere below.

## Use it (60 seconds)

```bash
mns status              # what hosts + sessions are visible on this machine
mns capture             # capture your latest session (auto-detects the host)
mns trace --last        # print the captured trace as a tree
mns doctor              # environment + session health (reconciles lost sessions)
```

Or go hands-free — capture every session automatically (see [Live capture](#live-capture-enable-once-then-invisible)):

```bash
mns enable              # install background hooks; then just code
mns disable             # turn it back off
```

### What you'll see

`mns capture`:

```
captured claude-code session 20410eef-…
  status   : captured
  spans    : 116  (turns:4, tools:111, errors:1)
  git      : 775ffbc7 main
  trace    : .mns/traces/claude-code-20410eef-….otlp.jsonl  (git-ignored)
  indexed  : …/.mns/sessions.json  (tracked)
```

`mns trace --last`:

```
• session 20410eef (claude-code)  266.8m
  • turn: …/init…  1.0m
    • Bash  704ms
    • Read  540ms
  • turn: Okay let's start the application scaffolding…
    • AskUserQuestion  17.2m      ← real human think-time, captured
    • WebFetch  13.8s
```

That's an OTLP/JSON trace — replayable into any OpenTelemetry backend later.

## Where your data lives (git-native, local-first)

- We read your agent transcripts **read-only**. We never modify them.
- Output is recorded in your repo under `.mns/`:
  - `.mns/sessions.json` — a small **tracked** index; each session links to the git commit it was captured at. *This* is the git-native record.
  - `.mns/traces/*.otlp.jsonl` — the bulky trace blobs, **git-ignored** (regenerable; they stay local). `git status` stays clean.
- **Nothing is uploaded.** No secrets or raw tool input/output go on the trace — only byte sizes.

## Verify your setup

```bash
npm test            # 35 hermetic unit + regression tests (fixtures only)
npm run playground  # smoke-checks against your real sessions
```

In the playground, **⏭️ skipped** just means that host isn't on *your* machine — it is **not** a failure.

## Troubleshooting (`mns doctor`)

- **"no host detected" / nothing to capture** — use a supported agent in this repo once (so a transcript exists), then retry.
- **Everything skips in the playground** — same cause: no supported agent data on this machine yet.
- **`npm test` runs zero tests / errors on the glob** — you're below Node 21; upgrade (22 LTS).
- **No `git` linkage on a capture** — you're outside a git repo; capture still works, the session just won't link to a commit.

## Live capture (enable once, then invisible)

The entire.io "enable once, then forget it's there" experience — **built** ([`experiment-2-live-sessions`](experiments/experiment-2-live-sessions/)):

```bash
mns enable      # installs background lifecycle hooks into .claude/settings.json
# …restart your agent, then just code. Sessions record themselves:
#   SessionStart → opened (active) · SessionEnd → completed
mns status      # watch them go active → completed
mns disable     # remove the hooks
```

How it stays non-intrusive: a minimal hook set (`SessionStart/Stop/SessionEnd` only — we re-read the transcript rather than hook every tool); every hook command is wrapped `… || true` so it **always exits 0** — if `mns` is missing it degrades silently and **never breaks your agent**; and a `permissions.deny` rule keeps the agent from reading its own trace output.

**Killed a terminal?** No clean end-signal exists, so a lost session reads `active` until the next **`mns doctor`** run **reconciles** it to `abandoned` — capturing the full session from the transcript still on disk (nothing lost). (`mns status` only displays; `doctor` is what reconciles.) This lazy detection is the same constraint entire.io has.

> **Honest caveat:** live capture is verified by the test suite and by piping real hook payloads through the `mns hook` binary; enabling it on a live agent session and watching real hooks fire is the one remaining real-world check. `mns capture` (post-hoc) is fully exercised.

## Where this is headed

Still ahead: a real-agent live run (the last proof above); trace blobs onto a dedicated git branch (today they're local-only, the index links to commits); live capture for Gemini and other hosts; and the payoff — the **evolution engine** that scores captured sessions and proposes improvements (the project's actual differentiator, see [README.md](README.md)).

## Repo map

- `experiments/` — numbered spikes; `experiment-1-trace-capture/` is the proven trace core.
- `mns/` + `bin/mns.mjs` — this CLI.
- `app/` — where proven code is harvested (skeleton today).
- `playground/` — real-data smoke checks · `tests/` — hermetic unit + regression.
- `inspiration/` — the audits this design stands on (entire.io, supermemory, …).
- `README.md` — the full design and why it exists.
