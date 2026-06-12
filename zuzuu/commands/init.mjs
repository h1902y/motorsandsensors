// `zuzuu init` — git-style, context-aware, idempotent scaffold of the faculty home.
//
//   empty dir             → greenfield: full scaffold + create AGENTS.md/CLAUDE.md
//   non-empty, no .zuzuu/ → brownfield: scaffold + inject block into existing
//                           instruction files (user content untouched)
//   .zuzuu/ exists        → "Reinitialized": create missing pieces only (no-op
//                           on a complete home; never overwrites anything)
//
// Onboarding contract (W1, 2026-06-12): the output NARRATES what appeared and
// why — the home is hidden (.zuzuu/, like .git), so the init message is the
// user's first and main tour of it.

import { join, basename } from 'node:path';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { applyScaffold, ensureGitignore, homeExists } from '../scaffold.mjs';
import { injectBlock, facultiesBlock, hasBlock, BLOCK_VERSION } from '../inject.mjs';
import { detected } from '../../experiments/experiment-1-trace-capture/adapters/registry.mjs';
import { repoRoot } from '../store.mjs';
import { migrateHome } from './migrate.mjs';

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

/** The friendly tour of what `init` just created (the home is hidden — narrate it). */
function narrateHome() {
  console.log('');
  console.log('  .zuzuu/              your agent\'s home — hidden like .git, yours to read & version');
  console.log('    knowledge/ memory/ actions/ instructions/ guardrails/');
  console.log('                       the five faculties: what\'s TRUE · what HAPPENED · how to DO · who to BE · what NOT to do');
  console.log('    README.md          explains the whole model — start there');
  console.log('');
}

export function init(args = {}) {
  // Root at the git toplevel when inside a repo (same base the store uses for
  // .zuzuu/), falling back to cwd — one project, one home, like .git/.
  const cwd = repoRoot(process.cwd());
  if (cwd !== process.cwd()) console.log(`(project root: ${cwd})`);

  // One-shot home migration: a pre-2026-06-12 visible agent/ home (gated on its
  // agent.json) moves to .zuzuu/. Fail-open — init must never die on migration.
  try {
    if (migrateHome(cwd).migrated) {
      console.log('Migrated agent/ → .zuzuu/ (the faculty home is hidden now, like .git; transparency via `zuzuu status` / `digest` / `explain`)');
    }
  } catch { /* fail-open */ }

  const reinit = homeExists(cwd);
  const greenfield = !reinit && isEmptyDir(cwd);

  const plan = applyScaffold(cwd);
  const ignoreAdded = ensureGitignore(cwd);
  const { injected, created } = serveInstructions(cwd, { greenfield });

  const createdCount = plan.dirs.length + plan.files.length + (plan.manifestMissing ? 1 : 0);

  if (reinit) {
    console.log(`Reinitialized existing zuzuu home in ${join(cwd, '.zuzuu')}/`);
    if (createdCount) console.log(`  restored : ${createdCount} missing piece(s)`);
    if (injected.length) console.log(`  injected : faculty block → ${injected.join(', ')}`);
    if (!createdCount && !injected.length && !ignoreAdded.length) console.log('  (complete — nothing to do)');
  } else {
    console.log(greenfield
      ? `Initialized empty zuzuu home in ${join(cwd, '.zuzuu')}/`
      : `Initialized zuzuu home in existing project ${basename(cwd)}/`);
    narrateHome();
    // the only visible footprint — name it so nothing feels like it appeared unannounced
    const names = [...injected.map((f) => f.replace(/ \(.*\)$/, '')), ...created];
    console.log(`  visible   : only a managed zuzuu block in ${names.join(' + ') || 'your instruction files'}${ignoreAdded.length ? ` and ${ignoreAdded.length} .gitignore line(s)` : ''} — everything else lives inside .zuzuu/`);
    const steer = [];
    if (injected.length) steer.push(`faculty block → ${injected.join(', ')}`);
    if (created.length) steer.push(`created ${created.join(' + ')}`);
    if (steer.length) console.log(`  steering  : ${steer.join(' · ')} (read by your agent at session start)`);
    const hosts = detected().map((a) => a.name).join(', ');
    if (hosts) console.log(`  hosts     : detected ${hosts}`);
    console.log('  next      : `zuzuu enable` (live capture + guardrails gate) → `zuzuu digest` (preview the grounding) → work normally → `zuzuu inbox` / `zuzuu review` when proposals appear');
  }
  if (ignoreAdded.length) console.log(`  gitignore : +${ignoreAdded.join(' ')}`);
}
