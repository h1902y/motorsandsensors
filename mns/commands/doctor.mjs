// `mns doctor` — environment health + session sanity. Exits non-zero only on
// real problems (warnings don't fail). Phase 2 will also reconcile lost sessions.

import { mkdirSync, accessSync, constants } from 'node:fs';
import { detected } from '../../experiments/experiment-1-trace-capture/adapters/registry.mjs';
import { paths, gitInfo } from '../store.mjs';
import { listLive } from '../live/live-store.mjs';
import { reconcile } from '../live/reconcile.mjs';
import { planScaffold, homeExists } from '../scaffold.mjs';

export function doctor() {
  let problems = 0;
  const ok = (m) => console.log(`  ✓ ${m}`);
  const warn = (m) => console.log(`  ⚠ ${m}`);
  const bad = (m) => {
    console.log(`  ✗ ${m}`);
    problems++;
  };

  console.log('mns doctor\n');

  // Node
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 21) ok(`Node ${process.versions.node}`);
  else if (major >= 20) warn(`Node ${process.versions.node} — capture works; \`npm test\` glob needs ≥21`);
  else bad(`Node ${process.versions.node} — too old, please use ≥20 (22 LTS recommended)`);

  // git
  const { commit, branch } = gitInfo();
  if (commit) ok(`git repo on ${branch} @ ${commit.slice(0, 8)}`);
  else warn('not a git repo — capture works but sessions won’t be linked to a commit');

  // .mns writable
  const { dir } = paths();
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
    ok(`.mns/ writable (${dir})`);
  } catch {
    bad(`.mns/ not writable (${dir})`);
  }

  // faculty home (served by `mns init`)
  const root = paths().root;
  if (!homeExists(root)) {
    warn('no faculty home — run `mns init` to scaffold knowledge/memory/actions/instructions');
  } else {
    const missing = planScaffold(root);
    const gaps = missing.dirs.length + missing.files.length + (missing.manifestMissing ? 1 : 0);
    if (gaps) warn(`faculty home incomplete (${gaps} piece(s) missing) — rerun \`mns init\``);
    else ok('faculty home complete (knowledge/ memory/ actions/ instructions/)');
  }

  // hosts
  const hosts = detected();
  if (hosts.length) ok(`hosts detected: ${hosts.map((h) => h.name).join(', ')}`);
  else warn('no supported agent data found — use Claude Code or Gemini CLI, then `mns capture`');

  // live-session reconciliation: close out lost/killed sessions (no SessionEnd).
  const before = listLive().length;
  const reconciled = reconcile();
  if (reconciled.length) warn(`reconciled ${reconciled.length} lost session(s) → abandoned`);
  const live = listLive().length;
  if (live) ok(`${live} live session(s) active`);
  else if (!before) ok('no live sessions');

  console.log(problems ? `\n${problems} problem(s) found` : '\nall good');
  process.exit(problems ? 1 : 0);
}
