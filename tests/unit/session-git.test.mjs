// tests/unit/session-git.test.mjs (W2.2 ①)
// Invisible session-git — the most safety-critical module: git mutations in
// USERS' repos from fail-open hooks. Every test runs in a hermetic tmp repo;
// nothing here may ever touch the zuzuu repo itself.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  sessionGitEnabled, sessionBranchName, mainBranch, listSessionBranches,
  openSession, checkpoint, sessionStatus, closeSession, continueSession, discardSession,
} from '../../zuzuu/sessions/session-git.mjs';
import { handleHook } from '../../zuzuu/commands/hook.mjs';
import { listLive } from '../../zuzuu/live/live-store.mjs';
import { statusData } from '../../zuzuu/commands/status.mjs';
import { leftoverLine } from '../../zuzuu/commands/session.mjs';

function git(args, cwd, input) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', input });
  assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

/** Hermetic repo: main branch, local identity, one initial commit. */
function tmpRepo(fn, { branch = 'main' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'zz-sgit-'));
  git(['init', '-q', '-b', branch], root);
  git(['config', 'user.email', 'test@zuzuu.dev'], root);
  git(['config', 'user.name', 'zuzuu test'], root);
  git(['config', 'commit.gpgsign', 'false'], root);
  writeFileSync(join(root, 'a.txt'), 'one\n');
  git(['add', '-A'], root);
  git(['commit', '-q', '-m', 'init'], root);
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const head = (cwd) => git(['rev-parse', 'HEAD'], cwd);
const curBranch = (cwd) => git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
const logCount = (cwd, ref = 'HEAD') => Number(git(['rev-list', '--count', ref], cwd));
const lastMsg = (cwd) => git(['log', '-1', '--format=%s'], cwd);
const porcelain = (cwd) => spawnSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' }).stdout.trim();

// ---------------------------------------------------------------- round-trip

test('full round-trip: open → 2 checkpoints → close = ONE new commit on main, branch gone', () => {
  tmpRepo((cwd) => {
    const before = logCount(cwd);
    const o = openSession(cwd, 'Abc-12345-rest-of-uuid');
    assert.deepEqual(o, { ok: true, branch: 'zz/session-abc12345' });
    assert.equal(curBranch(cwd), 'zz/session-abc12345');

    writeFileSync(join(cwd, 'b.txt'), 'two\n');
    const c1 = checkpoint(cwd);
    assert.deepEqual(c1, { ok: true, committed: true, n: 1 });
    assert.equal(lastMsg(cwd), 'zz: checkpoint 1');

    writeFileSync(join(cwd, 'b.txt'), 'two more\n');
    const c2 = checkpoint(cwd);
    assert.deepEqual(c2, { ok: true, committed: true, n: 2 });

    const done = closeSession(cwd, { title: 'built the thing' });
    assert.equal(done.ok, true);
    assert.equal(done.commits, 2);
    assert.equal(done.mergedAs, head(cwd));
    assert.equal(done.mergedTo, 'main', 'always says where it merged');
    assert.equal(done.warning, undefined, 'no warning on the happy path');
    assert.equal(curBranch(cwd), 'main');
    assert.equal(logCount(cwd), before + 1, 'exactly ONE new commit on main');
    assert.equal(lastMsg(cwd), 'session: built the thing');
    assert.deepEqual(listSessionBranches(cwd), [], 'session branch deleted');
    assert.equal(porcelain(cwd), '', 'clean tree after close');
  });
});

test('checkpoint with a clean tree commits nothing (committed:false)', () => {
  tmpRepo((cwd) => {
    openSession(cwd, 'cleanid01');
    const before = logCount(cwd);
    const c = checkpoint(cwd);
    assert.equal(c.ok, true);
    assert.equal(c.committed, false);
    assert.equal(logCount(cwd), before, 'no commit created');
  });
});

test('closeSession with zero changes (empty squash) still cleans up the branch', () => {
  tmpRepo((cwd) => {
    openSession(cwd, 'emptyses1');
    const before = logCount(cwd, 'main');
    const done = closeSession(cwd, {});
    assert.equal(done.ok, true);
    assert.equal(done.mergedAs, null, 'no merge commit for an empty session');
    assert.equal(done.mergedTo, 'main');
    assert.equal(done.commits, 0);
    assert.equal(curBranch(cwd), 'main');
    assert.equal(logCount(cwd, 'main'), before, 'main unchanged');
    assert.deepEqual(listSessionBranches(cwd), []);
    assert.ok(!existsSync(join(cwd, '.git', 'SQUASH_MSG')), 'no stale SQUASH_MSG left behind');
  });
});

test('default title: close without a title → "session: zz/session-x · <ISO date>"', () => {
  tmpRepo((cwd) => {
    openSession(cwd, 'titled001');
    writeFileSync(join(cwd, 'b.txt'), 'x\n');
    checkpoint(cwd);
    const done = closeSession(cwd, {});
    assert.equal(done.ok, true);
    const date = new Date().toISOString().slice(0, 10);
    assert.equal(lastMsg(cwd), `session: zz/session-titled00 · ${date}`);
  });
});

// ------------------------------------------------- single-branch invariant

test('single-branch invariant: a second open is blocked, never a second branch', () => {
  tmpRepo((cwd) => {
    assert.equal(openSession(cwd, 'first0001').ok, true);
    const second = openSession(cwd, 'second002');
    assert.equal(second.ok, false);
    assert.equal(second.blocked, true);
    assert.equal(second.existing, 'zz/session-first000');
    assert.deepEqual(listSessionBranches(cwd), ['zz/session-first000'], 'still exactly one branch');
  });
});

test('resume: re-open with the same id while on its branch → resumed, no-op', () => {
  tmpRepo((cwd) => {
    openSession(cwd, 'sameid001');
    const again = openSession(cwd, 'sameid001');
    assert.equal(again.ok, true);
    assert.equal(again.resumed, true);
    assert.equal(curBranch(cwd), 'zz/session-sameid00');
    assert.deepEqual(listSessionBranches(cwd), ['zz/session-sameid00']);
  });
});

test('a leftover blocks even the SAME id when not checked out (recovery is explicit)', () => {
  tmpRepo((cwd) => {
    openSession(cwd, 'crashed01');
    git(['checkout', '-q', 'main'], cwd); // crash recovery state: leftover branch, back on main
    const again = openSession(cwd, 'crashed01');
    assert.equal(again.blocked, true);
    assert.equal(again.existing, 'zz/session-crashed0');
  });
});

// --------------------------------------------------------------- dirty trees

test('dirty tree at open rides into the session branch', () => {
  tmpRepo((cwd) => {
    writeFileSync(join(cwd, 'wip.txt'), 'uncommitted\n');
    const o = openSession(cwd, 'dirty0001');
    assert.equal(o.ok, true);
    assert.equal(curBranch(cwd), 'zz/session-dirty000');
    assert.ok(porcelain(cwd).includes('wip.txt'), 'changes rode along');
    const c = checkpoint(cwd);
    assert.equal(c.committed, true);
    assert.equal(porcelain(cwd), '', 'checkpoint captured the ride-along changes');
  });
});

test('checkpoint REFUSES on main (and on any non-session branch) — never commits there', () => {
  tmpRepo((cwd) => {
    writeFileSync(join(cwd, 'b.txt'), 'loose\n');
    const before = logCount(cwd);
    const c = checkpoint(cwd);
    assert.deepEqual(c, { ok: false, reason: 'not-on-session-branch' });
    assert.equal(logCount(cwd), before, 'no commit on main');
    assert.ok(porcelain(cwd).includes('b.txt'), 'loose change untouched');

    git(['checkout', '-q', '-b', 'feature/x'], cwd);
    assert.equal(checkpoint(cwd).reason, 'not-on-session-branch');
  });
});

test('close while dirty ON the session branch folds the last changes in first', () => {
  tmpRepo((cwd) => {
    openSession(cwd, 'lastdirty');
    writeFileSync(join(cwd, 'b.txt'), 'final words\n');
    const done = closeSession(cwd, { title: 't' });
    assert.equal(done.ok, true);
    assert.equal(done.commits, 1, 'the final checkpoint was folded in');
    assert.equal(porcelain(cwd), '');
  });
});

test('close from main with a dirty tree refuses (never mixes user changes into the squash)', () => {
  tmpRepo((cwd) => {
    openSession(cwd, 'mixguard1');
    writeFileSync(join(cwd, 'b.txt'), 'session work\n');
    checkpoint(cwd);
    git(['checkout', '-q', 'main'], cwd);
    writeFileSync(join(cwd, 'loose.txt'), 'user wip on main\n');
    const done = closeSession(cwd, {});
    assert.equal(done.ok, false);
    assert.equal(done.reason, 'dirty-worktree');
    assert.deepEqual(listSessionBranches(cwd), ['zz/session-mixguard'], 'branch intact');
  });
});

test('close from main merges despite zuzuu\'s OWN tracked index churn (.zuzuu/sessions.json)', () => {
  tmpRepo((cwd) => {
    // The tracked session index, committed on main, then churned at runtime.
    mkdirSync(join(cwd, '.zuzuu'), { recursive: true });
    writeFileSync(join(cwd, '.zuzuu', 'sessions.json'), '{"v":1}\n');
    git(['add', '-A'], cwd);
    git(['commit', '-q', '-m', 'add session index'], cwd);

    openSession(cwd, 'idxguard1');
    writeFileSync(join(cwd, 'b.txt'), 'session work\n');
    checkpoint(cwd);
    git(['checkout', '-q', 'main'], cwd);
    // zuzuu rewrites its own index (dirty AND differs from the branch) — must NOT block.
    writeFileSync(join(cwd, '.zuzuu', 'sessions.json'), '{"v":2,"churn":true}\n');

    const done = closeSession(cwd, { title: 't' });
    assert.equal(done.ok, true, 'merge succeeds despite zuzuu index churn');
    assert.equal(done.commits, 1);
    assert.equal(curBranch(cwd), 'main');
    assert.deepEqual(listSessionBranches(cwd), [], 'session branch merged away');
  });
});

test('close still refuses on REAL user dirt even when zuzuu\'s index is also dirty', () => {
  tmpRepo((cwd) => {
    mkdirSync(join(cwd, '.zuzuu'), { recursive: true });
    writeFileSync(join(cwd, '.zuzuu', 'sessions.json'), '{"v":1}\n');
    git(['add', '-A'], cwd);
    git(['commit', '-q', '-m', 'idx'], cwd);

    openSession(cwd, 'idxguard2');
    writeFileSync(join(cwd, 'b.txt'), 'session work\n');
    checkpoint(cwd);
    git(['checkout', '-q', 'main'], cwd);
    writeFileSync(join(cwd, '.zuzuu', 'sessions.json'), '{"v":2}\n'); // zuzuu churn (excused)
    writeFileSync(join(cwd, 'loose.txt'), 'user wip\n');              // real user dirt (refuses)

    const done = closeSession(cwd, {});
    assert.equal(done.ok, false);
    assert.equal(done.reason, 'dirty-worktree');
    assert.deepEqual(listSessionBranches(cwd), ['zz/session-idxguard'], 'branch intact');
  });
});

test('continueSession checks out the leftover branch despite zuzuu index churn', () => {
  tmpRepo((cwd) => {
    mkdirSync(join(cwd, '.zuzuu'), { recursive: true });
    writeFileSync(join(cwd, '.zuzuu', 'sessions.json'), '{"v":1}\n');
    git(['add', '-A'], cwd);
    git(['commit', '-q', '-m', 'idx'], cwd);

    const o = openSession(cwd, 'contguard1');
    // the index differs ON the session branch (committed), so a plain checkout
    // from a churned main would otherwise be refused ("would be overwritten").
    writeFileSync(join(cwd, '.zuzuu', 'sessions.json'), '{"v":2,"branch":true}\n');
    checkpoint(cwd);
    git(['checkout', '-q', 'main'], cwd);
    writeFileSync(join(cwd, '.zuzuu', 'sessions.json'), '{"v":3,"churn":true}\n'); // dirty + differs

    const r = continueSession(cwd);
    assert.equal(r.ok, true, 'continue succeeds despite index churn');
    assert.equal(curBranch(cwd), o.branch);
  });
});

// ------------------------------------------------------------------ conflict

test('conflict on close: abort cleanly — branch intact, main untouched, no merge state', () => {
  tmpRepo((cwd) => {
    openSession(cwd, 'conflict1');
    writeFileSync(join(cwd, 'a.txt'), 'session side\n');
    checkpoint(cwd);

    // Simulate external main movement via plumbing (while still on the branch):
    // commit a conflicting a.txt directly onto main without touching the worktree.
    const blob = git(['hash-object', '-w', '--stdin'], cwd, 'main side\n');
    const tree = git(['mktree'], cwd, `100644 blob ${blob}\ta.txt\n`);
    const mainTipBefore = git(['rev-parse', 'main'], cwd);
    const ext = git(['commit-tree', tree, '-p', mainTipBefore, '-m', 'external change'], cwd);
    git(['update-ref', 'refs/heads/main', ext], cwd);

    const branchTip = head(cwd);
    const done = closeSession(cwd, {});
    assert.equal(done.ok, false);
    assert.equal(done.conflict, true);
    assert.equal(done.branch, 'zz/session-conflict');
    assert.equal(done.restoredTo, 'zz/session-conflict', 'honest report: back where we were');
    assert.equal(curBranch(cwd), 'zz/session-conflict', 'checked back out where we were');
    assert.equal(head(cwd), branchTip, 'branch tip untouched');
    assert.equal(git(['rev-parse', 'main'], cwd), ext, 'main tip untouched');
    assert.equal(porcelain(cwd), '', 'worktree clean — repo exactly as before');
    assert.ok(!existsSync(join(cwd, '.git', 'MERGE_HEAD')), 'no MERGE state');
    assert.ok(!existsSync(join(cwd, '.git', 'SQUASH_MSG')), 'no SQUASH_MSG left');
    assert.ok(!existsSync(join(cwd, '.git', 'MERGE_MSG')), 'no MERGE_MSG left');
  });
});

test('restore stranding: checkout back fails (untracked collision) → restoredTo:null', () => {
  tmpRepo((cwd) => {
    openSession(cwd, 'strand001');
    writeFileSync(join(cwd, 'c.txt'), 'session data\n');
    checkpoint(cwd);
    // A hostile post-checkout hook recreates c.txt UNTRACKED the moment we land
    // on main (the untracked-collision case): the squash-merge refuses, and the
    // restore checkout back to the session branch refuses too → stranded on main.
    mkdirSync(join(cwd, '.git', 'hooks'), { recursive: true });
    writeFileSync(join(cwd, '.git', 'hooks', 'post-checkout'),
      '#!/bin/sh\n[ -f c.txt ] || echo junk > c.txt\nexit 0\n', { mode: 0o755 });
    const done = closeSession(cwd, {});
    assert.equal(done.ok, false);
    assert.equal(done.conflict, true);
    assert.equal(done.branch, 'zz/session-strand00');
    assert.equal(done.restoredTo, null, 'honest: stranded on main, not back on the branch');
    assert.equal(curBranch(cwd), 'main', 'really is on main');
    assert.deepEqual(listSessionBranches(cwd), ['zz/session-strand00'], 'branch intact');
  });
});

// -------------------------------------------- empty squash WITH checkpoints

test('empty squash WITH checkpoints keeps the branch — history is never destroyed', () => {
  tmpRepo((cwd) => {
    openSession(cwd, 'explore01');
    writeFileSync(join(cwd, 'a.txt'), 'edited\n');
    assert.equal(checkpoint(cwd).committed, true);
    writeFileSync(join(cwd, 'a.txt'), 'one\n'); // revert → net diff vs main = zero
    assert.equal(checkpoint(cwd).committed, true);

    const mainBefore = git(['rev-parse', 'main'], cwd);
    const done = closeSession(cwd, {});
    assert.equal(done.ok, false);
    assert.equal(done.reason, 'empty-squash-with-checkpoints');
    assert.equal(done.commits, 2);
    assert.equal(done.branch, 'zz/session-explore0');
    assert.equal(curBranch(cwd), 'zz/session-explore0', 'put back where the user was');
    assert.deepEqual(listSessionBranches(cwd), ['zz/session-explore0'], 'branch KEPT');
    assert.equal(Number(git(['rev-list', '--count', 'main..zz/session-explore0'], cwd)), 2,
      'both exploration checkpoints still reachable');
    assert.equal(git(['rev-parse', 'main'], cwd), mainBefore, 'main untouched');
    assert.ok(!existsSync(join(cwd, '.git', 'SQUASH_MSG')), 'no stale SQUASH_MSG');

    // doctor/status render the retained-exploration case, not the generic leftover
    git(['checkout', '-q', 'main'], cwd);
    const s = sessionStatus(cwd);
    assert.equal(s.active.noNetChanges, true);
    assert.equal(
      leftoverLine(s),
      'session had no net changes — 2 exploration checkpoint(s) retained; `zuzuu session discard --yes` to drop',
    );

    // explicit discard is the cleanup path
    assert.equal(discardSession(cwd).ok, true);
    assert.deepEqual(listSessionBranches(cwd), []);
  });
});

// ----------------------------------------------------- secrets exclusion

test('secrets never enter checkpoints: .env stays untracked, excludedSecrets counted', () => {
  tmpRepo((cwd) => {
    openSession(cwd, 'secret001');
    writeFileSync(join(cwd, '.env'), 'TOKEN=hush\n'); // NOT gitignored — worst case
    writeFileSync(join(cwd, 'notes.txt'), 'normal work\n');
    const c = checkpoint(cwd);
    assert.equal(c.ok, true);
    assert.equal(c.committed, true);
    assert.equal(c.excludedSecrets, 1);
    const tracked = git(['ls-files'], cwd).split('\n');
    assert.ok(tracked.includes('notes.txt'), 'normal file committed');
    assert.ok(!tracked.includes('.env'), '.env never committed');
    assert.match(porcelain(cwd), /\?\? \.env/, '.env left untracked in the worktree');

    const done = closeSession(cwd, { title: 'secret-safe' });
    assert.equal(done.ok, true);
    assert.equal(done.excludedSecrets, 1, 'final checkpoint propagates the count');
    const mainTree = git(['ls-tree', '-r', '--name-only', 'main'], cwd).split('\n');
    assert.ok(mainTree.includes('notes.txt'));
    assert.ok(!mainTree.includes('.env'), 'squashed main tree contains no .env');
    assert.match(porcelain(cwd), /\?\? \.env/, '.env survives close, still untracked');
  });
});

test('checkpoint with ONLY secret changes commits nothing (no empty commit, no failure)', () => {
  tmpRepo((cwd) => {
    openSession(cwd, 'onlysec01');
    writeFileSync(join(cwd, '.env.local'), 'X=1\n');
    const before = logCount(cwd);
    const c = checkpoint(cwd);
    assert.equal(c.ok, true);
    assert.equal(c.committed, false);
    assert.equal(c.excludedSecrets, 1);
    assert.equal(logCount(cwd), before, 'no commit created');
  });
});

test('the whole secret family is excluded: .env.*, nested .env, *.pem, *.key, id_rsa*', () => {
  tmpRepo((cwd) => {
    openSession(cwd, 'family001');
    mkdirSync(join(cwd, 'sub'), { recursive: true });
    writeFileSync(join(cwd, '.env.production'), 'a\n');
    writeFileSync(join(cwd, 'sub', '.env'), 'b\n');
    writeFileSync(join(cwd, 'sub', 'cert.pem'), 'c\n');
    writeFileSync(join(cwd, 'server.key'), 'd\n');
    writeFileSync(join(cwd, 'id_rsa'), 'e\n');
    writeFileSync(join(cwd, 'ok.txt'), 'fine\n');
    const c = checkpoint(cwd);
    assert.equal(c.committed, true);
    assert.equal(c.excludedSecrets, 5);
    assert.deepEqual(git(['ls-files'], cwd).split('\n').sort(), ['a.txt', 'ok.txt']);
  });
});

// ------------------------------------------------------ zz-base fallback

test('close after the opening branch vanished: merges to fallback, honest warning + mergedTo', () => {
  tmpRepo((cwd) => {
    git(['checkout', '-q', '-b', 'feature/gone'], cwd);
    openSession(cwd, 'fallback1');
    writeFileSync(join(cwd, 'b.txt'), 'work\n');
    checkpoint(cwd);
    git(['branch', '-D', 'feature/gone'], cwd); // the recorded zz-base no longer exists
    const done = closeSession(cwd, { title: 't' });
    assert.equal(done.ok, true);
    assert.equal(done.mergedTo, 'main', 'fell back to main');
    assert.equal(done.warning, 'base-branch-missing');
    assert.equal(curBranch(cwd), 'main');
  });
});

// ------------------------------------------------------------ safety no-ops

test('non-git dir: every op is a quiet {ok:false} no-op', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zz-nogit-'));
  try {
    assert.equal(sessionGitEnabled(dir), false);
    assert.deepEqual(listSessionBranches(dir), []);
    for (const r of [
      openSession(dir, 'x'), checkpoint(dir), closeSession(dir, {}),
      continueSession(dir), discardSession(dir),
    ]) {
      assert.equal(r.ok, false, JSON.stringify(r));
      assert.ok(r.reason, 'carries a reason');
    }
    const s = sessionStatus(dir);
    assert.equal(s.enabled, false);
    assert.equal(s.active, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('detached HEAD and unborn HEAD disable session-git', () => {
  tmpRepo((cwd) => {
    git(['checkout', '-q', '--detach'], cwd);
    assert.equal(sessionGitEnabled(cwd), false);
    assert.equal(openSession(cwd, 'x').ok, false);
    assert.equal(checkpoint(cwd).ok, false);
  });
  const unborn = mkdtempSync(join(tmpdir(), 'zz-unborn-'));
  try {
    git(['init', '-q'], unborn); // no commits yet
    assert.equal(sessionGitEnabled(unborn), false);
    assert.equal(openSession(unborn, 'x').reason, 'no-commits');
  } finally {
    rmSync(unborn, { recursive: true, force: true });
  }
});

test('an in-progress merge freezes session-git (MERGE_HEAD guard)', () => {
  tmpRepo((cwd) => {
    openSession(cwd, 'frozen001');
    writeFileSync(join(cwd, '.git', 'MERGE_HEAD'), head(cwd) + '\n'); // simulate a user mid-merge
    assert.equal(sessionGitEnabled(cwd), false);
    assert.equal(checkpoint(cwd).reason, 'operation-in-progress');
    assert.equal(closeSession(cwd, {}).reason, 'operation-in-progress');
  });
});

test('opt-out: .zuzuu/agent.json {"sessionGit": false} disables open, but recovery ops still work', () => {
  tmpRepo((cwd) => {
    openSession(cwd, 'optout001'); // opened before the opt-out (leftover to recover)
    writeFileSync(join(cwd, 'b.txt'), 'work\n');
    checkpoint(cwd);
    git(['checkout', '-q', 'main'], cwd);
    mkdirSync(join(cwd, '.zuzuu'), { recursive: true });
    writeFileSync(join(cwd, '.zuzuu', 'agent.json'), JSON.stringify({ version: 3, sessionGit: false }) + '\n');
    git(['add', '-A'], cwd); // the manifest is a tracked file in real homes
    git(['commit', '-q', '-m', 'opt out'], cwd);

    assert.equal(sessionGitEnabled(cwd), false);
    assert.equal(openSession(cwd, 'newone001').reason, 'opted-out', 'no new session branches');
    assert.equal(continueSession(cwd).ok, true, 'recovery still possible');
    git(['checkout', '-q', 'main'], cwd);
    assert.equal(closeSession(cwd, { title: 't' }).ok, true, 'merge-out still possible');
  });
});

// --------------------------------------------------------- continue/discard

test('continueSession checks the leftover branch back out', () => {
  tmpRepo((cwd) => {
    openSession(cwd, 'contin001');
    git(['checkout', '-q', 'main'], cwd);
    const r = continueSession(cwd);
    assert.deepEqual(r, { ok: true, branch: 'zz/session-contin00' });
    assert.equal(curBranch(cwd), 'zz/session-contin00');
    assert.equal(continueSession(cwd).ok, true, 'idempotent when already on it');
  });
});

test('discardSession drops the branch and its checkpoints, lands on main', () => {
  tmpRepo((cwd) => {
    const before = logCount(cwd, 'main');
    openSession(cwd, 'discard01');
    writeFileSync(join(cwd, 'b.txt'), 'doomed\n');
    checkpoint(cwd);
    const r = discardSession(cwd);
    assert.equal(r.ok, true);
    assert.equal(curBranch(cwd), 'main');
    assert.equal(logCount(cwd, 'main'), before, 'main unchanged');
    assert.deepEqual(listSessionBranches(cwd), []);
    assert.ok(!existsSync(join(cwd, 'b.txt')), 'checkpointed work discarded with the branch');
    assert.equal(discardSession(cwd).reason, 'no-session-branch', 'nothing left to discard');
  });
});

// -------------------------------------------------------- mainBranch + status

test('mainBranch: main > master > current non-session branch; zz-base wins when recorded', () => {
  tmpRepo((cwd) => assert.equal(mainBranch(cwd), 'main'));
  tmpRepo((cwd) => assert.equal(mainBranch(cwd), 'master'), { branch: 'master' });
  tmpRepo((cwd) => assert.equal(mainBranch(cwd), 'trunk'), { branch: 'trunk' });
  // a session opened from a feature branch merges back to THAT branch (zz-base)
  tmpRepo((cwd) => {
    git(['checkout', '-q', '-b', 'feature/y'], cwd);
    openSession(cwd, 'based0001');
    assert.equal(mainBranch(cwd), 'feature/y', 'zz-base beats the main heuristic');
    writeFileSync(join(cwd, 'b.txt'), 'x\n');
    checkpoint(cwd);
    const done = closeSession(cwd, { title: 't' });
    assert.equal(done.ok, true);
    assert.equal(curBranch(cwd), 'feature/y', 'merged back to the opening branch');
  });
});

test('sessionStatus reflects a leftover branch whether or not checked out', () => {
  tmpRepo((cwd) => {
    assert.deepEqual(sessionStatus(cwd).active, null);
    openSession(cwd, 'status001');
    writeFileSync(join(cwd, 'b.txt'), 'x\n');
    checkpoint(cwd);
    writeFileSync(join(cwd, 'c.txt'), 'y\n');
    let s = sessionStatus(cwd);
    assert.equal(s.onSessionBranch, true);
    assert.deepEqual(s.active, { branch: 'zz/session-status00', checkpoints: 1, dirty: true, noNetChanges: false });

    git(['add', '-A'], cwd);
    git(['commit', '-q', '-m', 'tidy'], cwd);
    git(['checkout', '-q', 'main'], cwd);
    s = sessionStatus(cwd); // the leftover detector
    assert.equal(s.onSessionBranch, false);
    assert.deepEqual(s.active, { branch: 'zz/session-status00', checkpoints: 2, dirty: false, noNetChanges: false });
    assert.equal(s.mainBranch, 'main');
  });
});

// ------------------------------------------------------------- hook wiring

test('hook lifecycle in a git repo: OPEN branches, TURN checkpoints, END squashes to main', () => {
  tmpRepo((cwd) => {
    writeFileSync(join(cwd, '.gitignore'), '.zuzuu/.live/\n.zuzuu/.traces/\n'); // as `zuzuu init` does
    git(['add', '-A'], cwd);
    git(['commit', '-q', '-m', 'ignore zuzuu internals'], cwd);
    const before = logCount(cwd, 'main');

    handleHook({ event: 'SessionStart', payload: { session_id: 'hook-abc-123' }, cwd, now: 1000 });
    assert.equal(curBranch(cwd), 'zz/session-hookabc1', 'OPEN created the session branch');

    writeFileSync(join(cwd, 'work.txt'), 'turn output\n');
    handleHook({ event: 'Stop', payload: { session_id: 'hook-abc-123' }, cwd, now: 2000 });
    assert.equal(lastMsg(cwd), 'zz: checkpoint 1', 'TURN checkpointed on the branch');

    handleHook({ event: 'SessionEnd', payload: { session_id: 'hook-abc-123' }, cwd, now: 3000 });
    assert.equal(curBranch(cwd), 'main');
    assert.equal(logCount(cwd, 'main'), before + 1, 'ONE squashed commit on main');
    assert.match(lastMsg(cwd), /^session: zz\/session-hookabc1 · \d{4}-\d{2}-\d{2}$/);
    assert.deepEqual(listSessionBranches(cwd), []);
  });
});

test('hook OPEN against a leftover branch: blocked is recorded on the live record, session unharmed', () => {
  tmpRepo((cwd) => {
    openSession(cwd, 'crashed99');
    git(['checkout', '-q', 'main'], cwd); // the crashed leftover
    handleHook({ event: 'SessionStart', payload: { session_id: 'fresh-456' }, cwd, now: 1000 });
    assert.equal(curBranch(cwd), 'main', 'no new branch while blocked');
    assert.deepEqual(listSessionBranches(cwd), ['zz/session-crashed9'], 'invariant held');
    const rec = listLive(cwd).find((r) => r.id === 'fresh-456');
    assert.ok(rec, 'the session itself still opened (never blocked)');
    assert.deepEqual(rec.sessionGit, { blocked: true, existing: 'zz/session-crashed9' });
  });
});

test('hook lifecycle respects the opt-out: no branches, capture untouched', () => {
  tmpRepo((cwd) => {
    mkdirSync(join(cwd, '.zuzuu'), { recursive: true });
    writeFileSync(join(cwd, '.zuzuu', 'agent.json'), JSON.stringify({ version: 3, sessionGit: false }) + '\n');
    handleHook({ event: 'SessionStart', payload: { session_id: 'optout-77' }, cwd, now: 1000 });
    assert.equal(curBranch(cwd), 'main');
    assert.deepEqual(listSessionBranches(cwd), []);
    assert.ok(listLive(cwd).find((r) => r.id === 'optout-77'), 'live capture unaffected');
  });
});

// ---------------------------------------------------------------- surfacing

test('statusData carries the session summary (injectable for hermetic callers)', () => {
  // injected — fully hermetic
  const injected = { enabled: true, mainBranch: 'main', active: null, onSessionBranch: false };
  const home = mkdtempSync(join(tmpdir(), 'zz-statushome-'));
  try {
    assert.deepEqual(statusData(join(home, '.zuzuu'), { hosts: [], session: injected }).session, injected);
    // default in a non-git dir degrades to disabled, never throws
    const d = statusData(join(home, '.zuzuu'), { hosts: [] });
    assert.equal(d.session.enabled, false);
    assert.equal(d.session.active, null);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
  // default in a real repo reflects the leftover branch
  tmpRepo((cwd) => {
    openSession(cwd, 'surface01');
    git(['checkout', '-q', 'main'], cwd);
    const d = statusData(join(cwd, '.zuzuu'), { hosts: [] });
    assert.equal(d.session.active.branch, 'zz/session-surface0');
    assert.equal(d.session.onSessionBranch, false);
  });
});

test('leftoverLine: warns only on a NOT-checked-out session branch (doctor/status line)', () => {
  assert.equal(leftoverLine(null), null);
  assert.equal(leftoverLine({ active: null, onSessionBranch: false }), null);
  assert.equal(
    leftoverLine({ active: { branch: 'zz/session-abc', checkpoints: 3, dirty: false }, onSessionBranch: true }),
    null,
    'a checked-out branch is in use, not a leftover',
  );
  assert.equal(
    leftoverLine({ active: { branch: 'zz/session-abc', checkpoints: 3, dirty: false }, onSessionBranch: false }),
    'leftover session branch zz/session-abc (3 checkpoint(s)) — zuzuu session continue | merge | discard',
  );
});

test('sessionBranchName sanitizes to [a-z0-9], first 8', () => {
  assert.equal(sessionBranchName('Abc-12345-xyz'), 'zz/session-abc12345');
  assert.equal(sessionBranchName('SES_x!Y'), 'zz/session-sesxy');
  assert.equal(sessionBranchName(''), 'zz/session-unknown');
  assert.equal(sessionBranchName(undefined), 'zz/session-unknown');
});
