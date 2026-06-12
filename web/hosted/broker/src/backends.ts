import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", ".."); // hosted/broker/src → repo root

export interface Sandbox {
  instanceId: string;
  /** URL the browser opens (includes ?token=…) */
  url: string;
}

export interface Backend {
  create(token: string): Promise<Sandbox>;
  destroy(instanceId: string): Promise<void>;
}

// ── local backend ───────────────────────────────────────────────────
// Spawns the hosted daemon as a child process — a stand-in "Machine" so the
// whole provisioning + launch flow can be verified with no Docker/Fly.
export function localBackend(): Backend {
  const children = new Map<string, ChildProcess>();
  return {
    async create(token) {
      const port = await freePort();
      const instanceId = crypto.randomBytes(6).toString("hex");
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "wc-vm-"));
      fs.writeFileSync(
        path.join(root, "README.md"),
        "# Your webcode sandbox\n\nDisposable local-emulated VM. Try `python3 -c \"print(1+1)\"`.\n",
      );
      const child = spawn(
        "npx",
        ["tsx", path.join(REPO, "packages/daemon/src/index.ts")],
        {
          cwd: path.join(REPO, "packages/daemon"),
          env: {
            ...process.env,
            WEBCODE_HOSTED: "1",
            WEBCODE_TOKEN: token,
            WEBCODE_ROOT: root,
            WEBCODE_PUBLIC_HOST: `localhost:${port}`,
            PORT: String(port),
          },
          stdio: "ignore",
          detached: false,
        },
      );
      children.set(instanceId, child);
      child.on("exit", () => {
        children.delete(instanceId);
        fs.rm(root, { recursive: true, force: true }, () => {});
      });
      await waitForPort(port, 8000);
      return { instanceId, url: `http://localhost:${port}/?token=${token}` };
    },
    async destroy(instanceId) {
      const child = children.get(instanceId);
      if (child) {
        children.delete(instanceId);
        try {
          child.kill("SIGTERM");
        } catch {
          /* already gone */
        }
      }
    },
  };
}

// ── fly backend ─────────────────────────────────────────────────────
// Creates one Firecracker Machine per session via the Machines API. Needs
// FLY_API_TOKEN + a deployed sandbox app (see hosted/sandbox/fly.toml).
export function flyBackend(opts: {
  app: string;
  apiToken: string;
  image: string;
  publicHost: string; // e.g. "webcode-sandbox.fly.dev"
  region?: string;
  memoryMb?: number;
}): Backend {
  const api = "https://api.machines.dev/v1";
  const headers = {
    Authorization: `Bearer ${opts.apiToken}`,
    "Content-Type": "application/json",
  };
  return {
    async create(token) {
      const res = await fetch(`${api}/apps/${opts.app}/machines`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          region: opts.region ?? "iad",
          config: {
            image: opts.image,
            auto_destroy: true, // VM self-destroys when it stops (idle/TTL)
            guest: { cpu_kind: "shared", cpus: 1, memory_mb: opts.memoryMb ?? 512 },
            env: {
              WEBCODE_HOSTED: "1",
              WEBCODE_TOKEN: token,
              WEBCODE_PUBLIC_HOST: opts.publicHost,
              PORT: "8080",
            },
            services: [
              {
                ports: [
                  { port: 443, handlers: ["tls", "http"] },
                  { port: 80, handlers: ["http"] },
                ],
                protocol: "tcp",
                internal_port: 8080,
                autostop: "stop",
                autostart: true,
              },
            ],
          },
        }),
      });
      if (!res.ok) throw new Error(`fly create failed: ${res.status} ${await res.text()}`);
      const machine = (await res.json()) as { id: string };
      // Pin the browser to this Machine via the fly-force-instance-id cookie,
      // set by the launch redirect; token gates the session.
      return {
        instanceId: machine.id,
        url: `https://${opts.publicHost}/?token=${token}&instance=${machine.id}`,
      };
    },
    async destroy(instanceId) {
      await fetch(`${api}/apps/${opts.app}/machines/${instanceId}?force=true`, {
        method: "DELETE",
        headers,
      }).catch(() => {});
    },
  };
}

// ── helpers ─────────────────────────────────────────────────────────
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const sock = net.connect(port, "127.0.0.1");
      sock.once("connect", () => {
        sock.destroy();
        resolve();
      });
      sock.once("error", () => {
        sock.destroy();
        if (Date.now() > deadline) reject(new Error("sandbox did not start in time"));
        else setTimeout(tick, 150);
      });
    };
    tick();
  });
}
