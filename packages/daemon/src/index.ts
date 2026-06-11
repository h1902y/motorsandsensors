import fsp from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { WebcodeServer } from "./server.js";
import { addRecent } from "./config.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PORT = 7770;

interface CliArgs {
  dir: string;
  port: number;
  host: string;
  open: boolean;
  token: string | null;
  dev: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    dir: process.cwd(),
    port: DEFAULT_PORT,
    host: "127.0.0.1",
    open: true,
    token: null,
    dev: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    switch (a) {
      case "--port":
      case "-p":
        args.port = Number(argv[++i]);
        break;
      case "--host":
        args.host = argv[++i] ?? args.host;
        break;
      case "--no-open":
        args.open = false;
        break;
      case "--token":
        args.token = argv[++i] ?? null;
        break;
      case "--dev":
        args.dev = true;
        break;
      case "--help":
      case "-h":
        console.log(`zuzuu-web — native terminal + file explorer in your browser

Usage: zuzuu-web [dir] [options]

Options:
  -p, --port <n>   port to listen on (default ${DEFAULT_PORT}, scans up if busy)
      --host <h>   bind address (default 127.0.0.1 — do not expose without care)
      --no-open    don't open the browser
      --token <t>  fixed auth token (default: random per run)
      --dev        allow the Vite dev server origin (development only)
  -h, --help       show this help`);
        process.exit(0);
        break;
      default:
        if (!a.startsWith("-")) args.dir = a;
    }
  }
  if (!Number.isInteger(args.port) || args.port < 1 || args.port > 65535) {
    console.error(`invalid port`);
    process.exit(1);
  }
  return args;
}

function findFreePort(start: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryPort = (port: number, left: number) => {
      const probe = net.createServer();
      probe.once("error", (err: NodeJS.ErrnoException) => {
        probe.close();
        if (err.code === "EADDRINUSE" && left > 0) tryPort(port + 1, left - 1);
        else reject(err);
      });
      probe.once("listening", () => probe.close(() => resolve(port)));
      probe.listen(port, host);
    };
    tryPort(start, 20);
  });
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  spawn(cmd, [url], { stdio: "ignore", detached: true, shell: process.platform === "win32" }).unref();
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // ── hosted mode (cloud sandbox) ────────────────────────────────────
  // Driven entirely by env so local behaviour is unchanged. In a per-user
  // micro-VM the VM boundary is the security model; we still keep the
  // token + Host/Origin gates, just widened to the public hostname.
  const hosted = process.env.WEBCODE_HOSTED === "1";
  if (hosted) {
    args.dir = process.env.WEBCODE_ROOT ?? args.dir;
    args.host = "0.0.0.0";
    args.port = Number(process.env.PORT) || 8080;
    args.token = process.env.WEBCODE_TOKEN ?? args.token;
    args.open = false;
  }

  let root: string;
  try {
    root = await fsp.realpath(path.resolve(args.dir));
  } catch {
    console.error(`zuzuu-web: no such directory: ${args.dir}`);
    process.exit(1);
  }
  if (!hosted && args.host !== "127.0.0.1" && args.host !== "localhost" && args.host !== "::1") {
    console.error(
      "zuzuu-web: refusing to bind a non-loopback address — the daemon exposes your filesystem and shell.\n" +
        "  (set WEBCODE_HOSTED=1 only inside an isolated per-user sandbox VM.)",
    );
    process.exit(1);
  }

  const pkg = JSON.parse(
    await fsp.readFile(path.resolve(HERE, "..", "package.json"), "utf8"),
  ) as { version: string };
  const token = args.token ?? crypto.randomBytes(24).toString("base64url");
  if (!hosted) await addRecent(root).catch(() => {}); // remember this workspace
  const port = hosted ? args.port : await findFreePort(args.port, args.host);
  const webDist = path.resolve(HERE, "..", "..", "web", "dist");

  // public origin(s) allowed in hosted mode (the <app>.fly.dev / custom host)
  const publicHost = process.env.WEBCODE_PUBLIC_HOST; // e.g. "myapp.fly.dev"
  const extraOrigins = [
    ...(args.dev ? ["http://localhost:5173", "http://127.0.0.1:5173"] : []),
    ...(publicHost ? [`https://${publicHost}`, `http://${publicHost}`] : []),
  ];

  const server = new WebcodeServer({
    root,
    port,
    host: args.host,
    token,
    webDist,
    version: pkg.version,
    hosted,
    publicHost,
    extraOrigins: extraOrigins.length ? extraOrigins : undefined,
  });

  server.start((boundPort) => {
    const url = hosted
      ? `(hosted) listening on :${boundPort}`
      : `http://127.0.0.1:${boundPort}/?token=${token}`;
    console.log(`\n  zuzuu-web v${pkg.version}`);
    console.log(`  workspace  ${root}`);
    console.log(`  url        ${url}\n`);
    if (args.open) openBrowser(url);
  });

  const shutdown = () => {
    server.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main();
