import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DIR = path.join(os.homedir(), ".webcode");
const FILE = path.join(DIR, "config.json");
const RECENT_MAX = 10;

export interface WebcodeConfig {
  recent: string[];
  onboarded: boolean;
}

const DEFAULT: WebcodeConfig = { recent: [], onboarded: false };

/** Load persisted config, tolerating a missing/corrupt file. */
export async function load(): Promise<WebcodeConfig> {
  try {
    const raw = await fsp.readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<WebcodeConfig>;
    return {
      recent: Array.isArray(parsed.recent) ? parsed.recent.filter((p) => typeof p === "string") : [],
      onboarded: parsed.onboarded === true,
    };
  } catch {
    return { ...DEFAULT };
  }
}

async function save(cfg: WebcodeConfig): Promise<void> {
  await fsp.mkdir(DIR, { recursive: true });
  await fsp.writeFile(FILE, JSON.stringify(cfg, null, 2) + "\n", "utf8");
}

/** Prepend a workspace to the recent list (deduped, most-recent-first, capped). */
export async function addRecent(root: string): Promise<WebcodeConfig> {
  const cfg = await load();
  cfg.recent = [root, ...cfg.recent.filter((p) => p !== root)].slice(0, RECENT_MAX);
  await save(cfg);
  return cfg;
}

export async function setOnboarded(): Promise<WebcodeConfig> {
  const cfg = await load();
  cfg.onboarded = true;
  await save(cfg);
  return cfg;
}

/** Pure helper (exported for tests): compute the next recent list. */
export function nextRecent(recent: string[], root: string): string[] {
  return [root, ...recent.filter((p) => p !== root)].slice(0, RECENT_MAX);
}

/** Synchronous best-effort load for startup paths that can't await. */
export function loadSync(): WebcodeConfig {
  try {
    return { ...DEFAULT, ...(JSON.parse(fs.readFileSync(FILE, "utf8")) as WebcodeConfig) };
  } catch {
    return { ...DEFAULT };
  }
}
