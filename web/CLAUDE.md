# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

zuzuu-web (the zuzuu visual workbench): a browser-based terminal + file explorer + editor for your local machine. A daemon runs locally; the browser connects to localhost and gets a real PTY shell (xterm.js + WebGL over a binary WebSocket), a file tree, a Monaco editor, and git integration. Sessions survive page reloads. See `docs/specs/2026-06-09-zuzuu-web-design.md` for design rationale.

## Commands

```bash
npm install
npm run build                        # protocol + web UI + daemon
npm run typecheck                    # all workspaces

# Dev (two processes; Vite on :5173 proxies /api, /auth, /ws to daemon on :7770)
npm run build -w @zuzuu-web/protocol   # once, before first dev run
npm run dev                          # daemon + web in parallel
# or separately: npm run dev:daemon (add -- --dev --token dev) and npm run dev:web
# then open http://localhost:5173/auth?token=dev

# Tests (vitest, daemon package only)
npm run test -w zuzuu-web
npm run test -w zuzuu-web -- safe-path           # single file by name filter
npm run test -w zuzuu-web -- -t "symlink"        # single test by title

# Run the built app against a workspace
npm run -w zuzuu-web start -- ~/code/my-project  # prints http://127.0.0.1:7770/?token=…
```

## Architecture

npm-workspaces monorepo, all TypeScript (strict, `noUncheckedIndexedAccess`), extending `tsconfig.base.json`.

- **`packages/protocol`** (`@zuzuu-web/protocol`) — shared wire types: binary WS opcodes (`ClientOp`/`ServerOp`), flow-control watermarks, REST schemas for fs/git/sessions/workflows. Both other packages import it; build it first.
- **`packages/daemon`** (`zuzuu-web`) — Hono + `@hono/node-server` + `ws`. CLI entry `src/index.ts`, HTTP/WS wiring and security gates in `src/server.ts`. Subsystems: PTY sessions (`src/sessions.ts`, `@lydell/node-pty` + headless xterm mirror), terminal WS (`src/ws-term.ts`), fs REST API (`src/fs-api.ts`), fs-events WS (`src/ws-fs.ts`), git via subprocess (`src/git.ts`), ripgrep search (`src/search.ts`), workflows, shell history, shell-integration injection (`src/shell-integration/`). Serves the built web SPA from `web/dist`.
- **`packages/web`** (`@zuzuu-web/web`) — Vite + React 19 + Tailwind v4. Zustand stores in `src/state/`, TanStack Query for REST data, Monaco in `src/editor/`, terminal connection + command-block model in `src/term/`, file tree/search in `src/explorer/`, cmdk palette in `src/palette/`, REST client in `src/lib/api.ts`. Layout is `sidebar | session center | right panel`: the left sidebar (`src/app/Sidebar.tsx`) is the file workspace (one consolidated workspace dropdown + the tree); the right panel (`src/panel/`) is ONE surface with two modes — files (the EditorPane renders in it) and modules (a dashboard of five ModuleTiles — the cards ARE the navigation, no tabs — with per-module drill-ins; kit components in `src/panel/kit/`); mode rules live in `src/state/right-panel.ts` (open file → files, last tab closed → modules at the dashboard root). The term "faculty" is fully retired in product code (it survives only in `zuzuu/commands/migrations/*` for brownfield homes).
- **`hosted/`** — cloud mode. `hosted/broker` is a control plane that provisions per-user sandboxes (`BROKER_BACKEND=local` spawns a child daemon; `fly` uses the Fly Machines API). `hosted/sandbox` is the Docker image + `fly.toml` that runs the daemon with `WEBCODE_HOSTED=1`.

### Data paths that matter

- **Terminal**: binary WS frames with a 1-byte opcode. End-to-end flow control — the client acks bytes only after xterm actually renders them; past 128 KB unacked the daemon pauses the PTY (constants in protocol). Don't bypass this; it's what keeps `yes`/giant `cat` from freezing the tab.
- **Session persistence**: PTYs are keyed by session id and decoupled from sockets. A headless xterm mirrors output server-side; reattach replays a serialized snapshot (screen + 10k scrollback) then streams live.
- **Command blocks**: a shell hook auto-injected at PTY spawn (temp `ZDOTDIR` for zsh, `--rcfile` for bash, `vendor_conf.d` for fish) emits OSC 133 (prompt/command/exit marks) and OSC 7 (cwd). The web client builds blocks, quick fixes, and cwd sync from these; `lsof`/procfs polling is the fallback for shells without the hook.
- **File watching**: chokidar v4, non-recursive, only on directories the user has expanded — keeps fd usage bounded. Fs events push over `/ws/fs` and invalidate React Query caches.

### Security model

Localhost is not treated as a security boundary. The daemon binds 127.0.0.1 only (unless `WEBCODE_HOSTED=1`), enforces a Host-header allowlist (DNS rebinding) and Origin allowlist (WS hijacking), and uses token-in-URL → HttpOnly cookie auth. **Every filesystem path must go through `resolveSafe`/`safeJoin` in `packages/daemon/src/safe-path.ts`** (lexical resolve + per-segment realpath/lstat to defeat symlink escapes; unit-tested). Never accept a raw client path into `fs` calls.

## Conventions

- Design tokens live in the Tailwind v4 `@theme` block in `packages/web/src/index.css` (ink color ramp, type scale: meta 11px / ui 12px / body 13px, `--radius-ui`, `wc-focus` ring). UI primitives (Bar, Button, IconButton, Field, Tabs, Dialog) are in `packages/web/src/components/ui/` — compose these rather than hand-rolling styled divs.
- Workflows are user data: JSON files in `.zuzuu-web/workflows/*.json` inside the *workspace being served*, with `{{arg}}` placeholders.
- Daemon env vars for hosted mode: `WEBCODE_HOSTED`, `WEBCODE_ROOT`, `WEBCODE_TOKEN`, `WEBCODE_PUBLIC_HOST`, `PORT`. Broker env vars are documented in `hosted/README.md`.
- If the default port is busy the daemon scans up to 20 ports upward from it.
