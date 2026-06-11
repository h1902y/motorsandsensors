import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { BrowseResponse } from "@zuzuu-web/protocol";

const MAX_ENTRIES = 1000;

/**
 * List the subdirectories of an absolute path, for the vault folder picker.
 *
 * SECURITY: this deliberately reads OUTSIDE the workspace sandbox — choosing
 * a new vault means browsing the user's own machine. It is intentionally not
 * routed through `safePath`. Mitigations: auth-gated + loopback-only at the
 * server layer, and it returns DIRECTORY NAMES ONLY (never file contents).
 */
export async function listDirs(input?: string): Promise<BrowseResponse> {
  const abs = input && path.isAbsolute(input) ? path.resolve(input) : os.homedir();
  const parent = path.dirname(abs);
  const dirs: { name: string; path: string }[] = [];

  const entries = await fsp.readdir(abs, { withFileTypes: true });
  for (const e of entries) {
    if (dirs.length >= MAX_ENTRIES) break;
    if (e.name.startsWith(".")) continue;
    let isDir = e.isDirectory();
    if (e.isSymbolicLink()) {
      try {
        isDir = (await fsp.stat(path.join(abs, e.name))).isDirectory();
      } catch {
        isDir = false;
      }
    }
    if (isDir) dirs.push({ name: e.name, path: path.join(abs, e.name) });
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name));
  return { path: abs, parent: parent === abs ? null : parent, dirs };
}

/** Create a directory under an absolute parent, returning its absolute path. */
export async function mkdirIn(parent: string, name: string): Promise<string> {
  if (!path.isAbsolute(parent)) throw new Error("parent must be absolute");
  if (!name || name.includes("/") || name.includes("\\") || name === "." || name === "..") {
    throw new Error("invalid folder name");
  }
  const abs = path.join(parent, name);
  await fsp.mkdir(abs, { recursive: false });
  return abs;
}
