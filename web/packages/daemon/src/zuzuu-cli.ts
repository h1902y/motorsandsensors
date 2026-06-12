// The zuzuu CLI spawn layer — the ONLY place the daemon shells out to the
// `zuzuu` binary. Two flavours:
//   runZuzuu    — reads: any failure (absent, non-zero, unparseable) → null;
//                 callers degrade to file-read fallbacks.
//   runZuzuuMut — mutations + CLI-only reads: failures are distinguished
//                 (binary absent vs command failed + stderr tail) so routes
//                 can answer 503 vs 502.
// Always argv arrays (never a shell), time-boxed, cwd-scoped to the workspace.

import { spawn, spawnSync } from "node:child_process";

export interface RunOpts { binary?: string; timeoutMs?: number; }

/** Spawn `zuzuu <args> --json` in `root`. Returns parsed JSON, or null on any
 *  failure (binary absent, non-zero exit, unparseable). Read-only + time-boxed. */
export function runZuzuu(root: string, args: string[], opts: RunOpts = {}): Promise<unknown | null> {
  const binary = opts.binary ?? "zuzuu";
  const timeoutMs = opts.timeoutMs ?? 5000;
  return new Promise((resolve) => {
    let out = "";
    let done = false;
    const finish = (v: unknown | null) => { if (!done) { done = true; resolve(v); } };
    let child;
    try {
      child = spawn(binary, [...args, "--json"], { cwd: root, stdio: ["ignore", "pipe", "ignore"] });
    } catch { finish(null); return; }
    const timer = setTimeout(() => { try { child!.kill(); } catch { /* noop */ } finish(null); }, timeoutMs);
    child.stdout?.on("data", (b) => { out += b.toString(); });
    child.on("error", () => { clearTimeout(timer); finish(null); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return finish(null);
      try { finish(JSON.parse(out)); } catch { finish(null); }
    });
  });
}

export type ZuzuuMutResult =
  | { ok: true; data: unknown }
  | { ok: false; code: "absent" | "failed"; stderr?: string; data?: unknown };

const STDERR_TAIL = 2048;

/** Spawn `zuzuu <args> --json` where the caller needs to distinguish failures
 *  (mutations, and reads with no file fallback). Unlike runZuzuu: binary
 *  absent vs command failed (with a stderr tail) are separate results, so
 *  routes can answer 503 vs 502. Stdout must parse as JSON on success. */
export function runZuzuuMut(root: string, args: string[], opts: RunOpts = {}): Promise<ZuzuuMutResult> {
  const binary = opts.binary ?? "zuzuu";
  const timeoutMs = opts.timeoutMs ?? 10_000;
  return new Promise((resolve) => {
    let out = "";
    let err = "";
    let done = false;
    const finish = (v: ZuzuuMutResult) => { if (!done) { done = true; resolve(v); } };
    let child;
    try {
      child = spawn(binary, [...args, "--json"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    } catch { finish({ ok: false, code: "absent" }); return; }
    const timer = setTimeout(() => {
      try { child!.kill(); } catch { /* noop */ }
      finish({ ok: false, code: "failed", stderr: "zuzuu timed out" });
    }, timeoutMs);
    child.stdout?.on("data", (b) => { out += b.toString(); });
    child.stderr?.on("data", (b) => {
      err += b.toString();
      if (err.length > STDERR_TAIL) err = err.slice(-STDERR_TAIL);
    });
    child.on("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (e.code === "ENOENT") finish({ ok: false, code: "absent" });
      else finish({ ok: false, code: "failed", stderr: e.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        // zuzuu prints structured JSON even on refusals (exit 1, e.g.
        // empty-squash-with-checkpoints) — keep it so the UI can act on reason.
        try {
          const parsed: unknown = JSON.parse(out);
          return finish({ ok: false, code: "failed", stderr: err.slice(-STDERR_TAIL), data: parsed });
        } catch {
          return finish({ ok: false, code: "failed", stderr: err.slice(-STDERR_TAIL) });
        }
      }
      try { finish({ ok: true, data: JSON.parse(out) }); }
      catch { finish({ ok: false, code: "failed", stderr: "unparseable JSON from zuzuu" }); }
    });
  });
}

/** Best-effort: is the zuzuu binary runnable? */
export function binAvailable(binary: string): boolean {
  try {
    const r = spawnSync(binary, ["version"], { stdio: "ignore", timeout: 3000 });
    return !r.error && r.status === 0;
  } catch { return false; }
}
