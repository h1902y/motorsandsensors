import path from "node:path";
import fs from "node:fs/promises";

/**
 * Every filesystem path the browser sends goes through this module before
 * touching disk. The daemon runs with the user's full filesystem rights, so
 * this is the security choke point: it must reject `..` traversal, absolute
 * escapes, and symlinks that point outside the workspace root.
 */

export class PathError extends Error {
  readonly status = 403;
}

/**
 * Resolve a workspace-relative input against the root and reject anything
 * that lexically escapes it. Pure string logic — no filesystem access.
 * A leading `/` in the input is treated as "relative to the workspace root".
 */
export function safeJoin(root: string, input: string): string {
  if (input.includes("\0")) throw new PathError("invalid path");
  const rel = input.replace(/^[/\\]+/, "");
  const resolved = path.resolve(root, rel);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new PathError(`path escapes workspace: ${input}`);
  }
  return resolved;
}

/**
 * `safeJoin` plus symlink defense: the deepest existing ancestor of the
 * resolved path is realpath'd and must still live inside the (already
 * realpath'd) root. Defends against both a symlink at the target itself and
 * symlinked intermediate directories pointing out of the workspace.
 *
 * `realRoot` MUST be the result of `fs.realpath` (done once at startup).
 */
export async function resolveSafe(realRoot: string, input: string): Promise<string> {
  const abs = safeJoin(realRoot, input);
  let probe = abs;
  for (;;) {
    let real: string;
    try {
      real = await fs.realpath(probe);
    } catch {
      const parent = path.dirname(probe);
      if (parent === probe) break; // hit fs root without finding anything
      probe = parent;
      continue;
    }
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
      throw new PathError(`path resolves outside workspace: ${input}`);
    }
    break;
  }
  return abs;
}

/** Workspace-relative display path with forward slashes ("" for the root). */
export function toRel(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join("/");
}
