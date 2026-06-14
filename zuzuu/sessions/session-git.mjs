// zuzuu/sessions/session-git.mjs — invisible session-git: one agent session = one branch.
//
//   OPEN  → create `zz/session-<shortid>` (a branch, never a worktree)
//   TURN  → checkpoint commit ON the session branch
//   END   → squash-merge to main as ONE commit `session: <title>`, delete branch
//
// THE most safety-critical module in the codebase: it runs git mutations inside
// USERS' repos, triggered from fail-open lifecycle hooks. Therefore:
//   - every exported op is try-wrapped and returns { ok:false, reason } — NEVER throws
//   - all git goes through git.mjs plumbing — spawnSync argv arrays, no shell strings
//   - non-repo / bare / detached HEAD / merge-rebase-in-progress / unborn HEAD → no-op
//   - never push, never touch remotes, never auto-resolve conflicts (conflict →
//     abort the squash, restore the branch, leave the repo exactly as before)
//   - single-working-branch invariant: at most ONE `zz/session-*` branch; a
//     leftover (crashed session) BLOCKS new session branches until continued,
//     merged, or discarded — the next-session prompt is the recovery path.
//   - secrets policy: checkpoints NEVER stage secret material (the same family
//     the seeded no-secret-reads guardrail denies: .env/.env.* at any depth,
//     *.pem, *.key, id_rsa*) — excluded files stay untracked in the worktree
//     and are reported as `excludedSecrets`.
//   - checkpoint history is never destroyed silently: an empty squash that
//     still has checkpoints KEEPS the branch (explicit discard is the only
//     way exploration history is dropped).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { git, gitDir, currentBranch, branchExists, isDirty, cleanupSquashState } from './git.mjs';

const PREFIX = 'zz/session-';

/** Why git mutations are unsafe right now, or null when clear. */
function unsafeReason(cwd) {
  const inside = git(['rev-parse', '--is-inside-work-tree'], cwd);
  if (!inside.ok || inside.out !== 'true') return 'not-a-git-repo';
  if (!git(['rev-parse', '-q', '--verify', 'HEAD'], cwd).ok) return 'no-commits';
  if (!currentBranch(cwd)) return 'detached-head';
  const gd = gitDir(cwd);
  if (gd) {
    // An in-progress merge/rebase/cherry-pick/bisect belongs to the USER — a
    // checkpoint commit here would conclude their operation. Hands off.
    for (const f of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'BISECT_LOG', 'rebase-merge', 'rebase-apply']) {
      if (existsSync(join(gd, f))) return 'operation-in-progress';
    }
  }
  return null;
}

/** Project opt-out: `.zuzuu/agent.json` carrying `"sessionGit": false`. */
function optedOut(cwd) {
  try {
    const root = git(['rev-parse', '--show-toplevel'], cwd);
    if (!root.ok || !root.out) return false;
    const f = join(root.out, '.zuzuu', 'agent.json');
    if (!existsSync(f)) return false;
    return JSON.parse(readFileSync(f, 'utf8')).sessionGit === false;
  } catch {
    return false; // an unreadable manifest never *enables* danger — but opt-out is explicit
  }
}

function disabledReason(cwd) {
  const r = unsafeReason(cwd);
  if (r) return r;
  if (optedOut(cwd)) return 'opted-out';
  return null;
}

/** True when session-git may act here: a usable git repo, not opted out. */
export function sessionGitEnabled(cwd) {
  try {
    return !disabledReason(cwd);
  } catch {
    return false;
  }
}

/** `zz/session-` + first 8 of the id, sanitized to [a-z0-9]. */
export function sessionBranchName(sessionId) {
  const short = String(sessionId ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
  return PREFIX + (short || 'unknown');
}

/** All `zz/session-*` branches (there should be at most one — the invariant). */
export function listSessionBranches(cwd) {
  try {
    const r = git(['for-each-ref', '--format=%(refname:short)', `refs/heads/${PREFIX}*`], cwd);
    return r.ok && r.out ? r.out.split('\n').filter(Boolean) : [];
  } catch {
    return [];
  }
}

/**
 * The branch sessions merge back into. Preference order:
 *   1. the branch HEAD was on when the session opened (recorded as
 *      `branch.<session>.zz-base` config at open — survives crashes)
 *   2. origin/HEAD's branch, if it exists locally
 *   3. local `main`, then `master`
 *   4. the current branch, if it isn't itself a session branch
 */
export function mainBranch(cwd) {
  try {
    for (const b of listSessionBranches(cwd)) {
      const base = git(['config', `branch.${b}.zz-base`], cwd);
      if (base.ok && base.out && branchExists(cwd, base.out)) return base.out;
    }
    const oh = git(['symbolic-ref', 'refs/remotes/origin/HEAD'], cwd);
    if (oh.ok && oh.out) {
      const name = oh.out.replace('refs/remotes/origin/', '');
      if (branchExists(cwd, name)) return name;
    }
    if (branchExists(cwd, 'main')) return 'main';
    if (branchExists(cwd, 'master')) return 'master';
    const cur = currentBranch(cwd);
    return cur && !cur.startsWith(PREFIX) ? cur : null;
  } catch {
    return null;
  }
}

/** Commits on the session branch beyond main (best-effort; 0 on any trouble). */
function countCheckpoints(cwd, branch) {
  const main = mainBranch(cwd);
  if (!main || main === branch) return 0;
  const r = git(['rev-list', '--count', `${main}..${branch}`], cwd);
  const n = r.ok ? Number.parseInt(r.out, 10) : NaN;
  return Number.isFinite(n) ? n : 0;
}

/**
 * OPEN: create the session branch (dirty tree fine — changes ride along).
 *   already on this session's branch (host restart) → { ok:true, resumed:true }
 *   another session branch exists (leftover)        → { ok:false, blocked:true, existing }
 */
export function openSession(cwd, sessionId) {
  try {
    const reason = disabledReason(cwd);
    if (reason) return { ok: false, reason };
    const target = sessionBranchName(sessionId);
    const cur = currentBranch(cwd);
    if (cur === target) return { ok: true, resumed: true, branch: target };
    const existing = listSessionBranches(cwd);
    if (existing.length) return { ok: false, blocked: true, existing: existing[0] };
    const r = git(['checkout', '-q', '-b', target], cwd);
    if (!r.ok) return { ok: false, reason: r.err || 'checkout-failed' };
    git(['config', `branch.${target}.zz-base`, cur], cwd); // remember where to merge back (best-effort)
    return { ok: true, branch: target };
  } catch (e) {
    return { ok: false, reason: String(e) };
  }
}

// The secret family checkpoints must never commit — mirrors the seeded
// no-secret-reads guardrail (scaffold.mjs RULES_SEED: .env / id_rsa / .pem).
const SECRET_GLOBS = ['.env', '.env.*', '**/.env', '**/.env.*', '**/*.pem', '**/*.key', '**/id_rsa*'];
const SECRET_RE = /(^|\/)\.env(\.|$)|(^|\/)id_rsa[^/]*$|\.pem$|\.key$/;

/** How many dirty/untracked paths are secret-family (and so were excluded). */
function countExcludedSecrets(cwd) {
  const out = git(['status', '--porcelain', '-uall'], cwd).out; // -uall: expand untracked dirs
  if (!out) return 0;
  let n = 0;
  for (const line of out.split('\n')) {
    const p = line.slice(3);
    const path = (p.includes(' -> ') ? p.split(' -> ').pop() : p).replace(/^"|"$/g, '');
    if (SECRET_RE.test(path)) n += 1;
  }
  return n;
}

// zuzuu's OWN tracked files churn at runtime (the session index is rewritten on
// every capture). They must NOT count as USER dirt that blocks a session merge,
// and they're safe to reset before the branch dance — `capture`/`doctor`
// regenerate them. (.traces/.live are git-ignored; sessions.json is the tracked one.)
const ZUZUU_OWN_PATH = '.zuzuu/sessions.json';
// Let git itself exclude zuzuu's own files (robust — no porcelain parsing, which
// the trimming git() wrapper would shift off-by-one on a leading-space status).
const EXCLUDE_ZUZUU_OWN = `:(exclude)${ZUZUU_OWN_PATH}`;

/** Worktree has changes the USER cares about — anything beyond zuzuu's own
 *  runtime-managed tracked files. Gates a merge from off the session branch. */
function userDirty(cwd) {
  return !!git(['status', '--porcelain', '-uall', '--', '.', EXCLUDE_ZUZUU_OWN], cwd).out;
}

/** Reset zuzuu's OWN tracked index churn to HEAD so it can't block a checkout.
 *  Best-effort; only acts when that file is actually dirty. */
function resetZuzuuOwn(cwd) {
  if (git(['status', '--porcelain', '--', ZUZUU_OWN_PATH], cwd).out) {
    git(['checkout', '-q', '--', ZUZUU_OWN_PATH], cwd);
  }
}

/** TURN: checkpoint commit — only ON a session branch, only when dirty. NEVER commits on main.
 *  Secret-family files are excluded from staging (left untracked/unstaged);
 *  the count of excluded paths is returned as `excludedSecrets` when > 0. */
export function checkpoint(cwd) {
  try {
    const blocked = unsafeReason(cwd);
    if (blocked) return { ok: false, reason: blocked };
    const cur = currentBranch(cwd);
    if (!cur || !cur.startsWith(PREFIX)) return { ok: false, reason: 'not-on-session-branch' };
    const base = countCheckpoints(cwd, cur);
    if (!isDirty(cwd)) return { ok: true, committed: false, n: base };
    const excludedSecrets = countExcludedSecrets(cwd);
    const add = git(['add', '-A', '--', '.', ...SECRET_GLOBS.map((g) => `:(exclude,glob)${g}`)], cwd);
    if (!add.ok) return { ok: false, reason: 'add-failed' };
    if (git(['diff', '--cached', '--quiet'], cwd).ok) {
      // everything dirty was secret material — never an empty commit
      return { ok: true, committed: false, n: base, ...(excludedSecrets ? { excludedSecrets } : {}) };
    }
    const c = git(['commit', '-q', '-m', `zz: checkpoint ${base + 1}`], cwd);
    if (!c.ok) return { ok: false, reason: c.err || 'commit-failed' };
    return { ok: true, committed: true, n: base + 1, ...(excludedSecrets ? { excludedSecrets } : {}) };
  } catch (e) {
    return { ok: false, reason: String(e) };
  }
}

/** The leftover detector: reflects any zz/session-* branch, checked out or not. */
export function sessionStatus(cwd) {
  try {
    const enabled = sessionGitEnabled(cwd);
    const main = mainBranch(cwd);
    const cur = currentBranch(cwd);
    const onSessionBranch = !!cur && cur.startsWith(PREFIX);
    const branches = listSessionBranches(cwd);
    let active = null;
    if (branches.length) {
      const branch = branches[0];
      const checkpoints = countCheckpoints(cwd, branch);
      active = {
        branch,
        checkpoints,
        dirty: cur === branch && isDirty(cwd),
        // exploration-only session: checkpoints exist but the tree equals main
        // (the empty-squash-with-checkpoints case doctor/status render specially)
        noNetChanges: checkpoints > 0 && !!main && main !== branch && git(['diff', '--quiet', main, branch], cwd).ok,
      };
    }
    return { enabled, mainBranch: main, active, onSessionBranch };
  } catch {
    return { enabled: false, mainBranch: null, active: null, onSessionBranch: false };
  }
}

const defaultTitle = (branch) => `${branch} · ${new Date().toISOString().slice(0, 10)}`;

/**
 * END: squash-merge the session branch into main as ONE commit
 * `session: <title>`, then delete the branch. Every ok:true return carries
 * `mergedTo` (the branch actually merged into); when the recorded zz-base
 * branch no longer exists, `warning:'base-branch-missing'` flags the fallback.
 *   conflict        → abort (reset --merge), restore the prior checkout,
 *                     { ok:false, conflict:true, branch, restoredTo } —
 *                     restoredTo:null means the checkout back failed (stranded on main)
 *   empty squash    → 0 checkpoints: no commit, still cleans up ({ mergedAs:null });
 *                     WITH checkpoints: the branch is KEPT (history is never
 *                     destroyed silently) → { ok:false,
 *                     reason:'empty-squash-with-checkpoints', commits, branch }
 */
export function closeSession(cwd, { title } = {}) {
  try {
    const blocked = unsafeReason(cwd);
    if (blocked) return { ok: false, reason: blocked };
    const branches = listSessionBranches(cwd);
    if (!branches.length) return { ok: false, reason: 'no-session-branch' };
    const branch = branches[0];
    const cur = currentBranch(cwd);
    const baseCfg = git(['config', `branch.${branch}.zz-base`], cwd).out;
    const main = mainBranch(cwd);
    if (!main || main === branch) return { ok: false, reason: 'no-main-branch' };
    // honesty: the branch we recorded at open is gone → we merge to a fallback
    const baseMissing = !!baseCfg && !branchExists(cwd, baseCfg);

    let excludedSecrets = 0;
    if (cur === branch) {
      const cp = checkpoint(cwd); // fold any uncommitted work into the squash
      if (!cp.ok) return { ok: false, reason: cp.reason };
      excludedSecrets = cp.excludedSecrets ?? 0;
    } else if (userDirty(cwd)) {
      // Loose changes on another branch are the USER's — never mix them into the
      // squash. zuzuu's OWN index churn (.zuzuu/sessions.json) is excused below.
      return { ok: false, reason: 'dirty-worktree' };
    }

    const commits = countCheckpoints(cwd, branch);
    /** Undo a failed merge and put the user back where they were. Returns the
     *  branch we actually landed on — null = the checkout back failed and the
     *  user is STRANDED ON MAIN (report it, never pretend otherwise). */
    const restore = () => {
      git(['reset', '--merge'], cwd);
      cleanupSquashState(cwd);
      if (!cur || cur === main) return cur ?? null;
      return git(['checkout', '-q', cur], cwd).ok ? cur : null;
    };

    // zuzuu's own index churn (excused by userDirty above) would still block the
    // checkout to main — reset it first; capture/doctor regenerate it.
    resetZuzuuOwn(cwd);
    const co = git(['checkout', '-q', main], cwd);
    if (!co.ok) return { ok: false, reason: co.err || 'checkout-main-failed' };
    const merge = git(['merge', '--squash', branch], cwd);
    if (!merge.ok) {
      // conflict (or any squash failure): leave the repo exactly as before
      return { ok: false, conflict: true, branch, restoredTo: restore() };
    }

    const extras = {
      ...(excludedSecrets ? { excludedSecrets } : {}),
      ...(baseMissing ? { warning: 'base-branch-missing' } : {}),
    };

    let mergedAs = null;
    const nothingStaged = git(['diff', '--cached', '--quiet'], cwd).ok; // exit 1 = staged changes
    if (nothingStaged) {
      cleanupSquashState(cwd); // a stale SQUASH_MSG would hijack the user's next commit
      if (commits > 0) {
        // Exploration-only session: the squash is empty but real checkpoints
        // exist. NEVER delete that history silently — keep the branch, put the
        // user back, and report; `zuzuu session discard --yes` is the drop path.
        if (cur && cur !== main) git(['checkout', '-q', cur], cwd);
        return { ok: false, reason: 'empty-squash-with-checkpoints', commits, branch, ...extras };
      }
    } else {
      const c = git(['commit', '-q', '-m', `session: ${title || defaultTitle(branch)}`], cwd);
      if (!c.ok) {
        return { ok: false, reason: c.err || 'commit-failed', restoredTo: restore() };
      }
      mergedAs = git(['rev-parse', 'HEAD'], cwd).out || null;
    }

    git(['config', '--unset', `branch.${branch}.zz-base`], cwd); // best-effort
    const del = git(['branch', '-D', branch], cwd);
    if (!del.ok) {
      const warning = extras.warning ? `${extras.warning},branch-delete-failed` : 'branch-delete-failed';
      return { ok: true, mergedAs, mergedTo: main, commits, ...extras, warning };
    }
    return { ok: true, mergedAs, mergedTo: main, commits, ...extras };
  } catch (e) {
    return { ok: false, reason: String(e) };
  }
}

/** Recovery: check the leftover session branch back out and keep working. */
export function continueSession(cwd) {
  try {
    const blocked = unsafeReason(cwd);
    if (blocked) return { ok: false, reason: blocked };
    const branches = listSessionBranches(cwd);
    if (!branches.length) return { ok: false, reason: 'no-session-branch' };
    const branch = branches[0];
    if (currentBranch(cwd) === branch) return { ok: true, branch };
    resetZuzuuOwn(cwd); // zuzuu's own index churn must not block the checkout
    const r = git(['checkout', '-q', branch], cwd);
    return r.ok ? { ok: true, branch } : { ok: false, reason: r.err || 'checkout-failed' };
  } catch (e) {
    return { ok: false, reason: String(e) };
  }
}

/** Recovery: drop the session branch and its checkpoints. The CALLER gates confirmation. */
export function discardSession(cwd) {
  try {
    const blocked = unsafeReason(cwd);
    if (blocked) return { ok: false, reason: blocked };
    const branches = listSessionBranches(cwd);
    if (!branches.length) return { ok: false, reason: 'no-session-branch' };
    const branch = branches[0];
    const main = mainBranch(cwd);
    if (!main || main === branch) return { ok: false, reason: 'no-main-branch' };
    if (currentBranch(cwd) === branch) {
      resetZuzuuOwn(cwd); // zuzuu's own index churn must not block the checkout
      const co = git(['checkout', '-q', main], cwd);
      if (!co.ok) return { ok: false, reason: co.err || 'checkout-main-failed' };
    }
    git(['config', '--unset', `branch.${branch}.zz-base`], cwd); // best-effort
    const del = git(['branch', '-D', branch], cwd);
    return del.ok ? { ok: true, branch } : { ok: false, reason: del.err || 'branch-delete-failed' };
  } catch (e) {
    return { ok: false, reason: String(e) };
  }
}
