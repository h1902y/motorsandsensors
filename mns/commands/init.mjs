// `mns init` — git-style, context-aware, idempotent scaffold of the faculty home.
//
//   empty dir            → greenfield: full scaffold + create AGENTS.md/CLAUDE.md
//   non-empty, no .mns/  → brownfield: scaffold + inject block into existing
//                          instruction files (user content untouched)
//   .mns/ exists         → "Reinitialized": create missing pieces only (no-op
//                          on a complete home; never overwrites anything)

import { join, basename } from 'node:path';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { applyScaffold, ensureGitignore, homeExists } from '../scaffold.mjs';
import { injectBlock, facultiesBlock, hasBlock } from '../inject.mjs';
import { detected } from '../../experiments/experiment-1-trace-capture/adapters/registry.mjs';
import { repoRoot } from '../store.mjs';

const HOST_FILES = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md'];
// dotfiles/dirs that don't make a directory "a project" for emptiness purposes
const IGNORABLE = new Set(['.git', '.DS_Store']);

function isEmptyDir(cwd) {
  return readdirSync(cwd).filter((e) => !IGNORABLE.has(e)).length === 0;
}

/** Inject (or create) instruction files. Returns {injected:[], created:[]} */
function serveInstructions(cwd, { greenfield }) {
  const existing = HOST_FILES.filter((f) => existsSync(join(cwd, f)));
  const injected = [];
  const created = [];
  for (const f of existing) {
    const path = join(cwd, f);
    const text = readFileSync(path, 'utf8');
    if (hasBlock(text)) continue; // already served (re-inject only on version bump)
    writeFileSync(path, injectBlock(text));
    injected.push(f);
  }
  if (greenfield && existing.length === 0) {
    for (const f of ['AGENTS.md', 'CLAUDE.md']) {
      writeFileSync(join(cwd, f), facultiesBlock() + '\n');
      created.push(f);
    }
  }
  return { injected, created };
}

export function init(args = {}) {
  // Root at the git toplevel when inside a repo (same base the store uses for
  // .mns), falling back to cwd — one project, one home, like .git/.
  const cwd = repoRoot(process.cwd());
  if (cwd !== process.cwd()) console.log(`(project root: ${cwd})`);
  const reinit = homeExists(cwd);
  const greenfield = !reinit && isEmptyDir(cwd);

  const plan = applyScaffold(cwd);
  const ignoreAdded = ensureGitignore(cwd);
  const { injected, created } = serveInstructions(cwd, { greenfield });

  const createdCount = plan.dirs.length + plan.files.length + (plan.manifestMissing ? 1 : 0);

  if (reinit) {
    console.log(`Reinitialized existing mns home in ${join(cwd, '.mns')}/`);
    if (createdCount) console.log(`  restored : ${createdCount} missing piece(s)`);
    if (injected.length) console.log(`  injected : faculty block → ${injected.join(', ')}`);
    if (!createdCount && !injected.length && !ignoreAdded.length) console.log('  (complete — nothing to do)');
  } else if (greenfield) {
    console.log(`Initialized empty mns home in ${join(cwd, '.mns')}/`);
    console.log(`  faculties : knowledge/ memory/ actions/ instructions/  (+ mns.json manifest)`);
    console.log(`  steering  : created ${created.join(' + ')} pointing your agent at its faculties`);
    console.log(`  next      : \`mns enable\` for live capture · \`mns status\` · start your agent in ${basename(cwd)}/`);
  } else {
    console.log(`Initialized mns home in existing project ${join(cwd, '.mns')}/`);
    console.log(`  faculties : knowledge/ memory/ actions/ instructions/  (+ mns.json manifest)`);
    if (injected.length) console.log(`  steering  : injected faculty block → ${injected.join(', ')}`);
    else console.log(`  steering  : no CLAUDE.md/AGENTS.md/GEMINI.md found — create one and rerun, or add the block manually`);
    const hosts = detected().map((a) => a.name).join(', ');
    if (hosts) console.log(`  hosts     : detected ${hosts} — \`mns capture\` works now; \`mns enable\` for live`);
  }
  if (ignoreAdded.length) console.log(`  gitignore : +${ignoreAdded.join(' ')}`);
}
