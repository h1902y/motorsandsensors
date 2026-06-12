// zuzuu/sessions/git.mjs — git PLUMBING for session-git (no session policy here).
//
// Every helper is safe-by-construction: argv arrays only (no shell strings),
// never throws, returns plain data. Session POLICY (open/checkpoint/close/
// status and the safety gates) lives in session-git.mjs.

import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join, isAbsolute, resolve } from 'node:path';

/** One git call — argv array only (no shell), never throws. */
export function git(args, cwd, input) {
  try {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8', input });
    return { ok: r.status === 0 && !r.error, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
  } catch (e) {
    return { ok: false, out: '', err: String(e) };
  }
}

export function gitDir(cwd) {
  const r = git(['rev-parse', '--git-dir'], cwd);
  if (!r.ok || !r.out) return null;
  return isAbsolute(r.out) ? r.out : resolve(cwd, r.out);
}

/** Current branch name, or null when detached / not a repo. */
export function currentBranch(cwd) {
  const r = git(['symbolic-ref', '--short', '-q', 'HEAD'], cwd);
  return r.ok && r.out ? r.out : null;
}

export const branchExists = (cwd, name) => git(['rev-parse', '-q', '--verify', `refs/heads/${name}`], cwd).ok;
export const isDirty = (cwd) => !!git(['status', '--porcelain'], cwd).out;

/** Best-effort: drop squash leftovers so they can't leak into the user's next commit. */
export function cleanupSquashState(cwd) {
  const gd = gitDir(cwd);
  if (!gd) return;
  for (const f of ['SQUASH_MSG', 'MERGE_MSG']) {
    try {
      rmSync(join(gd, f), { force: true });
    } catch {
      /* best-effort */
    }
  }
}
