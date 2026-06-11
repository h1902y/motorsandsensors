import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import fsp from "node:fs/promises";
import path from "node:path";
import type { FileListResponse } from "@zuzuu-web/protocol";
import { toRel } from "./safe-path.js";

const execFileAsync = promisify(execFile);

const IGNORE = new Set([".git", "node_modules", "dist", ".next", ".cache"]);

let rgAvailable: boolean | null = null;
async function hasRg(): Promise<boolean> {
  if (rgAvailable === null) {
    rgAvailable = await execFileAsync("rg", ["--version"], { timeout: 2000 })
      .then(() => true)
      .catch(() => false);
  }
  return rgAvailable;
}

/**
 * Flat list of workspace files for the ⌘K palette. Prefers `rg --files`
 * (honors .gitignore, fast); falls back to a bounded manual walk.
 */
export async function listFiles(root: string, limit = 5000): Promise<FileListResponse> {
  if (await hasRg()) return rgFiles(root, limit);
  return walkFiles(root, limit);
}

function rgFiles(root: string, limit: number): Promise<FileListResponse> {
  return new Promise((resolve) => {
    const proc = spawn("rg", ["--files", "--hidden", "-g", "!.git"], {
      cwd: root,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const files: string[] = [];
    let buf = "";
    let truncated = false;
    proc.stdout.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (line) files.push(line);
        if (files.length >= limit) {
          truncated = true;
          proc.kill("SIGTERM");
          resolve({ files, truncated });
          return;
        }
      }
    });
    proc.on("close", () => resolve({ files, truncated }));
    proc.on("error", () => resolve({ files, truncated }));
  });
}

async function walkFiles(root: string, limit: number): Promise<FileListResponse> {
  const files: string[] = [];
  let truncated = false;
  const stack = [root];
  while (stack.length > 0 && files.length < limit) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") && e.name !== ".webcode") continue;
      if (IGNORE.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile()) {
        files.push(toRel(root, full));
        if (files.length >= limit) {
          truncated = true;
          break;
        }
      }
    }
  }
  files.sort();
  return { files, truncated };
}
