# webcode — hosted cloud sandbox

A "play around in the cloud" mode: a global launch page hands any visitor a
disposable Linux **micro-VM** running the real webcode daemon — terminal,
files, run code — with nothing to install. Built on **Fly.io Machines**
(per-user Firecracker VMs); the VM boundary is the isolation for untrusted
public users.

```
browser ──POST /api/sessions──► broker ──Fly Machines API──► creates a Machine (one per user)
   └──────── opens the returned URL ───────► the user's VM (webcode daemon serves UI + PTY/WS)
```

## Pieces
- **`sandbox/`** — the VM image. `Dockerfile` builds the daemon + a minimal
  userland + a non-root `sandbox` user; `entrypoint.sh` seeds an empty
  workspace and runs the daemon in hosted mode on `:8080`. `fly.toml` configures
  one Fly app with `auto_stop_machines` (idle → stopped → ~$0.15/GB-mo at rest).
- **`broker/`** — control plane (Hono). `GET /` launch page, `POST /api/sessions`
  (per-IP + global caps → creates a Machine with a fresh per-session token →
  returns its URL), `DELETE /api/sessions/:id`, and a TTL reaper. Two backends:
  - `local` (default) — spawns the hosted daemon as a child process; lets you
    verify the whole flow with **no Docker/Fly** (`npm start` in `broker/`, open
    `http://localhost:7790`).
  - `fly` — real Firecracker Machines via `https://api.machines.dev`.

## Daemon hosted mode
The daemon (`packages/daemon`) gains an env-gated hosted mode (local behaviour
unchanged): `WEBCODE_HOSTED=1` binds `0.0.0.0`, takes `WEBCODE_TOKEN` +
`WEBCODE_ROOT` from env, and adds `WEBCODE_PUBLIC_HOST` to the Host/Origin
allowlists (the gates stay on, just widened to the public origin).

## Run locally (no Fly needed)
```bash
cd hosted/broker && npm install && npm start     # backend=local
open http://localhost:7790                        # → Launch a sandbox
```

## Deploy on Fly
```bash
fly apps create webcode-sandbox
fly deploy -c hosted/sandbox/fly.toml             # builds & pushes the image
# run the broker (anywhere) with:
BROKER_BACKEND=fly FLY_APP=webcode-sandbox \
  FLY_API_TOKEN=… SANDBOX_IMAGE=registry.fly.io/webcode-sandbox:<deploy> \
  SANDBOX_PUBLIC_HOST=webcode-sandbox.fly.dev npm start
```
Broker env: `SANDBOX_TTL_MIN` (default 30), `MAX_SANDBOXES` (50), `MAX_PER_IP`
(2), `SANDBOX_MEMORY_MB` (512), `FLY_REGION`.

## Before public launch (hardening — P3)
Egress throttling/policy (anti-abuse), CPU/RAM/disk quotas, a Turnstile
challenge on session create, monitoring + central kill-switch, and tuned
scale-to-zero. The per-user Firecracker VM is the isolation boundary; never run
the daemon with `WEBCODE_HOSTED=1` outside an isolated VM.
