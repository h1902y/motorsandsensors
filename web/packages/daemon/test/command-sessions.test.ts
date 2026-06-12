// Command sessions (W2.2 ②): POST /api/sessions can spawn a host CLI
// DIRECTLY on the PTY (argv, no shell, no rc injection), gated by a
// server-side allowlist; agent PTY exits trigger exactly one
// `zuzuu session merge` whose result is readable via GET /api/sessions/:id.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  chmodSync,
  realpathSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SessionManager, type Session } from "../src/sessions.js";
import { WebcodeServer, type ServerConfig } from "../src/server.js";

let root: string;
// realpath the temp root: the daemon realpaths its root at startup; on macOS
// /var → /private/var would otherwise break path checks.
beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), "zw-cmd-")));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond: () => boolean | Promise<boolean>, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  while (!(await cond())) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await sleep(50);
  }
}

/** All "o"-event payloads of the session's asciicast, concatenated. */
function castText(session: Session): string {
  return session
    .recording()
    .trim()
    .split("\n")
    .slice(1)
    .map((l) => JSON.parse(l) as [number, string, string])
    .filter(([, code]) => code === "o")
    .map(([, , data]) => data)
    .join("");
}

function makeServer(extra: Partial<ServerConfig> = {}): WebcodeServer {
  return new WebcodeServer({
    root,
    port: 7770,
    host: "127.0.0.1",
    token: "test-token",
    webDist: root,
    version: "0.0.0-test",
    ...extra,
  });
}

/** Token → cookie exchange via the app itself (no listening socket needed). */
async function authedHeaders(server: WebcodeServer): Promise<Record<string, string>> {
  const res = await server.app.request("/auth?token=test-token", {
    headers: { host: "localhost" },
  });
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("auth exchange did not set a cookie");
  return { host: "localhost", cookie: setCookie.split(";")[0]! };
}

const postJson = (server: WebcodeServer, headers: Record<string, string>, body: unknown) =>
  server.app.request("/api/sessions", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

/** A zuzuu stub that logs each invocation and prints merge JSON. */
function mergeStub(r: string, payload = '{"ok":true,"mergedAs":"abc12345","mergedTo":"main","commits":2,"branch":"zz/session-x"}') {
  const marker = path.join(r, "merge-calls.log");
  const stub = path.join(r, "zuzuu-merge-stub.sh");
  writeFileSync(stub, `#!/bin/sh\necho "run $@" >> '${marker}'\necho '${payload}'\n`);
  chmodSync(stub, 0o755);
  return { stub, marker };
}

describe("Session: direct command spawn", () => {
  it("spawns the argv directly — no shell, so metacharacters stay literal", async () => {
    const manager = new SessionManager(root);
    const session = manager.create(undefined, 80, 24, {
      command: "/bin/echo",
      args: ["$HOME;", "literal-marker"],
      type: "agent",
      host: "claude",
    });
    expect(session.info().type).toBe("agent");
    expect(session.info().host).toBe("claude");
    expect(session.title).toBe("echo"); // basename of the command
    await waitFor(() => !session.alive);
    const text = castText(session);
    expect(text).toContain("literal-marker");
    expect(text).toContain("$HOME;"); // not expanded — argv was never shell-interpreted
    manager.shutdown();
  });

  it("command sessions get a plain env: no ZDOTDIR/rc injection, WEBCODE=1 kept", async () => {
    const manager = new SessionManager(root);
    const session = manager.create(undefined, 200, 24, { command: "/usr/bin/env", type: "agent" });
    await waitFor(() => !session.alive);
    const text = castText(session);
    expect(text).toContain("WEBCODE=1");
    expect(text).not.toContain("webcode-si-"); // the shell-integration temp dir marker
    manager.shutdown();
  });

  it("defaults: no opts → a shell session, type 'shell', no host", () => {
    const manager = new SessionManager(root);
    const session = manager.create(undefined, 80, 24);
    const info = session.info();
    expect(info.type).toBe("shell");
    expect(info.host).toBeUndefined();
    manager.shutdown();
  });
});

describe("POST /api/sessions command allowlist", () => {
  it("rejects non-allowlisted commands with 400 (default fixed list)", async () => {
    const server = makeServer(); // default allowlist: claude/gemini/codex/pi/opencode/zuzuu
    const headers = await authedHeaders(server);
    for (const command of ["/bin/echo", "bash", "rm", "claude; rm -rf /", "../claude", ""]) {
      const res = await postJson(server, headers, { command });
      expect(res.status, `command ${JSON.stringify(command)} must be rejected`).toBe(400);
      expect((await res.json()).error).toBe("command not allowed");
    }
    server.stop();
  });

  it("rejects malformed args / type / host without spawning", async () => {
    const server = makeServer({ commandAllowlist: ["/bin/echo"] });
    const headers = await authedHeaders(server);
    expect((await postJson(server, headers, { command: "/bin/echo", args: "hi" })).status).toBe(400);
    expect((await postJson(server, headers, { command: "/bin/echo", args: [1] })).status).toBe(400);
    expect((await postJson(server, headers, { args: ["orphan"] })).status).toBe(400);
    expect((await postJson(server, headers, { type: "robot" })).status).toBe(400);
    expect((await postJson(server, headers, { command: "/bin/echo", host: 7 })).status).toBe(400);
    const list = await (await server.app.request("/api/sessions", { headers })).json();
    expect(list).toEqual([]); // nothing was spawned
    server.stop();
  });

  it("spawns an allowlisted command; type + host surface in the session list", async () => {
    const server = makeServer({ commandAllowlist: ["/bin/echo"] });
    const headers = await authedHeaders(server);
    const res = await postJson(server, headers, {
      command: "/bin/echo",
      args: ["hello"],
      type: "agent",
      host: "claude",
    });
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created).toMatchObject({ type: "agent", host: "claude", title: "echo" });

    const list = await (await server.app.request("/api/sessions", { headers })).json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: created.id, type: "agent", host: "claude" });
    server.stop();
  });

  it("plain shell create still works and reports type 'shell'", async () => {
    const server = makeServer();
    const headers = await authedHeaders(server);
    const res = await postJson(server, headers, {});
    expect(res.status).toBe(201);
    expect((await res.json()).type).toBe("shell");
    server.stop();
  });
});
