import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitStatusEntry, GitStatusResponse } from "@zuzuu-web/protocol";

const execFileAsync = promisify(execFile);

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: root,
    maxBuffer: 16 * 1024 * 1024,
    timeout: 10_000,
  });
  return stdout;
}

async function isRepo(root: string): Promise<boolean> {
  try {
    const out = await git(root, ["rev-parse", "--is-inside-work-tree"]);
    return out.trim() === "true";
  } catch {
    return false;
  }
}

export async function status(root: string): Promise<GitStatusResponse> {
  if (!(await isRepo(root))) return { repo: false, branch: "", entries: [] };

  let branch = "";
  try {
    branch = (await git(root, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  } catch {
    branch = "(detached)";
  }

  // -z gives NUL-separated records; renames emit an extra NUL with the old path
  const raw = await git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const entries: GitStatusEntry[] = [];
  const parts = raw.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i];
    if (!rec || rec.length < 3) continue;
    const index = rec[0]!;
    const worktree = rec[1]!;
    const path = rec.slice(3);
    // a rename/copy ("R"/"C") consumes the following NUL field (old path)
    if (index === "R" || index === "C") i++;
    entries.push({ path, index, worktree });
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return { repo: true, branch, entries };
}

/** HEAD/index content of a path for the diff editor's left side. */
export async function diffOriginal(root: string, path: string): Promise<string> {
  // staged content if present, else HEAD; empty for untracked/new files
  for (const ref of [`:${path}`, `HEAD:${path}`]) {
    try {
      return await git(root, ["show", ref]);
    } catch {
      // try next
    }
  }
  return "";
}

export async function stage(root: string, paths: string[]): Promise<void> {
  if (paths.length) await git(root, ["add", "--", ...paths]);
}

export async function unstage(root: string, paths: string[]): Promise<void> {
  if (paths.length) await git(root, ["reset", "-q", "HEAD", "--", ...paths]);
}

export async function commit(root: string, message: string): Promise<void> {
  await git(root, ["commit", "-m", message]);
}
