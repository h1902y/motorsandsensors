import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { WebSocketServer } from "ws";
import type {
  CreateSessionRequest,
  SaveRecordingRequest,
  SessionCloseResult,
  SessionDetail,
  SessionMergeResult,
  WorkspaceInfo,
} from "@zuzuu-web/protocol";
import type { Workflow } from "@zuzuu-web/protocol";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SessionManager, type Session } from "./sessions.js";
import { AuthGate } from "./auth.js";
import { createFsApi } from "./fs-api.js";
import { createZuzuuApi } from "./zuzuu-routes.js";
import { runZuzuuMut } from "./zuzuu-cli.js";
import { search } from "./search.js";
import { listFiles } from "./file-list.js";
import { listWorkflows, saveWorkflow } from "./workflows.js";
import * as git from "./git.js";
import { shellHistory } from "./history.js";
import * as config from "./config.js";
import { listDirs, mkdirIn } from "./browse.js";

const execFileAsync = promisify(execFile);
import { handleTermSocket } from "./ws-term.js";
import { handleFsSocket } from "./ws-fs.js";
import { PathError, resolveSafe, safeJoin } from "./safe-path.js";

export interface ServerConfig {
  /** realpath'd absolute workspace root */
  root: string;
  port: number;
  host: string;
  token: string;
  /** absolute path to the built web UI (index.html + assets) */
  webDist: string;
  /** extra allowed origins, e.g. the Vite dev server */
  extraOrigins?: string[];
  version: string;
  /** running inside a per-user cloud sandbox VM */
  hosted?: boolean;
  /** public hostname the VM is reached at (e.g. "app.fly.dev") */
  publicHost?: string;
  /**
   * Commands POST /api/sessions may spawn directly (host coding-agent CLIs).
   * Injectable for tests; defaults to the fixed host allowlist.
   */
  commandAllowlist?: string[];
  /** zuzuu binary override (tests); defaults to "zuzuu" on PATH */
  zuzuuBinary?: string;
}

/** Host CLIs an agent/command session may run. Argv-spawned, never a shell. */
const DEFAULT_COMMAND_ALLOWLIST = ["claude", "gemini", "codex", "pi", "opencode", "zuzuu"];

const STATIC_MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};

export class WebcodeServer {
  readonly app: Hono;
  sessions: SessionManager;
  /** mutable workspace root — switchable at runtime via switchTo() */
  private root: string;
  private readonly startedAt = Date.now();
  private readonly auth: AuthGate;
  private readonly commandAllowlist: Set<string>;
  private server: ServerType | null = null;

  constructor(private readonly cfg: ServerConfig) {
    this.root = cfg.root;
    this.commandAllowlist = new Set(cfg.commandAllowlist ?? DEFAULT_COMMAND_ALLOWLIST);
    this.sessions = new SessionManager(cfg.root);
    this.auth = new AuthGate({
      port: cfg.port,
      token: cfg.token,
      ...(cfg.extraOrigins !== undefined ? { extraOrigins: cfg.extraOrigins } : {}),
      ...(cfg.publicHost !== undefined ? { publicHost: cfg.publicHost } : {}),
    });
    this.app = this.buildApp();
  }

  /**
   * Re-root the live daemon onto a new workspace. Tears down all terminal
   * sessions (like reloading an Obsidian vault) and rebuilds the manager;
   * fs watchers belong to client sockets and clean up when the client reloads.
   */
  async switchTo(newRoot: string): Promise<void> {
    const resolved = await fsp.realpath(path.resolve(newRoot));
    const st = await fsp.stat(resolved);
    if (!st.isDirectory()) throw new Error("not a directory");
    this.sessions.shutdown();
    this.sessions = new SessionManager(resolved);
    this.root = resolved;
    await config.addRecent(resolved);
  }

  /**
   * Agent PTY exited → squash-merge its invisible session branch back to
   * main via the zuzuu CLI. Runs in the session's cwd (the repo the agent
   * worked in). CLI-only, like every zuzuu mutation; absent CLI is recorded,
   * never fatal. Session.runCloseHook guarantees this runs once per session.
   */
  private async closeAgentSession(session: Session): Promise<SessionCloseResult> {
    const r = await runZuzuuMut(session.cwd, ["session", "merge"], {
      binary: this.cfg.zuzuuBinary,
    });
    if (r.ok) return { ok: true, merge: r.data as SessionMergeResult };
    if (r.code === "absent") return { cliAbsent: true };
    return { ok: false, ...(r.stderr !== undefined ? { stderr: r.stderr } : {}), ...(r.data !== undefined ? { refusal: r.data as Record<string, unknown> } : {}) };
  }

  // ── HTTP app ───────────────────────────────────────────────────────

  private buildApp(): Hono {
    const { cfg } = this;
    const app = new Hono();

    // security gates live in auth.ts: Host/Origin allowlists + token→cookie
    app.use("*", this.auth.gate());
    app.use("/api/*", this.auth.requireAuth());

    app.get("/api/workspace", (c) => {
      const body: WorkspaceInfo = {
        root: this.root,
        name: path.basename(this.root) || this.root,
        version: cfg.version,
      };
      return c.json(body);
    });

    app.get("/api/sessions", (c) => c.json(this.sessions.list()));

    app.post("/api/sessions", async (c) => {
      let body: CreateSessionRequest = {};
      try {
        body = await c.req.json<CreateSessionRequest>();
      } catch {
        // empty body is fine
      }
      // Direct command sessions: the allowlist keeps the spawn surface honest
      // (authenticated localhost daemon or not). Argv only — never a shell.
      if (body.command !== undefined) {
        if (typeof body.command !== "string" || !this.commandAllowlist.has(body.command)) {
          return c.json({ error: "command not allowed" }, 400);
        }
        if (
          body.args !== undefined &&
          (!Array.isArray(body.args) || !body.args.every((a) => typeof a === "string"))
        ) {
          return c.json({ error: "args must be an array of strings" }, 400);
        }
      } else if (body.args !== undefined) {
        return c.json({ error: "args require command" }, 400);
      }
      if (body.type !== undefined && body.type !== "shell" && body.type !== "agent") {
        return c.json({ error: "bad type" }, 400);
      }
      if (body.host !== undefined && (typeof body.host !== "string" || body.host.length > 64)) {
        return c.json({ error: "bad host" }, 400);
      }
      const cwd = body.cwd ? safeJoin(this.root, body.cwd) : this.root;
      const type = body.type ?? "shell";
      const session = this.sessions.create(cwd, body.cols, body.rows, {
        ...(body.command !== undefined ? { command: body.command, args: body.args ?? [] } : {}),
        type,
        ...(body.host !== undefined ? { host: body.host } : {}),
        ...(type === "agent" ? { onClose: (s: Session) => this.closeAgentSession(s) } : {}),
      });
      return c.json(session.info(), 201);
    });

    // Single-session read: the SPA polls this once after the Exit frame to
    // pick up closeResult (the agent-exit auto-merge outcome). Awaiting
    // whenClosed() means a poll that races the merge still gets the result.
    app.get("/api/sessions/:id", async (c) => {
      const session = this.sessions.get(c.req.param("id"));
      if (!session) return c.json({ error: "no such session" }, 404);
      await session.whenClosed();
      const body: SessionDetail = {
        ...session.info(),
        ...(session.closeResult !== undefined
          ? { closeResult: session.closeResult as SessionCloseResult }
          : {}),
      };
      return c.json(body);
    });

    app.delete("/api/sessions/:id", (c) => {
      const ok = this.sessions.close(c.req.param("id"));
      return ok ? c.json({ ok: true }) : c.json({ error: "no such session" }, 404);
    });

    // Save the session's output ring buffer as an asciicast v2 file INSIDE
    // the workspace — it shows up in the tree and replays in the preview.
    app.post("/api/sessions/:id/recording", async (c) => {
      const session = this.sessions.get(c.req.param("id"));
      if (!session) return c.json({ error: "no such session" }, 404);
      let body: SaveRecordingRequest;
      try {
        body = await c.req.json<SaveRecordingRequest>();
      } catch {
        return c.json({ error: "path required" }, 400);
      }
      if (!body.path?.endsWith(".cast")) return c.json({ error: "path must end in .cast" }, 400);
      let abs: string;
      try {
        abs = await resolveSafe(this.root, body.path);
      } catch (err) {
        if (err instanceof PathError) return c.json({ error: err.message }, 403);
        throw err;
      }
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      await fsp.writeFile(abs, session.recording(), "utf8");
      return c.json({ ok: true, path: body.path, truncated: session.castTruncated });
    });

    app.get("/api/search", async (c) => {
      const query = c.req.query("q") ?? "";
      if (!query) return c.json({ error: "q required" }, 400);
      let searchRoot: string;
      try {
        searchRoot = await resolveSafe(this.root, c.req.query("path") ?? "");
      } catch (err) {
        if (err instanceof PathError) return c.json({ error: err.message }, 403);
        throw err;
      }
      const res = await search({
        query,
        searchRoot,
        root: this.root,
        regex: c.req.query("regex") === "1",
        caseSensitive: c.req.query("case") === "1",
      });
      return c.json(res);
    });

    app.get("/api/files", async (c) => {
      const limit = Math.min(Number(c.req.query("limit")) || 5000, 20000);
      return c.json(await listFiles(this.root, limit));
    });

    app.get("/api/workflows", async (c) => {
      return c.json({ workflows: await listWorkflows(this.root) });
    });

    app.post("/api/workflows", async (c) => {
      let wf: Workflow;
      try {
        wf = await c.req.json<Workflow>();
      } catch {
        return c.json({ error: "invalid body" }, 400);
      }
      if (!wf.name?.trim() || !wf.command?.trim()) {
        return c.json({ error: "name and command required" }, 400);
      }
      const path = await saveWorkflow(this.root, wf);
      return c.json({ ok: true, path });
    });

    // ── git ──────────────────────────────────────────────────────────
    app.get("/api/git/status", async (c) => c.json(await git.status(this.root)));

    app.get("/api/git/diff", async (c) => {
      const p = c.req.query("path") ?? "";
      if (!p) return c.json({ error: "path required" }, 400);
      return c.json({ original: await git.diffOriginal(this.root, p) });
    });

    app.post("/api/git/stage", async (c) => {
      const { paths } = await c.req.json<{ paths: string[] }>();
      await git.stage(this.root, Array.isArray(paths) ? paths : []);
      return c.json({ ok: true });
    });

    app.post("/api/git/unstage", async (c) => {
      const { paths } = await c.req.json<{ paths: string[] }>();
      await git.unstage(this.root, Array.isArray(paths) ? paths : []);
      return c.json({ ok: true });
    });

    app.post("/api/git/commit", async (c) => {
      const { message } = await c.req.json<{ message: string }>();
      if (!message?.trim()) return c.json({ error: "message required" }, 400);
      try {
        await git.commit(this.root, message.trim());
      } catch (err) {
        return c.json({ error: (err as Error).message }, 400);
      }
      return c.json({ ok: true });
    });

    // ── shell history + quick-fix actions ──────────────────────────────
    app.get("/api/history", async (c) => c.json({ commands: await shellHistory() }));

    app.post("/api/fix/kill-port", async (c) => {
      const { port } = await c.req.json<{ port: number }>();
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return c.json({ error: "invalid port" }, 400);
      }
      try {
        const { stdout } = await execFileAsync("lsof", ["-ti", `tcp:${port}`]);
        const pids = stdout.split("\n").map((s) => s.trim()).filter(Boolean);
        for (const pid of pids) {
          try {
            process.kill(Number(pid), "SIGTERM");
          } catch {
            // already gone
          }
        }
        return c.json({ ok: true, killed: pids.length });
      } catch {
        return c.json({ ok: true, killed: 0 }); // nothing listening
      }
    });

    // ── health / onboarding / vault picker ─────────────────────────────
    app.get("/api/health", (c) =>
      c.json({
        ok: true,
        version: cfg.version,
        uptimeMs: Date.now() - this.startedAt,
        rss: process.memoryUsage().rss,
        root: this.root,
        name: path.basename(this.root) || this.root,
      }),
    );

    app.get("/api/workspace/config", async (c) => {
      const conf = await config.load();
      return c.json({ onboarded: conf.onboarded, recent: conf.recent });
    });

    app.post("/api/workspace/onboarded", async (c) => {
      await config.setOnboarded();
      return c.json({ ok: true });
    });

    app.get("/api/browse", async (c) => {
      try {
        return c.json(await listDirs(c.req.query("path")));
      } catch (err) {
        return c.json({ error: (err as Error).message }, 400);
      }
    });

    app.post("/api/browse/mkdir", async (c) => {
      const { parent, name } = await c.req.json<{ parent: string; name: string }>();
      try {
        const dir = await mkdirIn(parent, name);
        return c.json({ ok: true, path: dir });
      } catch (err) {
        return c.json({ error: (err as Error).message }, 400);
      }
    });

    app.post("/api/workspace/switch", async (c) => {
      const { path: target } = await c.req.json<{ path: string }>();
      if (!target) return c.json({ error: "path required" }, 400);
      try {
        await this.switchTo(target);
      } catch (err) {
        return c.json({ error: (err as Error).message }, 400);
      }
      return c.json({ ok: true, root: this.root });
    });

    app.route("/api/fs", createFsApi(() => this.root));
    app.route("/api/zuzuu", createZuzuuApi(() => this.root, { binary: cfg.zuzuuBinary }));

    // Static SPA with index.html fallback
    app.get("*", async (c) => {
      let rel = decodeURIComponent(new URL(c.req.url).pathname);
      let abs: string;
      try {
        abs = safeJoin(cfg.webDist, rel);
      } catch {
        return c.text("not found", 404);
      }
      let st = await fsp.stat(abs).catch(() => null);
      if (!st?.isFile()) {
        abs = path.join(cfg.webDist, "index.html");
        st = await fsp.stat(abs).catch(() => null);
        if (!st) return c.text("web UI not built — run: npm run build -w @zuzuu-web/web", 404);
      }
      const ext = path.extname(abs).toLowerCase();
      const immutable = rel.startsWith("/assets/");
      return new Response(Readable.toWeb(fs.createReadStream(abs)) as ReadableStream, {
        headers: {
          "Content-Type": STATIC_MIME[ext] ?? "application/octet-stream",
          "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
        },
      });
    });

    return app;
  }

  // ── listen + WS upgrade ────────────────────────────────────────────

  start(onReady: (port: number) => void): void {
    const { cfg } = this;
    this.server = serve(
      { fetch: this.app.fetch, port: cfg.port, hostname: cfg.host },
      (info) => onReady(info.port),
    );

    const wss = new WebSocketServer({ noServer: true });

    this.server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const reject = (status: number, msg: string) => {
        socket.write(`HTTP/1.1 ${status} ${msg}\r\nConnection: close\r\n\r\n`);
        socket.destroy();
      };
      if (!this.auth.hostAllowed(req.headers.host)) return reject(403, "Forbidden");
      if (!this.auth.originAllowed(req.headers.origin)) return reject(403, "Forbidden");
      if (!this.auth.cookieAuthed(req.headers.cookie)) return reject(401, "Unauthorized");

      const url = new URL(req.url ?? "/", "http://localhost");
      const termMatch = /^\/ws\/term\/([0-9a-f]+)$/.exec(url.pathname);
      if (termMatch) {
        const session = this.sessions.get(termMatch[1]!);
        if (!session) return reject(404, "Not Found");
        wss.handleUpgrade(req, socket, head, (ws) => handleTermSocket(ws, session));
        return;
      }
      if (url.pathname === "/ws/fs") {
        wss.handleUpgrade(req, socket, head, (ws) => handleFsSocket(ws, this.root));
        // ^ this.root read at upgrade time → new connections (post-switch) use the new root
        return;
      }
      reject(404, "Not Found");
    });
  }

  stop(): void {
    this.sessions.shutdown();
    this.server?.close();
  }
}
