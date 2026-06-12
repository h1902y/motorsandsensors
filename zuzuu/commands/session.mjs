// zuzuu/commands/session.mjs — `zuzuu session`: the invisible session branch.
//
//   zuzuu session status            the session branch + leftover detector
//   zuzuu session merge [--title t] squash-merge the session branch to main (one commit)
//   zuzuu session continue          check the leftover branch back out
//   zuzuu session discard --yes     delete the branch + its checkpoints (refuses without --yes)
//
// All git mutation lives in session-git.mjs (fail-soft, never throws); this is
// the thin print layer (xxxData pattern — pure data fns + --json everywhere).

import { sessionStatus, closeSession, continueSession, discardSession } from '../sessions/session-git.mjs';
import { sessionInspect } from './sessions.mjs';

/** Pure: structured session-git state (the leftover detector included). */
export function sessionStatusData(cwd = process.cwd()) {
  return sessionStatus(cwd);
}

/** Pure: the leftover-branch warning (shared by session/status/doctor), or null.
 *  A checked-out session branch is presumed in use — never warned on (an agent
 *  running doctor mid-session must not be nudged into "fixing" its own branch). */
export function leftoverLine(ss) {
  if (!ss?.active || ss.onSessionBranch) return null;
  if (ss.active.noNetChanges) {
    // the empty-squash-with-checkpoints case: close KEPT the branch (history is
    // never destroyed silently) — explicit discard is the drop path
    return `session had no net changes — ${ss.active.checkpoints} exploration checkpoint(s) retained; \`zuzuu session discard --yes\` to drop`;
  }
  return `leftover session branch ${ss.active.branch} (${ss.active.checkpoints} checkpoint(s)) — zuzuu session continue | merge | discard`;
}

/** Pure: squash-merge the session branch as ONE `session: <title>` commit. */
export function sessionMergeData(cwd = process.cwd(), { title } = {}) {
  return closeSession(cwd, { title });
}

/** Pure: check the leftover session branch back out. */
export function sessionContinueData(cwd = process.cwd()) {
  return continueSession(cwd);
}

/** Pure: drop the session branch (confirmation is gated by the CLI layer). */
export function sessionDiscardData(cwd = process.cwd()) {
  return discardSession(cwd);
}

export function session(args = {}) {
  const cwd = process.cwd();
  const sub = args._?.[0] ?? 'status';

  if (sub === 'status') {
    const d = sessionStatusData(cwd);
    if (args.json) { console.log(JSON.stringify(d)); return; }
    console.log(`session-git: ${d.enabled ? 'enabled' : 'disabled'} · merges to: ${d.mainBranch ?? '(unknown)'}`);
    if (!d.active) {
      console.log('no session branch — your agent session opens one invisibly');
    } else if (d.onSessionBranch) {
      console.log(`● ${d.active.branch} (checked out) — ${d.active.checkpoints} checkpoint(s)${d.active.dirty ? ' + uncommitted changes' : ''}`);
    } else {
      console.log(`⚠ ${leftoverLine(d)}`);
    }
    return;
  }

  if (sub === 'merge') {
    const d = sessionMergeData(cwd, { title: typeof args.title === 'string' ? args.title : undefined });
    if (args.json) { console.log(JSON.stringify(d)); if (!d.ok) process.exit(1); return; }
    if (d.ok) {
      console.log(d.mergedAs
        ? `✓ squashed ${d.commits} checkpoint(s) into ${d.mergedAs.slice(0, 8)} — session branch removed`
        : '✓ session had no changes — branch removed, main untouched');
      return;
    }
    console.error(d.conflict
      ? `✗ conflict squashing ${d.branch} — aborted, branch left intact (merge it manually, or \`zuzuu session continue\`)`
      : d.reason === 'empty-squash-with-checkpoints'
        ? `✗ session had no net changes — ${d.commits} exploration checkpoint(s) retained; \`zuzuu session discard --yes\` to drop`
        : `✗ cannot merge: ${d.reason}`);
    process.exit(1);
  }

  if (sub === 'continue') {
    const d = sessionContinueData(cwd);
    if (args.json) { console.log(JSON.stringify(d)); if (!d.ok) process.exit(1); return; }
    if (d.ok) { console.log(`✓ back on ${d.branch} — finish up, then \`zuzuu session merge\``); return; }
    console.error(`✗ cannot continue: ${d.reason}`);
    process.exit(1);
  }

  if (sub === 'discard') {
    if (!args.yes) {
      console.error('refusing without --yes — `zuzuu session discard --yes` DELETES the session branch and all its checkpoints');
      process.exit(1);
    }
    const d = sessionDiscardData(cwd);
    if (args.json) { console.log(JSON.stringify(d)); if (!d.ok) process.exit(1); return; }
    if (d.ok) { console.log(`✓ discarded ${d.branch} (checkpoints dropped)`); return; }
    console.error(`✗ cannot discard: ${d.reason}`);
    process.exit(1);
  }

  if (sub === 'inspect') {
    sessionInspect(args);
    return;
  }

  console.error(`unknown: zuzuu session ${sub}\nusage: zuzuu session [status|merge [--title t]|continue|discard --yes|inspect <id>]`);
  process.exit(1);
}
