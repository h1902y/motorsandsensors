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
} from '../../zuzuu/session-git.mjs';
import { handleHook } from '../../zuzuu/commands/hook.mjs';
import { listLive } from '../../zuzuu/live/live-store.mjs';

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
    assert.equal(curBranch(cwd), 'zz/session-conflict', 'checked back out where we were');
    assert.equal(head(cwd), branchTip, 'branch tip untouched');
    assert.equal(git(['rev-parse', 'main'], cwd), ext, 'main tip untouched');
    assert.equal(porcelain(cwd), '', 'worktree clean — repo exactly as before');
    assert.ok(!existsSync(join(cwd, '.git', 'MERGE_HEAD')), 'no MERGE state');
    assert.ok(!existsSync(join(cwd, '.git', 'SQUASH_MSG')), 'no SQUASH_MSG left');
    assert.ok(!existsSync(join(cwd, '.git', 'MERGE_MSG')), 'no MERGE_MSG left');
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
    assert.deepEqual(s.active, { branch: 'zz/session-status00', checkpoints: 1, dirty: true });

    git(['add', '-A'], cwd);
    git(['commit', '-q', '-m', 'tidy'], cwd);
    git(['checkout', '-q', 'main'], cwd);
    s = sessionStatus(cwd); // the leftover detector
    assert.equal(s.onSessionBranch, false);
    assert.deepEqual(s.active, { branch: 'zz/session-status00', checkpoints: 2, dirty: false });
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

test('sessionBranchName sanitizes to [a-z0-9], first 8', () => {
  assert.equal(sessionBranchName('Abc-12345-xyz'), 'zz/session-abc12345');
  assert.equal(sessionBranchName('SES_x!Y'), 'zz/session-sesxy');
  assert.equal(sessionBranchName(''), 'zz/session-unknown');
  assert.equal(sessionBranchName(undefined), 'zz/session-unknown');
});
