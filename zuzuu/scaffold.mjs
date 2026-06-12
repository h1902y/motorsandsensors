// The faculty-home scaffold — the layout contract for `zuzuu init`.
//
// Git-init discipline: idempotent and never destructive. plan() inspects what
// exists; apply() creates ONLY what's missing — it never overwrites a file, so
// user edits to any seeded file always survive a re-init.
//
// Layout = the five faculties (docs/DESIGN.md §3①, the 5+3 anatomy):
//   agent/agent.json + knowledge/ memory/ actions/ instructions/ guardrails/
// Guardrails became first-class (enforced via the PreToolUse gate) on 2026-06-10;
// the old instructions/guardrails.md advisory seed left the layout (existing
// projects keep theirs — no-clobber — but new scaffolds get the real faculty).

import { join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { SEED_TYPES, SEED_ATTRIBUTES, SEED_RELATIONS } from './knowledge/registry.mjs';

export const MANIFEST_VERSION = 3;

const AGENT_README = `# agent/ — your coding agent's home, in the open

This directory is your agent's evolving brain. Five **faculties** grow from how you
actually work — and **nothing changes without your approval**.

## The five faculties
- **knowledge/** — what's TRUE (facts about this project)
- **memory/** — what HAPPENED (curated episodes from past sessions)
- **actions/** — how to DO things (runbooks the agent can call)
- **instructions/** — who to BE (steering / project conventions)
- **guardrails/** — what NOT to do (enforced rules, checked on every tool call)

## How things graduate (you're in the loop)
    a session runs  →  zuzuu mines candidates  →  inbox/  →  proposals/
                                                              │  you decide
                                                    zuzuu review  (y / n / edit)
                                                              ▼
                                          approved → the faculty + a new *generation*
A **generation** is a pinned checkpoint of every faculty. Approving proposals mints
one; \`zuzuu generation rollback <id>\` restores any earlier checkpoint.

## Get in the loop
- \`zuzuu inbox\`            — what's waiting for your approval
- \`zuzuu review\`          — approve / reject, one at a time
- \`zuzuu generation list\` — your checkpoints (· = active)
- \`zuzuu explain\`         — this model, any time

## What to ignore
\`.traces/\`, \`.live/\`, and \`knowledge/.index.db\` are machine internals (git-ignored).
Everything else here is yours to read, edit, and version in git.
`;

const KNOWLEDGE_README = `# knowledge/ — the Knowledge faculty (what's TRUE)

Items in \`items/\` — one fact/entity per file: prose body + typed attributes +
typed relations (registry-governed: \`registry/\`) + provenance. The derived
search index (\`.index.db\`, git-ignored) gives lexical/graph/semantic recall:
\`zuzuu recall\`. Candidates arrive in \`inbox/\` (from agents or \`zuzuu distill\`),
become \`proposals/\`, and a human approves via \`zuzuu review\` — never silently.
\`zuzuu remember\` writes directly (the human IS the gate). \`zuzuu knowledge audit\`
checks health.
`;

const MEMORY_README = `# memory/ — episodic faculty (what HAPPENED)

Curated recollections of past sessions, distilled from the observability traces (\`agent/.traces/\`).
- **Who writes:** zuzuu (distillation — *not built yet*), human (curation). Raw traces stay in traces/ — this is the *curated* layer.
- **Where:** one Markdown file per entry under \`entries/\`, named \`<id>.md\`.

## Record schema (Markdown + YAML frontmatter)
\`\`\`markdown
---
id: mem-2026-06-11-flaky-ci-retry      # mem-<YYYY-MM-DD>-<slug>, stable
date: 2026-06-11                        # ISO date the episode occurred
title: Flaky CI fixed by pinning node 22
provenance:                            # links back to observability
  sessions: [ses_abc123]               # ids that exist in agent/sessions.json
  hosts: [claude-code]
tags: [ci, flaky-test]                 # optional
status: curated                        # curated (human) | proposed (reserved — future distiller)
---
## Attempted
What was tried.
## Resulted
What happened (outcome / error / fix).
## Remember next time
The durable lesson.
\`\`\`
\`status: proposed\` and the distiller→review pipeline are **reserved** (not built this pass).
`;

const ACTIONS_README = `# actions/ — procedural faculty (how to DO things)

Named, reusable procedures/skills for this project (scripts, runbooks, tool recipes).
- **Who writes:** the human; later, zuzuu proposes crystallized actions mined from traces (human-approved).
- **Contract:** one action per file; state what it does, inputs, and how to invoke it.
- **Propose a reusable action**: \`zuzuu act propose <slug>\` scaffolds into \`actions/inbox/\` for review. A human approves via \`zuzuu review\` (or \`zuzuu act approve <slug>\`). Never write active actions directly from an agent.
`;

const INSTRUCTIONS_README = `# instructions/ — the Instructions faculty (directive: who the agent is)

Cognition steering: identity, conventions, priorities — the project-level seed of
the pinned system prompt. The host agent reads and follows this.
- \`project.md\` — project-specific steering (what this is, conventions, priorities).
- Hard *enforced* rules live in \`../guardrails/\` (a separate faculty), not here.
`;

const PROJECT_SEED = `# Project steering

<!-- Fill in: what this project is, conventions, priorities. The host agent reads this. -->
`;

const GUARDRAILS_README = `# guardrails/ — the Guardrails faculty (enforced, not advisory)

Declarative rules in \`rules.json\`, evaluated on every tool call by the zuzuu
PreToolUse gate (installed by \`zuzuu enable\`). Severity wins: deny > ask > allow;
no match → the host's normal permission flow. The engine FAILS OPEN — a
guardrail bug can block nothing — and matched decisions are logged for the trace.

Rule shape: \`{ id, action: deny|ask|allow, tool: "Bash"|"*", pattern: <regex
over the tool input>, reason }\`. Edit, commit, done — rules are definitions,
versioned in git like everything else.
`;

const RULES_SEED =
  JSON.stringify(
    {
      version: 1,
      rules: [
        { id: 'no-root-wipe', action: 'deny', tool: 'Bash', pattern: 'rm\\s+-[a-z]*r[a-z]*\\s+/(\\s|$)', reason: 'destructive delete at filesystem root' },
        { id: 'no-secret-reads', action: 'deny', tool: '*', pattern: '\\.env(\\.|\\b)|id_rsa|\\.pem\\b', reason: 'secret material should not enter the context' },
        // \b.*\bpush, not push adjacent to git: a real session bypassed the
        // adjacent form with `git -C /path push --force-with-lease` (exp-8).
        { id: 'confirm-force-push', action: 'ask', tool: 'Bash', pattern: 'git\\b.*\\bpush\\b.*--force', reason: 'force-push rewrites shared history' },
      ],
    },
    null,
    2,
  ) + '\n';

/** The layout contract: dirs + seed files (relative to the project root). */
export const LAYOUT = {
  dirs: ['agent', 'agent/knowledge', 'agent/knowledge/registry', 'agent/knowledge/items', 'agent/knowledge/inbox', 'agent/knowledge/proposals', 'agent/memory', 'agent/memory/entries', 'agent/memory/inbox', 'agent/memory/proposals', 'agent/actions', 'agent/actions/inbox', 'agent/instructions', 'agent/instructions/inbox', 'agent/instructions/proposals', 'agent/guardrails', 'agent/guardrails/inbox', 'agent/guardrails/proposals', 'agent/generations', 'agent/generations/snapshots'],
  files: {
    'agent/README.md': AGENT_README,
    'agent/knowledge/README.md': KNOWLEDGE_README,
    'agent/memory/README.md': MEMORY_README,
    'agent/actions/README.md': ACTIONS_README,
    'agent/instructions/README.md': INSTRUCTIONS_README,
    'agent/instructions/project.md': PROJECT_SEED,
    'agent/guardrails/README.md': GUARDRAILS_README,
    'agent/guardrails/rules.json': RULES_SEED,
    'agent/knowledge/registry/types.json': JSON.stringify(SEED_TYPES, null, 2) + '\n',
    'agent/knowledge/registry/attributes.json': JSON.stringify(SEED_ATTRIBUTES, null, 2) + '\n',
    'agent/knowledge/registry/relations.json': JSON.stringify(SEED_RELATIONS, null, 2) + '\n',
  },
};

/** Gitignore lines the project needs (trace blobs + liveness state stay local). */
export const IGNORE_LINES = ['agent/.traces/', 'agent/.live/', 'agent/knowledge/.index.db', '.gemini/settings.json', '.codex/hooks.json', '.pi/extensions/zuzuu.ts'];

export function manifest(initializedAt) {
  return {
    version: MANIFEST_VERSION,
    initializedAt,
    layout: ['knowledge', 'memory', 'actions', 'instructions', 'guardrails'],
  };
}

/**
 * Inspect the project: which layout pieces are missing?
 * @returns {{dirs: string[], files: string[], manifestMissing: boolean}}
 */
export function planScaffold(cwd) {
  const dirs = LAYOUT.dirs.filter((d) => !existsSync(join(cwd, d)));
  const files = Object.keys(LAYOUT.files).filter((f) => !existsSync(join(cwd, f)));
  const manifestMissing = !existsSync(join(cwd, 'agent', 'agent.json'));
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
    mkdirSync(join(cwd, 'agent'), { recursive: true });
    writeFileSync(join(cwd, 'agent', 'agent.json'), JSON.stringify(manifest(new Date(now).toISOString()), null, 2) + '\n');
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
  const block = (existing && !existing.endsWith('\n') ? '\n' : '') + '\n# zuzuu: local-only observability data\n' + missing.join('\n') + '\n';
  writeFileSync(path, existing + block);
  return missing;
}

/** Is there a zuzuu home here already? (the git-detect question) */
export function homeExists(cwd) {
  return existsSync(join(cwd, 'agent'));
}
