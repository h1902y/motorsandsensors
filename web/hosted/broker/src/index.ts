import crypto from "node:crypto";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { localBackend, flyBackend, type Backend } from "./backends.js";

// ── config (env) ────────────────────────────────────────────────────
const PORT = Number(process.env.BROKER_PORT) || 7790;
const BACKEND = process.env.BROKER_BACKEND ?? "local"; // "local" | "fly"
const TTL_MS = (Number(process.env.SANDBOX_TTL_MIN) || 30) * 60_000;
const MAX_TOTAL = Number(process.env.MAX_SANDBOXES) || 50;
const MAX_PER_IP = Number(process.env.MAX_PER_IP) || 2;

const backend: Backend =
  BACKEND === "fly"
    ? flyBackend({
        app: required("FLY_APP"),
        apiToken: required("FLY_API_TOKEN"),
        image: required("SANDBOX_IMAGE"), // registry.fly.io/webcode-sandbox:deployment-…
        publicHost: required("SANDBOX_PUBLIC_HOST"), // webcode-sandbox.fly.dev
        region: process.env.FLY_REGION,
        memoryMb: Number(process.env.SANDBOX_MEMORY_MB) || 512,
      })
    : localBackend();

// ── session registry ────────────────────────────────────────────────
interface Session {
  id: string;
  instanceId: string;
  ip: string;
  url: string;
  createdAt: number;
  expiresAt: number;
}
const sessions = new Map<string, Session>();

function ipOf(req: Request, fallback: string): string {
  // Fly sets Fly-Client-IP; behind other proxies use X-Forwarded-For.
  return (
    req.headers.get("fly-client-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    fallback
  );
}

const app = new Hono();

app.get("/healthz", (c) => c.json({ ok: true, backend: BACKEND, live: sessions.size }));

// Public launch page — "Try webcode in the cloud". Click → POST /api/sessions
// → redirect into the freshly-provisioned sandbox VM.
app.get("/", (c) =>
  c.html(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>webcode — cloud sandbox</title>
<style>
:root{color-scheme:dark}
body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
  background:#0a0d12;color:#dde4ee;font:14px/1.5 "JetBrains Mono",ui-monospace,Menlo,monospace}
.card{max-width:30rem;padding:2.5rem;border:1px solid #2a3343;border-radius:10px;background:#141a25;
  box-shadow:0 24px 64px -16px rgba(0,0,0,.6)}
h1{margin:.2rem 0 0;font-size:1.25rem}.dot{color:#5be6c4;font-size:2rem}
p{color:#97a3b6}button{margin-top:1.5rem;width:100%;padding:.7rem;border:1px solid #2f9a80;border-radius:6px;
  background:rgba(91,230,196,.14);color:#5be6c4;font:inherit;cursor:pointer}
button:hover{background:rgba(91,230,196,.22)}button:disabled{opacity:.5;cursor:default}
small{color:#5a6678}
</style></head><body><div class="card">
<div class="dot">❯_</div><h1>webcode in the cloud</h1>
<p>Spin up a disposable Linux micro-VM — a real terminal, files, and code, right in your browser. Nothing to install.</p>
<button id="go" onclick="launch()">Launch a sandbox →</button>
<p><small>Throwaway &amp; isolated. It self-destroys when idle.</small></p>
</div><script>
async function launch(){const b=document.getElementById('go');b.disabled=true;b.textContent='Starting your VM…';
try{const r=await fetch('/api/sessions',{method:'POST'});const d=await r.json();
if(!r.ok){b.textContent=d.error||'Failed';if(d.reuse)location.href=d.reuse;else b.disabled=false;return;}
location.href=d.url;}catch(e){b.textContent='Error: '+e.message;b.disabled=false;}}
</script></body></html>`),
);

// Create (or reuse) a sandbox for the caller and return its URL.
app.post("/api/sessions", async (c) => {
  const ip = ipOf(c.req.raw, "local");

  // abuse caps
  const mine = [...sessions.values()].filter((s) => s.ip === ip);
  if (mine.length >= MAX_PER_IP) {
    return c.json({ error: "too many sandboxes from your address", reuse: mine[0]!.url }, 429);
  }
  if (sessions.size >= MAX_TOTAL) {
    return c.json({ error: "sandbox capacity reached, try again shortly" }, 503);
  }

  const id = crypto.randomBytes(8).toString("hex");
  const token = crypto.randomBytes(24).toString("base64url");
  let sandbox;
  try {
    sandbox = await backend.create(token);
  } catch (err) {
    return c.json({ error: `could not start sandbox: ${(err as Error).message}` }, 502);
  }
  const now = Date.now();
  const session: Session = {
    id,
    instanceId: sandbox.instanceId,
    ip,
    url: sandbox.url,
    createdAt: now,
    expiresAt: now + TTL_MS,
  };
  sessions.set(id, session);
  return c.json({ id, url: sandbox.url, expiresAt: session.expiresAt });
});

// Explicit teardown (best-effort; the reaper also handles TTL).
app.delete("/api/sessions/:id", async (c) => {
  const s = sessions.get(c.req.param("id"));
  if (!s) return c.json({ ok: true });
  sessions.delete(s.id);
  await backend.destroy(s.instanceId);
  return c.json({ ok: true });
});

// ── TTL reaper ──────────────────────────────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const s of sessions.values()) {
    if (now > s.expiresAt) {
      sessions.delete(s.id);
      void backend.destroy(s.instanceId);
    }
  }
}, 30_000);

serve({ fetch: app.fetch, port: PORT }, () =>
  console.log(`webcode broker on :${PORT} (backend=${BACKEND}, ttl=${TTL_MS / 60000}m, cap=${MAX_TOTAL})`),
);

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`broker: missing required env ${name} for the fly backend`);
    process.exit(1);
  }
  return v;
}
