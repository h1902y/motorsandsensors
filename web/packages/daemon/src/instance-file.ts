// Per-workspace daemon instance state — the singleton contract with `zuzuu web`.
//
// After a successful listen the daemon writes
//   ~/.webcode/instances/<sha256(realpath-root).slice(0,16)>.json
// and removes it on clean shutdown. The zuzuu CLI computes the same path for a
// workspace to discover (and reuse / stop) an already-running daemon instead of
// spawning a fresh one — so the port + token stay stable across `zuzuu web` runs.
//
// Security note: the file contains the auth token. That's acceptable here —
// it's 0600 in the user's own home directory, and the same token already
// appears in the daemon's own stdout URL. Hosted mode never writes this file.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface InstanceInfo {
  root: string;
  port: number;
  pid: number;
  token: string;
  startedAt: string;
  version: string;
}

export function instancesDir(): string {
  return path.join(os.homedir(), ".webcode", "instances");
}

/** Deterministic per-workspace file path. `root` must already be realpath'd. */
export function instancePath(root: string, dir: string = instancesDir()): string {
  const id = crypto.createHash("sha256").update(root).digest("hex").slice(0, 16);
  return path.join(dir, `${id}.json`);
}

/** Write the instance file (0600). Never throws — a failed write only costs reuse. */
export function writeInstanceFile(info: InstanceInfo, dir: string = instancesDir()): string | null {
  const file = instancePath(info.root, dir);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(info, null, 2) + "\n", { mode: 0o600 });
    fs.chmodSync(file, 0o600); // mode option only applies on create; enforce on overwrite too
    return file;
  } catch (err) {
    console.warn(`zuzuu-web: could not write instance state (${String(err)}) — continuing without it`);
    return null;
  }
}

/** Best-effort read; null on missing/corrupt. */
export function readInstanceFile(root: string, dir: string = instancesDir()): InstanceInfo | null {
  try {
    return JSON.parse(fs.readFileSync(instancePath(root, dir), "utf8")) as InstanceInfo;
  } catch {
    return null;
  }
}

/**
 * Best-effort removal on shutdown. Only removes the file if it still belongs
 * to `pid` — if another daemon raced us and overwrote it, leave theirs alone.
 */
export function removeInstanceFile(
  root: string,
  pid: number = process.pid,
  dir: string = instancesDir(),
): void {
  const file = instancePath(root, dir);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<InstanceInfo>;
    if (typeof parsed.pid === "number" && parsed.pid !== pid) return; // not ours anymore
    fs.unlinkSync(file);
  } catch {
    /* already gone or unreadable — nothing to do */
  }
}
