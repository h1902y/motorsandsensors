# webcode — browser-native local terminal + file explorer

## Context

New greenfield project (separate from zuzuu). **webcode** is a local daemon that runs on your machine; the browser connects to `localhost` and gets a 100%-native-feeling terminal (real shell, real PTY) plus a file explorer panel over the local filesystem. Think "ttyd + filebrowser, done right, in one lean tool."

Research (June 2026) confirms white space: ttyd is terminal-only and coasting, filebrowser has no terminal, Cloud Commander is dated, code-server is a whole IDE, Wave Terminal wraps the right internals in Electron. Nothing does *lean local daemon → browser → terminal + file panel*.

Decisions made with user:
- **Architecture**: local daemon + browser UI (not a remote SSH client) — SSH-out can come later
- **Scope**: terminal-first + a file explorer panel (not a full IDE)
- **Stack**: user asked for a recommendation → **all-TypeScript** (rationale below)

## Recommended stack

**Why TS over Go**: you're TS-native (fastest iteration), Go's PTY lib (`creack/pty`) is effectively Unix-only, and Bun `build --compile` now gives a credible single-binary story later. Cost accepted: hand-rolled path-traversal safety (Go's `os.Root` has no Node equivalent) and ~90 MB binaries if/when we compile.

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Node 22+ (Bun-compatible code) | Hono keeps runtime portable; Bun compile later |
| Server | **Hono** + `ws` (`@hono/node-server`, `@hono/node-ws`) | Web-standards API, portable to Bun |
| PTY | **`@lydell/node-pty`** | Tracks node-pty 1.2 betas (what VS Code runs) + prebuilt binaries per platform — no node-gyp at install |
| Terminal UI | **`@xterm/xterm` v6** + `@xterm/addon-webgl` | Scoped packages only (unscoped `xterm` is deprecated). Addons: `fit`, `search`, `web-links`, `unicode11`, `clipboard` (OSC 52), `serialize` (reattach), `web-fonts`, `ligatures` |
| Frontend shell | **Vite + React SPA** (not Next.js — daemon *is* the server, we want a static `dist/`) | Tailwind v4 + shadcn/ui |
| File tree | **`@headless-tree/react`** + `@tanstack/react-virtual` | Successor to react-complex-tree, headless → shadcn-native styling. Fallback if it fights us: `react-arborist` |
| Layout/UX | `react-resizable-panels` (persisted split), `zustand`, `cmdk` (⌘K file jump), TanStack Query for dir listings | |
| FS watching | **chokidar v4**, watching *expanded directories only*, non-recursive | Avoids fd exhaustion; v4 dropped globs (filter ourselves) |
| Zip download | `archiver` (streaming, ZIP64, store-only compression) | |

## Project structure

New repo at `~/Documents/webcode` (own `.git`, not under zuzuu):

```
webcode/
  package.json            # workspace root (npm workspaces)
  packages/
    daemon/               # Hono server + PTY session manager + fs API + CLI entry
    web/                  # Vite React SPA (terminal + explorer)
    protocol/             # shared TS types: WS opcodes, fs API schemas
  docs/specs/             # design doc lands here at implementation time
```

## Architecture

**One WebSocket** per client for terminal streams + fs events; **plain HTTP** for file transfer (Range downloads, streaming uploads, zip-on-the-fly).

### Terminal path (the quality-critical part)
- Binary WS frames, 1-byte opcode prefix (ttyd's scheme): `OUTPUT`, `INPUT`, `RESIZE`, `PAUSE`/`RESUME`, control as JSON.
- **End-to-end flow control from day one**: client tracks pending bytes via `term.write(chunk, cb)` callbacks → sends `PAUSE` at ~128 KB high-water / `RESUME` at ~16 KB low-water → daemon calls `pty.pause()/resume()` (propagates to kernel buffer). Coalesce output, flush once per `requestAnimationFrame`. This is the #1 thing that separates native-feel from freezing on `yes`/huge `cat`.
- **Session persistence**: PTY lifetime decoupled from socket lifetime — sessions keyed by ID in the daemon, page refresh reattaches; replay state via server-side `addon-serialize` snapshots.
- Native-feel details: `attachCustomKeyEventHandler` (Cmd+C/V clipboard, Ctrl+C stays SIGINT), `TERM=xterm-256color COLORTERM=truecolor`, fonts loaded before `term.open()` (else metrics garble), WebGL `onContextLoss` → DOM fallback, OSC title → `document.title`, `beforeunload` guard, PWA manifest (standalone window releases Cmd+W/T/N).

### File explorer path
- REST: list dir (streamed `Dirent`, no eager stat), stat, mkdir, rename, move, delete, upload (stream to `createWriteStream`), download (Range), folder→zip stream.
- WS pushes fs events for expanded dirs → invalidates TanStack Query caches.
- **Path safety (all hand-rolled, every endpoint)**: `path.resolve` + root-prefix check + per-segment `realpath`/`lstat` symlink policy. Central `safePath()` util in `protocol`/daemon — single choke point, tested hard.

### Security (non-negotiable, day one)
- Bind **127.0.0.1 only** (explicit `--host` + auth required to change).
- Validate **`Host` header** (defeats DNS rebinding) and **`Origin`** on WS upgrade (defeats cross-site WS hijacking) on every request.
- Random token at daemon start → launch URL one-time query param → exchanged for session cookie (Zellij/Jupyter pattern). Recent CVEs (Marimo, MCP inspector) show unauthenticated localhost terminal WS = RCE from any website.

## Milestones

1. **Scaffold**: workspace, Hono daemon serving Vite-built SPA, CLI entry (`webcode [dir]`) with port-scan fallback + auto-open browser (`--no-open` flag), token auth + Host/Origin checks.
2. **Terminal core**: PTY session manager (spawn/attach/kill, socket-decoupled), binary WS protocol with flow control + resize + reconnect.
3. **Terminal UI**: xterm v6 + webgl + addon set, keyboard/clipboard handling, multiple tabs/sessions, font pipeline.
4. **File explorer**: fs REST API + `safePath()`, headless-tree panel with virtualization, watch-expanded-dirs events, upload/download/zip, drag-drop, ⌘K jump.
5. **Polish/ship**: PWA manifest, settings (theme/font), `npm i -g webcode` distribution; Bun `--compile` single binary as a later stretch.

## Verification

- Flow-control torture: `yes`, `cat` a 500 MB file, `find /` — terminal must stay responsive, no dropped output after Ctrl+C.
- Reattach: refresh mid-`vim`/mid-running process — session intact with scrollback.
- Native feel: vim/htop/tmux mouse + 24-bit color, CJK/emoji rendering, Cmd+C/V, paste-multiline (bracketed paste).
- Security: request with wrong `Host` → rejected; WS from other origin → rejected; `GET /api/fs?path=../../etc/passwd` and symlink-out-of-root → rejected (unit tests on `safePath`).
- Explorer: 50k-entry directory listing stays smooth (virtualization); upload/download a multi-GB file without memory blowup.

## Reference projects to crib from
- **ttyd** (MIT) — wire protocol + flow control reference
- **Zellij web client** (MIT) — daemon security model, session-as-URL
- **code-server** (MIT) — keyboard/clipboard handling gold standard
