// `zuzuu init` — git-style, context-aware, idempotent scaffold of the faculty home.
//
//   empty dir            → greenfield: full scaffold + create AGENTS.md/CLAUDE.md
//   non-empty, no agent/ → brownfield: scaffold + inject block into existing
//                          instruction files (user content untouched)
//   agent/ exists        → "Reinitialized": create missing pieces only (no-op
//                          on a complete home; never overwrites anything)

import { join, basename } from 'node:path';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { applyScaffold, ensureGitignore, homeExists } from '../scaffold.mjs';
import { injectBlock, facultiesBlock, hasBlock, BLOCK_VERSION } from '../inject.mjs';
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
    // current-version block present → nothing to do; older version → replace in
    // place (the markers are versioned for exactly this); absent → append.
    if (text.includes(`zuzuu:faculties:v${BLOCK_VERSION}`)) continue;
    writeFileSync(path, injectBlock(text));
    injected.push(hasBlock(text) ? `${f} (upgraded → v${BLOCK_VERSION})` : f);
  }
  // AGENTS.md is the universal steering file Codex / OpenCode / pi all read
  // (Claude=CLAUDE.md, Gemini=GEMINI.md have their own). Guarantee it carries the
  // block in EVERY mode — including brownfield — so those three hosts are served.
  // No-clobber: only create when absent (existing ones were handled by the loop above).
  if (!existsSync(join(cwd, 'AGENTS.md'))) {
    writeFileSync(join(cwd, 'AGENTS.md'), facultiesBlock() + '\n');
    created.push('AGENTS.md');
  }
  // Greenfield convenience: also give Claude its CLAUDE.md.
  if (greenfield && !existsSync(join(cwd, 'CLAUDE.md'))) {
    writeFileSync(join(cwd, 'CLAUDE.md'), facultiesBlock() + '\n');
    created.push('CLAUDE.md');
  }
  return { injected, created };
}

export function init(args = {}) {
  // Root at the git toplevel when inside a repo (same base the store uses for
  // agent/), falling back to cwd — one project, one home, like .git/.
  const cwd = repoRoot(process.cwd());
  if (cwd !== process.cwd()) console.log(`(project root: ${cwd})`);
  const reinit = homeExists(cwd);
  const greenfield = !reinit && isEmptyDir(cwd);

  const plan = applyScaffold(cwd);
  const ignoreAdded = ensureGitignore(cwd);
  const { injected, created } = serveInstructions(cwd, { greenfield });

  const createdCount = plan.dirs.length + plan.files.length + (plan.manifestMissing ? 1 : 0);

  if (reinit) {
    console.log(`Reinitialized existing zuzuu home in ${join(cwd, 'agent')}/`);
    if (createdCount) console.log(`  restored : ${createdCount} missing piece(s)`);
    if (injected.length) console.log(`  injected : faculty block → ${injected.join(', ')}`);
    if (!createdCount && !injected.length && !ignoreAdded.length) console.log('  (complete — nothing to do)');
  } else if (greenfield) {
    console.log(`Initialized empty zuzuu home in ${join(cwd, 'agent')}/`);
    console.log(`  faculties : knowledge/ memory/ actions/ instructions/ guardrails/  (+ agent.json manifest)`);
    console.log(`  steering  : created ${created.join(' + ')} pointing your agent at its faculties`);
    console.log(`  next      : \`zuzuu enable\` for live capture · \`zuzuu digest\` to preview the grounding your agent opens with · start your agent in ${basename(cwd)}/`);
  } else {
    console.log(`Initialized zuzuu home in existing project ${join(cwd, 'agent')}/`);
    console.log(`  faculties : knowledge/ memory/ actions/ instructions/ guardrails/  (+ agent.json manifest)`);
    const steer = [];
    if (injected.length) steer.push(`injected → ${injected.join(', ')}`);
    if (created.length) steer.push(`created ${created.join(' + ')} (read by Codex/OpenCode/pi)`);
    if (steer.length) console.log(`  steering  : ${steer.join(' · ')}`);
    const hosts = detected().map((a) => a.name).join(', ');
    if (hosts) console.log(`  hosts     : detected ${hosts} — \`zuzuu capture\` works now; \`zuzuu enable\` for live`);
  }
  if (ignoreAdded.length) console.log(`  gitignore : +${ignoreAdded.join(' ')}`);
}
