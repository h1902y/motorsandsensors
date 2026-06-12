// The daemon's auth + request-origin gates, extracted from server.ts:
// Host-header allowlist (DNS rebinding), Origin allowlist (cross-site WS
// hijacking / CSRF), and token-in-URL → HttpOnly cookie auth. One AuthGate
// instance guards both the Hono HTTP app and the WS upgrade path.

import crypto from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";

const AUTH_COOKIE = "webcode_auth";
const COOKIE_MAX_AGE = 30 * 24 * 3600;

export interface AuthGateConfig {
  port: number;
  token: string;
  /** extra allowed origins, e.g. the Vite dev server */
  extraOrigins?: string[];
  /** public hostname the VM is reached at in hosted mode (e.g. "app.fly.dev") */
  publicHost?: string;
}

export class AuthGate {
  private readonly authSessions = new Set<string>();
  private readonly allowedHosts: Set<string>;
  private readonly allowedOrigins: Set<string>;
  private readonly token: string;

  constructor(cfg: AuthGateConfig) {
    this.token = cfg.token;
    const hostNames = ["127.0.0.1", "localhost", "[::1]"];
    this.allowedHosts = new Set(hostNames.flatMap((h) => [h, `${h}:${cfg.port}`]));
    this.allowedOrigins = new Set([
      ...hostNames.map((h) => `http://${h}:${cfg.port}`),
      ...(cfg.extraOrigins ?? []),
    ]);
    // hosted: also accept the public hostname (Fly's edge sets Host to it);
    // Host/Origin defense stays on, just widened to the one public origin.
    if (cfg.publicHost) {
      this.allowedHosts.add(cfg.publicHost.toLowerCase());
      this.allowedOrigins.add(`https://${cfg.publicHost}`);
      this.allowedOrigins.add(`http://${cfg.publicHost}`);
    }
  }

  /** Host allowlist defeats DNS rebinding: rebinding changes DNS, not the Host header. */
  hostAllowed(host: string | undefined): boolean {
    return !!host && this.allowedHosts.has(host.toLowerCase());
  }

  /** Origin allowlist defeats cross-site WS hijacking / CSRF from arbitrary websites. */
  originAllowed(origin: string | undefined): boolean {
    return origin === undefined || this.allowedOrigins.has(origin);
  }

  /** WS upgrade path: is the request's cookie an authenticated session? */
  cookieAuthed(cookieHeader: string | undefined): boolean {
    if (!cookieHeader) return false;
    const match = /(?:^|;\s*)webcode_auth=([^;]+)/.exec(cookieHeader);
    return !!match && this.authSessions.has(match[1]!);
  }

  /** App-wide gate: Host/Origin allowlists + the ?token= → cookie exchange. */
  gate(): MiddlewareHandler {
    return async (c, next) => {
      if (!this.hostAllowed(c.req.header("host"))) {
        return c.text("forbidden host", 403);
      }
      if (!this.originAllowed(c.req.header("origin"))) {
        return c.text("forbidden origin", 403);
      }
      // Token exchange: any page request carrying ?token= gets a cookie.
      const token = c.req.query("token");
      if (token && !c.req.path.startsWith("/api/")) {
        if (!timingSafeEqualStr(token, this.token)) return c.text("invalid token", 403);
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
    };
  }

  /** /api/* gate: only cookie-authenticated sessions pass. */
  requireAuth(): MiddlewareHandler {
    return async (c, next) => {
      if (!this.authSessions.has(getCookie(c, AUTH_COOKIE) ?? "")) {
        return c.json({ error: "unauthorized" }, 401);
      }
      await next();
    };
  }
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
