import os from "node:os";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pty from "@lydell/node-pty";
import type { IPty } from "@lydell/node-pty";
import xtermHeadless from "@xterm/headless";
import addonSerialize from "@xterm/addon-serialize";
import type { Terminal as HeadlessTerminal } from "@xterm/headless";

// Both packages are CJS bundles without ESM named exports.
const { Terminal } = xtermHeadless;
const { SerializeAddon } = addonSerialize;
import type { WebSocket } from "ws";
import {
  ServerOp,
  FLOW_HIGH_WATER,
  FLOW_LOW_WATER,
  type CwdPayload,
  type SessionInfo,
} from "@zuzuu-web/protocol";
import { encodeFrame } from "./frames.js";
import { toRel } from "./safe-path.js";
import { buildInjection, cleanupInjection } from "./shell-integration/inject.js";

const execFileAsync = promisify(execFile);

const SCROLLBACK = 10_000;
const CWD_POLL_MS = 2_500;
/** asciicast ring buffer caps */
const REC_MAX_BYTES = 2 * 1024 * 1024;
const REC_MAX_EVENTS = 10_000;

type CastEvent = [number, "o" | "r", string];

/** Resolve the live working directory of a process, shell-agnostically. */
async function processCwd(pid: number): Promise<string | null> {
  try {
    if (process.platform === "linux") {
      const { stdout } = await execFileAsync("readlink", [`/proc/${pid}/cwd`], { timeout: 1000 });
      return stdout.trim() || null;
    }
    // darwin: -Fn prints "p<pid>" then "n<path>" lines
    const { stdout } = await execFileAsync(
      "lsof",
      ["-a", "-p", String(pid), "-d", "cwd", "-Fn"],
      { timeout: 2000 },
    );
    const line = stdout.split("\n").find((l) => l.startsWith("n"));
    return line ? line.slice(1) : null;
  } catch {
    return null;
  }
}

/** Parse an OSC 7 payload `file://host/path` into a decoded absolute path. */
export function parseOsc7(payload: string): string | null {
  const m = /^file:\/\/[^/]*(\/.*)$/.exec(payload);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]!);
  } catch {
    return m[1]!;
  }
}

function pickShell(): string {
  if (process.platform === "win32") return process.env.COMSPEC ?? "cmd.exe";
  return process.env.SHELL ?? (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash");
}

/**
 * A PTY whose lifetime is decoupled from any WebSocket. A headless xterm
 * mirrors all output so a (re)attaching client gets an accurate replay of
 * screen + scrollback via the serialize addon, then streams live.
 *
 * Flow control: while a client is attached we count PTY output bytes in
 * flight (sent but not yet acked by the client's `term.write` callbacks).
 * Above the high-water mark the PTY is paused — backpressure propagates to
 * the kernel pty buffer, so `yes` / giant `cat` never overruns the browser.
 */
export class Session {
  readonly id = crypto.randomBytes(8).toString("hex");
  readonly createdAt = Date.now();
  title: string;
  alive = true;
  /** live working directory of the shell (absolute) */
  cwdAbs: string;
  private readonly pty: IPty;
  private readonly mirror: HeadlessTerminal;
  private readonly serializer = new SerializeAddon();
  private socket: WebSocket | null = null;
  private inflight = 0;
  private paused = false;
  private exitPayload: string | null = null;
  private cwdTimer: NodeJS.Timeout | null = null;
  private cwdPolling = false;
  /** true once OSC 7 has reported cwd — the poll fallback then stops */
  private oscCwd = false;
  private readonly tempDir: string | undefined;
  // asciicast v2 ring buffer ("o" + "r" only — input is never recorded)
  private readonly castEvents: CastEvent[] = [];
  private castBytes = 0;
  castTruncated = false;

  constructor(
    readonly cwd: string,
    private readonly root: string,
    cols = 80,
    rows = 24,
    private readonly onUpdate: () => void,
  ) {
    this.cwdAbs = cwd;
    const shell = pickShell();
    this.title = shell.split("/").pop() ?? shell;
    this.mirror = new Terminal({ cols, rows, scrollback: SCROLLBACK, allowProposedApi: true });
    this.mirror.loadAddon(this.serializer);

    // OSC 7: the shell reports its real cwd instantly/exactly; this makes
    // the poll loop a fallback for shells where the hook didn't load.
    this.mirror.parser.registerOscHandler(7, (payload) => {
      const dir = parseOsc7(payload);
      if (dir) {
        this.oscCwd = true;
        this.stopCwdPolling();
        if (dir !== this.cwdAbs) {
          this.cwdAbs = dir;
          this.send(encodeFrame(ServerOp.Cwd, JSON.stringify(this.cwdPayload())));
          this.onUpdate();
        }
      }
      return true;
    });

    const injection = process.platform === "win32" ? null : buildInjection(shell);
    this.tempDir = injection?.tempDir;
    const args = injection?.args ?? (process.platform === "win32" ? [] : ["-l"]);
    this.pty = pty.spawn(shell, args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd,
      env: {
        ...process.env,
        ...injection?.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        WEBCODE: "1",
      },
    });

    this.pty.onData((data) => {
      this.mirror.write(data);
      this.recordEvent("o", data);
      const proc = this.pty.process;
      if (proc && proc !== this.title) {
        this.title = proc;
        this.send(encodeFrame(ServerOp.Title, JSON.stringify({ title: this.title })));
        this.onUpdate();
      }
      if (this.socket) {
        const frame = encodeFrame(ServerOp.Output, Buffer.from(data, "utf8"));
        this.inflight += frame.length - 1;
        this.send(frame);
        if (!this.paused && this.inflight > FLOW_HIGH_WATER) {
          this.paused = true;
          this.pty.pause();
        }
      }
    });

    this.pty.onExit(({ exitCode, signal }) => {
      this.alive = false;
      this.exitPayload = JSON.stringify({ exitCode, signal });
      this.send(encodeFrame(ServerOp.Exit, this.exitPayload));
      this.onUpdate();
    });
  }

  /** Single-attachment model: a new client takes over the session. */
  attach(ws: WebSocket): void {
    if (this.socket && this.socket !== ws) {
      this.socket.close(4000, "session attached elsewhere");
    }
    this.socket = ws;
    this.resetFlow();
    const snapshot = this.serializer.serialize({ scrollback: SCROLLBACK });
    ws.send(encodeFrame(ServerOp.Replay, snapshot));
    ws.send(encodeFrame(ServerOp.Cwd, JSON.stringify(this.cwdPayload())));
    if (!this.alive && this.exitPayload) {
      ws.send(encodeFrame(ServerOp.Exit, this.exitPayload));
    }
    this.startCwdPolling();
  }

  detach(ws: WebSocket): void {
    if (this.socket === ws) {
      this.socket = null;
      this.resetFlow();
      this.stopCwdPolling();
    }
  }

  // ── cwd tracking ───────────────────────────────────────────────────

  private cwdPayload(): CwdPayload {
    const inside =
      this.cwdAbs === this.root || this.cwdAbs.startsWith(this.root + "/");
    return inside
      ? { cwd: toRel(this.root, this.cwdAbs) }
      : { cwd: this.cwdAbs, outside: true };
  }

  private startCwdPolling(): void {
    if (this.cwdTimer || !this.alive || this.oscCwd) return;
    this.cwdTimer = setInterval(() => {
      if (this.cwdPolling) return;
      this.cwdPolling = true;
      void processCwd(this.pty.pid)
        .then((dir) => {
          if (dir && dir !== this.cwdAbs) {
            this.cwdAbs = dir;
            this.send(encodeFrame(ServerOp.Cwd, JSON.stringify(this.cwdPayload())));
            this.onUpdate();
          }
        })
        .finally(() => {
          this.cwdPolling = false;
        });
    }, CWD_POLL_MS);
  }

  private stopCwdPolling(): void {
    if (this.cwdTimer) {
      clearInterval(this.cwdTimer);
      this.cwdTimer = null;
    }
  }

  // ── asciicast recording ────────────────────────────────────────────

  private recordEvent(code: "o" | "r", data: string): void {
    this.castEvents.push([(Date.now() - this.createdAt) / 1000, code, data]);
    this.castBytes += data.length;
    while (
      this.castEvents.length > REC_MAX_EVENTS ||
      (this.castBytes > REC_MAX_BYTES && this.castEvents.length > 1)
    ) {
      const dropped = this.castEvents.shift()!;
      this.castBytes -= dropped[2].length;
      this.castTruncated = true;
    }
  }

  /** Serialize the buffer as asciicast v2 (NDJSON). */
  recording(): string {
    const header = {
      version: 2,
      width: this.pty.cols,
      height: this.pty.rows,
      timestamp: Math.floor(this.createdAt / 1000),
      title: `webcode — ${this.title}`,
      env: { SHELL: process.env.SHELL ?? "", TERM: "xterm-256color" },
    };
    const lines = [JSON.stringify(header)];
    for (const ev of this.castEvents) {
      lines.push(JSON.stringify([Math.round(ev[0] * 1000) / 1000, ev[1], ev[2]]));
    }
    return lines.join("\n") + "\n";
  }

  write(data: string): void {
    if (this.alive) this.pty.write(data);
  }

  resize(cols: number, rows: number): void {
    if (!Number.isInteger(cols) || !Number.isInteger(rows)) return;
    if (cols < 2 || rows < 1 || cols > 1000 || rows > 1000) return;
    this.mirror.resize(cols, rows);
    if (this.alive) this.pty.resize(cols, rows);
    this.recordEvent("r", `${cols}x${rows}`);
  }

  /** Client reports bytes it has finished rendering. */
  ack(bytes: number): void {
    if (!Number.isFinite(bytes) || bytes < 0) return;
    this.inflight = Math.max(0, this.inflight - bytes);
    if (this.paused && this.inflight < FLOW_LOW_WATER) {
      this.paused = false;
      if (this.alive) this.pty.resume();
    }
  }

  /** Nobody is listening: stop counting and let the PTY run free. */
  private resetFlow(): void {
    this.inflight = 0;
    if (this.paused) {
      this.paused = false;
      if (this.alive) this.pty.resume();
    }
  }

  private send(frame: Buffer): void {
    if (this.socket && this.socket.readyState === this.socket.OPEN) {
      this.socket.send(frame);
    }
  }

  kill(): void {
    this.stopCwdPolling();
    this.socket?.close(1000, "session closed");
    this.socket = null;
    if (this.alive) {
      try {
        this.pty.kill();
      } catch {
        // already gone
      }
    }
    this.mirror.dispose();
    cleanupInjection(this.tempDir);
  }

  info(): SessionInfo {
    return {
      id: this.id,
      title: this.title,
      cwd: this.cwdAbs,
      alive: this.alive,
      createdAt: this.createdAt,
    };
  }
}

export class SessionManager {
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly defaultCwd: string = os.homedir()) {}

  create(cwd?: string, cols?: number, rows?: number): Session {
    const session = new Session(cwd ?? this.defaultCwd, this.defaultCwd, cols, rows, () => {});
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  list(): SessionInfo[] {
    return [...this.sessions.values()]
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((s) => s.info());
  }

  close(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.kill();
    this.sessions.delete(id);
    return true;
  }

  shutdown(): void {
    for (const session of this.sessions.values()) session.kill();
    this.sessions.clear();
  }
}
