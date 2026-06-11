# zuzuu-web

A 100%-native-feeling terminal + file explorer for your local machine, in the browser — plus a
**zuzuu faculties dashboard** that observes a project's `agent/` home.

A small daemon runs on your machine; the browser connects to `localhost` and gets a real shell
(real PTY, 24-bit color, mouse, full keyboard) plus a file explorer panel over the workspace —
sessions survive page reloads, output never freezes the tab, and nothing leaves your machine.

## The zuzuu Faculties dashboard

Run zuzuu-web rooted at a project that has a [zuzuu](https://github.com/h1902y/motorsandsensors)
`agent/` home, then switch to the **Faculties** view (the `Code | Faculties` toggle in the status
bar) for a **read-only** look at where the agent is in its graduation loop:

- status — the active generation · pending proposals · drift
- the 5 faculties (knowledge · memory · actions · instructions · guardrails) — counts + drill-in to items and pending proposals
- the generations timeline + the per-generation diff
- captured sessions + the session-start digest

The dashboard reads `agent/` files directly and shells out to the `zuzuu` CLI for computed views
(status, inbox, generation diff). The CLI is **optional** — without it on `PATH`, those views fall
back to file-reads (a banner notes the degraded mode). Approving proposals stays in the CLI
(`zuzuu review`); the dashboard is observe-only.

```
┌────────────┬──────────────────────────────┐
│ FILES      │ zsh ● │ vim ● │ +            │
│ ▸ src      ├──────────────────────────────┤
│ ▸ docs     │ ❯ npm run dev                │
│   pkg.json │ …a real terminal (xterm.js   │
│            │  + WebGL + PTY over WS)      │
└────────────┴──────────────────────────────┘
```

## Run

```bash
npm install
npm run build          # builds protocol + web UI + daemon
npm run -w webcode start -- ~/code/my-project
# prints: http://127.0.0.1:7770/?token=…  (opens browser automatically)
```

Dev mode (Vite HMR on :5173, daemon on :7770):

```bash
npm run build -w @webcode/protocol   # once
npm run dev:daemon                   # terminal 1 — add: --dev --token dev
npm run dev:web                      # terminal 2
# then open http://localhost:5173/auth?token=dev
```

## Architecture

```
packages/
  protocol/   shared wire types — WS opcodes, flow-control watermarks, fs API schemas
  daemon/     Hono server · @lydell/node-pty sessions · binary WS protocol · fs REST API
  web/        Vite + React · @xterm/xterm v6 (WebGL) · virtualized file tree · zustand
```

- **Terminal path**: binary WebSocket frames (1-byte opcode). End-to-end flow control —
  the client acks bytes actually rendered (`term.write` callbacks); past 128 KB in flight the
  daemon pauses the PTY, so `yes` / giant `cat` backpressure into the kernel instead of
  freezing the tab.
- **Session persistence**: PTYs live in the daemon keyed by session id, decoupled from
  sockets. A headless xterm mirrors output; reattach replays a serialized snapshot
  (screen + 10k scrollback), then streams live.
- **File explorer**: REST for listings/ops/up/downloads (streaming, Range, zip-on-the-fly),
  WebSocket push of fs events — only *expanded* directories are watched (chokidar,
  non-recursive) so fd usage stays bounded.
- **Security** (localhost is not a security boundary): binds 127.0.0.1 only, Host-header
  allowlist (DNS rebinding), Origin allowlist (cross-site WS hijacking), token-in-URL →
  HttpOnly cookie auth, every fs path through one hardened `safePath` choke point
  (lexical + realpath symlink checks, unit-tested).

- **Editor** (VS Code online-IDE-inspired — webcode is architecturally code-server, a real
  backend): single-click any file opens it in a **Monaco editor** (lazy-loaded) as a tab with an
  unsaved-dot indicator; `⌘S` writes to disk. Free in-browser **TS/JS IntelliSense** (the
  TypeScript language service runs in a web worker — no backend). Markdown opens with an
  **Edit | Preview** toggle; images/PDF/video/audio/CSV/asciicast stay read-only viewers.

- **Git** (the thing serverless vscode.dev structurally can't do): the daemon shells out to
  `git`. **M/A/D/U status badges** in the file tree, a **Source Control panel** (branch,
  staged/changes lists) → click a file for a **Monaco side-by-side diff** (HEAD vs working) →
  stage / unstage / commit.

- **Run-recent-command** (`⌘R`): a quickpick merging the session's command blocks with the
  shell's own history file (`~/.zsh_history`/`~/.bash_history`); Enter runs into the active
  terminal, Alt+Enter inserts without running.

- **Terminal quick fixes**: a finished command's output is matched for known errors and a
  one-click chip appears on the block — `git push --set-upstream …` after a failed push,
  "kill :PORT & rerun" on `EADDRINUSE`, git "did you mean" subcommand fixes.

- **Preview pane**: GFM markdown (react-markdown + remark-gfm: tables, task lists, relative
  images resolved through the daemon), shiki highlighting, images/SVG, PDF, video/audio
  (streamed via Range), CSV tables, asciicast `.cast` replay, binary-sniff fallback card.

- **Command blocks** (Warp-inspired, built on the vendor-neutral **OSC 133** semantic-prompt
  standard): a small shell hook is auto-injected at spawn (VS Code's method — temp `ZDOTDIR`
  for zsh, `--rcfile` for bash, `vendor_conf.d` for fish, after the user's own rc) so the shell
  marks prompt/command/output/exit. The client builds command blocks: a left **gutter coloured
  green/red by exit code**, hover to **copy just that block's output**, re-run, or save as a
  workflow; **⌘↑/⌘↓** jump between commands; a **sticky header** pins the running command while
  you scroll its output. The same hook emits **OSC 7**, making cwd sync instant/exact.

- **⌘K command palette** (cmdk): one fuzzy surface over data already present — jump to a file
  (ripgrep `--files`), re-run a command from history (sourced from the block model), kick off a
  search, switch sessions, or run a workflow.

- **Workflows**: saved parameterized commands in `.webcode/workflows/*.json` (per-project,
  version-controllable). Run from the palette — `{{arg}}` placeholders prompt for values, then
  the command is sent to the active terminal. "Save as workflow" on any block seeds one.

- **Local-native integration** (it's the same machine — no upload/download):
  - **Tree ↔ terminal cwd sync**: cwd comes from the shell via **OSC 7** (instant/exact), with
    an `lsof`/`/proc` poll as fallback for shells the hook didn't load into; the status bar +
    tree indicator follow it, and clicking the status bar reveals the cwd in the tree.
    Double-click a dir (or its "cd here" action) sends a `cd` to the active terminal — kill-line
    prefixed so it never clobbers a half-typed command, path shell-quoted.
  - **Row actions**: copy absolute path, reveal in Finder, open with the OS default app.
  - **Clickable paths** in terminal output (`src/foo.ts:42` from grep/test/tsc) → open in the
    preview pane, resolved against that session's live cwd, workspace-scoped.
  - **Content search**: ripgrep (`rg --json`, grep fallback) in a sidebar panel — grouped,
    highlighted, regex + case toggles, click-through to preview.
  - **Session recording**: save the live terminal as an asciicast v2 `.cast` into the
    workspace (output only — input is never recorded), replays in the preview pane.

## Status

v0.5 — terminal (blocks, sticky header, flow control, WebGL) + explorer + preview pane +
local-native integration + ⌘K palette + workflows + **Monaco editor (tabs, ⌘S save, TS
IntelliSense, markdown edit/preview), git (badges + SCM panel + diff/stage/commit), run-recent
(⌘R), terminal quick fixes** working end-to-end. Roadmap (VS Code / Warp / Charm-inspired):
LSP for non-TS IntelliSense, terminal splits, Problems/Outline panels, inline CLI completions,
freeze-style SVG export, sequin escape-sequence inspector, PWA manifest, `npm i -g` packaging,
SSH-out.
