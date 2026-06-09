import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { WebSocketServer } from "ws";
import type {
  CreateSessionRequest,
  SaveRecordingRequest,
  WorkspaceInfo,
} from "@webcode/protocol";
import { SessionManager } from "./sessions.js";
import { createFsApi } from "./fs-api.js";
import { search } from "./search.js";
import { handleTermSocket } from "./ws-term.js";
import { handleFsSocket } from "./ws-fs.js";
import { PathError, resolveSafe, safeJoin } from "./safe-path.js";

const AUTH_COOKIE = "webcode_auth";
const COOKIE_MAX_AGE = 30 * 24 * 3600;

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
}

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
  readonly sessions: SessionManager;
  private readonly authSessions = new Set<string>();
  private readonly allowedHosts: Set<string>;
  private readonly allowedOrigins: Set<string>;
  private server: ServerType | null = null;

  constructor(private readonly cfg: ServerConfig) {
    this.sessions = new SessionManager(cfg.root);
    const hostNames = ["127.0.0.1", "localhost", "[::1]"];
    this.allowedHosts = new Set(hostNames.flatMap((h) => [h, `${h}:${cfg.port}`]));
    this.allowedOrigins = new Set([
      ...hostNames.map((h) => `http://${h}:${cfg.port}`),
      ...(cfg.extraOrigins ?? []),
    ]);
    this.app = this.buildApp();
  }

  // ── security gates ─────────────────────────────────────────────────

  /** Host allowlist defeats DNS rebinding: rebinding changes DNS, not the Host header. */
  private hostAllowed(host: string | undefined): boolean {
    return !!host && this.allowedHosts.has(host.toLowerCase());
  }

  /** Origin allowlist defeats cross-site WS hijacking / CSRF from arbitrary websites. */
  private originAllowed(origin: string | undefined): boolean {
    return origin === undefined || this.allowedOrigins.has(origin);
  }

  private cookieAuthed(cookieHeader: string | undefined): boolean {
    if (!cookieHeader) return false;
    const match = /(?:^|;\s*)webcode_auth=([^;]+)/.exec(cookieHeader);
    return !!match && this.authSessions.has(match[1]!);
  }

  // ── HTTP app ───────────────────────────────────────────────────────

  private buildApp(): Hono {
    const { cfg } = this;
    const app = new Hono();

    app.use("*", async (c, next) => {
      if (!this.hostAllowed(c.req.header("host"))) {
        return c.text("forbidden host", 403);
      }
      if (!this.originAllowed(c.req.header("origin"))) {
        return c.text("forbidden origin", 403);
      }
      // Token exchange: any page request carrying ?token= gets a cookie.
      const token = c.req.query("token");
      if (token && !c.req.path.startsWith("/api/")) {
        if (!timingSafeEqualStr(token, cfg.token)) return c.text("invalid token", 403);
        const secret = crypto.randomBytes(24).toString("base64url");
        this.authSessions.add(secret);
        setCookie(c, AUTH_COOKIE, secret, {
          httpOnly: true,
          sameSite: "Strict",
          path: "/",
          maxAge: COOKIE_MAX_AGE,
        });
        const url = new URL(c.req.url);
        url.searchParams.delete("token");
        // /auth?token=… exists so the Vite dev server can proxy the
        // exchange; land on the app root afterwards either way.
        const dest = url.pathname === "/auth" ? "/" : url.pathname + url.search;
        return c.redirect(dest);
      }
      await next();
    });

    app.use("/api/*", async (c, next) => {
      if (!this.authSessions.has(getCookie(c, AUTH_COOKIE) ?? "")) {
        return c.json({ error: "unauthorized" }, 401);
      }
      await next();
    });

    app.get("/api/workspace", (c) => {
      const body: WorkspaceInfo = {
        root: cfg.root,
        name: path.basename(cfg.root) || cfg.root,
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
      const cwd = body.cwd ? safeJoin(cfg.root, body.cwd) : cfg.root;
      const session = this.sessions.create(cwd, body.cols, body.rows);
      return c.json(session.info(), 201);
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
        abs = await resolveSafe(cfg.root, body.path);
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
        searchRoot = await resolveSafe(cfg.root, c.req.query("path") ?? "");
      } catch (err) {
        if (err instanceof PathError) return c.json({ error: err.message }, 403);
        throw err;
      }
      const res = await search({
        query,
        searchRoot,
        root: cfg.root,
        regex: c.req.query("regex") === "1",
        caseSensitive: c.req.query("case") === "1",
      });
      return c.json(res);
    });

    app.route("/api/fs", createFsApi(cfg.root));

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
        if (!st) return c.text("web UI not built — run: npm run build -w @webcode/web", 404);
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
      if (!this.hostAllowed(req.headers.host)) return reject(403, "Forbidden");
      if (!this.originAllowed(req.headers.origin)) return reject(403, "Forbidden");
      if (!this.cookieAuthed(req.headers.cookie)) return reject(401, "Unauthorized");

      const url = new URL(req.url ?? "/", "http://localhost");
      const termMatch = /^\/ws\/term\/([0-9a-f]+)$/.exec(url.pathname);
      if (termMatch) {
        const session = this.sessions.get(termMatch[1]!);
        if (!session) return reject(404, "Not Found");
        wss.handleUpgrade(req, socket, head, (ws) => handleTermSocket(ws, session));
        return;
      }
      if (url.pathname === "/ws/fs") {
        wss.handleUpgrade(req, socket, head, (ws) => handleFsSocket(ws, cfg.root));
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

function timingSafeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
