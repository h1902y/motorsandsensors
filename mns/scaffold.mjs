// The faculty-home scaffold — the layout contract for `mns init`.
//
// Git-init discipline: idempotent and never destructive. plan() inspects what
// exists; apply() creates ONLY what's missing — it never overwrites a file, so
// user edits to any seeded file always survive a re-init.
//
// v1 layout (be-layer faculties; guardrails merged into instructions/ until a
// real enforcement runtime exists — see README §5):
//   .mns/mns.json + knowledge/ memory/ actions/ instructions/

import { join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';

export const MANIFEST_VERSION = 1;

const KNOWLEDGE_README = `# knowledge/ — semantic faculty (what's TRUE)

Project facts, entities, and relations the agent should treat as ground truth.
- **Who writes:** the human, and (soon) mns's entity-resolution pipeline distilling sessions into facts.
- **Contract:** one fact per line/section, declarative, no speculation. Wrong facts get deleted, not argued with.
- **Graduates:** contents are promoted (md → richer substrates) via human-approved proposals — never silently.
`;

const MEMORY_README = `# memory/ — episodic faculty (what HAPPENED)

Curated recollections of past sessions, distilled from the observability traces (\`.mns/traces/\`).
- **Who writes:** mns (distillation), human (curation). Raw traces stay in traces/ — this is the *curated* layer.
- **Contract:** dated entries; what was attempted, what resulted, what to remember next time.
`;

const ACTIONS_README = `# actions/ — procedural faculty (how to DO things)

Named, reusable procedures/skills for this project (scripts, runbooks, tool recipes).
- **Who writes:** the human; later, mns proposes crystallized actions mined from traces (human-approved).
- **Contract:** one action per file; state what it does, inputs, and how to invoke it.
`;

const INSTRUCTIONS_README = `# instructions/ — cognition steering (+ guardrails, v1)

What the host agent should read and follow in this project. v1 merges guardrails
in here as advisory rules (there is no enforcement runtime yet); they remain
conceptually separate and will graduate to enforced gates later.
- \`project.md\` — project-specific steering (conventions, priorities, context).
- \`guardrails.md\` — rules the agent must follow (advisory in v1).
`;

const PROJECT_SEED = `# Project steering

<!-- Fill in: what this project is, conventions, priorities. The host agent reads this. -->
`;

const GUARDRAILS_SEED = `# Guardrails (v1 — advisory rules the agent follows)

- Do not read \`.mns/traces/\` or \`.mns/live/\` (observability internals).
- Record durable, verified project facts in \`.mns/knowledge/\`; never speculation.
<!-- Add project-specific rules below. -->
`;

/** The layout contract: dirs + seed files (relative to the project root). */
export const LAYOUT = {
  dirs: ['.mns', '.mns/knowledge', '.mns/memory', '.mns/actions', '.mns/instructions'],
  files: {
    '.mns/knowledge/README.md': KNOWLEDGE_README,
    '.mns/memory/README.md': MEMORY_README,
    '.mns/actions/README.md': ACTIONS_README,
    '.mns/instructions/README.md': INSTRUCTIONS_README,
    '.mns/instructions/project.md': PROJECT_SEED,
    '.mns/instructions/guardrails.md': GUARDRAILS_SEED,
  },
};

/** Gitignore lines the project needs (trace blobs + liveness state stay local). */
export const IGNORE_LINES = ['.mns/traces/', '.mns/live/'];

export function manifest(initializedAt) {
  return {
    version: MANIFEST_VERSION,
    initializedAt,
    layout: ['knowledge', 'memory', 'actions', 'instructions'],
  };
}

/**
 * Inspect the project: which layout pieces are missing?
 * @returns {{dirs: string[], files: string[], manifestMissing: boolean}}
 */
export function planScaffold(cwd) {
  const dirs = LAYOUT.dirs.filter((d) => !existsSync(join(cwd, d)));
  const files = Object.keys(LAYOUT.files).filter((f) => !existsSync(join(cwd, f)));
  const manifestMissing = !existsSync(join(cwd, '.mns', 'mns.json'));
  return { dirs, files, manifestMissing };
}

/**
 * Create ONLY the missing pieces (no-clobber). Returns what was created.
 * @param {string} cwd
 * @param {{now?: number}} opts  injectable clock for tests
 */
export function applyScaffold(cwd, { now = Date.now() } = {}) {
  const plan = planScaffold(cwd);
  for (const d of plan.dirs) mkdirSync(join(cwd, d), { recursive: true });
  for (const f of plan.files) writeFileSync(join(cwd, f), LAYOUT.files[f]);
  if (plan.manifestMissing) {
    mkdirSync(join(cwd, '.mns'), { recursive: true });
    writeFileSync(join(cwd, '.mns', 'mns.json'), JSON.stringify(manifest(new Date(now).toISOString()), null, 2) + '\n');
  }
  return plan;
}

/**
 * Ensure the project .gitignore carries our ignore lines (append-only; creates
 * the file if absent). Returns the lines actually added.
 */
export function ensureGitignore(cwd) {
  const path = join(cwd, '.gitignore');
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const have = new Set(existing.split('\n').map((l) => l.trim()));
  const missing = IGNORE_LINES.filter((l) => !have.has(l));
  if (!missing.length) return [];
  const block = (existing && !existing.endsWith('\n') ? '\n' : '') + '\n# mns: local-only observability data\n' + missing.join('\n') + '\n';
  writeFileSync(path, existing + block);
  return missing;
}

/** Is there an mns home here already? (the git-detect question) */
export function homeExists(cwd) {
  return existsSync(join(cwd, '.mns'));
}
