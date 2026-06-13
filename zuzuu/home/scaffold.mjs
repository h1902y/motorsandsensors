// The module-home scaffold — the layout contract for `zuzuu init`.
//
// Git-init discipline: idempotent and never destructive. plan() inspects what
// exists; apply() creates ONLY what's missing — it never overwrites a file, so
// user edits to any seeded file always survive a re-init.
//
// Layout = the five modules (docs/DESIGN.md §3①, the 5+3 anatomy):
//   .zuzuu/agent.json + knowledge/ memory/ actions/ instructions/ guardrails/
// The home is HIDDEN (.zuzuu/, like .git — decided 2026-06-12, DESIGN §13):
// transparency comes from porcelain (zz status/explain/digest) + plain-text
// files inside; the only visible footprint is the managed block + .gitignore lines.
// Guardrails became first-class (enforced via the PreToolUse gate) on 2026-06-10;
// the old instructions/guardrails.md advisory seed left the layout (existing
// projects keep theirs — no-clobber — but new scaffolds get the real module).

import { join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { SEED_TYPES, SEED_ATTRIBUTES, SEED_RELATIONS } from '../knowledge/registry.mjs';
import { serializeEnvelope, PAYLOAD_SCHEMAS, MODULE_KINDS } from '../module/envelope.mjs';
import { BUILTIN_MODULES } from '../module/registry.mjs';

export const MANIFEST_VERSION = 4;

// Deterministic seed timestamp (the Module Standard date) — seeds are pinned
// definitions, so idempotent re-inits must produce byte-identical files.
const SEED_AT = '2026-06-12T00:00:00Z';

const AGENT_README = `# .zuzuu/ — your agent's home (hidden, like .git — yours to read & version)

This directory is your agent's evolving brain. Five **modules** grow from how you
actually work — and **nothing changes without your approval**. It's dot-prefixed to
stay out of your way; everything inside is plain text, versioned in git, and
surfaced by \`zuzuu status\` / \`zuzuu explain\` / \`zuzuu digest\`.

## The five modules
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
                                          approved → the module + a new *generation*
A **generation** is a pinned checkpoint of every module. Approving proposals mints
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

const KNOWLEDGE_README = `# knowledge/ — the Knowledge module (what's TRUE)

Items in \`items/\` — one fact/entity per file: prose body + typed attributes +
typed relations (registry-governed: \`registry/\`) + provenance. The derived
search index (\`.index.db\`, git-ignored) gives lexical/graph/semantic recall:
\`zuzuu recall\`. Candidates arrive in \`inbox/\` (from agents or \`zuzuu distill\`),
become \`proposals/\`, and a human approves via \`zuzuu review\` — never silently.
\`zuzuu remember\` writes directly (the human IS the gate). \`zuzuu knowledge audit\`
checks health.
`;

const MEMORY_README = `# memory/ — episodic module (what HAPPENED)

Curated recollections of past sessions, distilled from the observability traces (\`.zuzuu/.traces/\`).
- **Who writes:** zuzuu (distillation — *not built yet*), human (curation). Raw traces stay in traces/ — this is the *curated* layer.
- **Where:** one Markdown file per entry under \`entries/\`, named \`<id>.md\`.

## Record schema (the Module Standard envelope)
\`\`\`markdown
---
id: mem-2026-06-11-flaky-ci-retry      # mem-<YYYY-MM-DD>-<slug>, stable
module: memory
kind: episode
title: Flaky CI fixed by pinning node 22
status: active
created_at: 2026-06-11                 # ISO date the episode occurred
payload:
  sessions:                            # ids that exist in .zuzuu/sessions.json
    - ses_abc123
  hosts:
    - claude-code
  tags:                                # optional
    - ci
    - flaky-test
---
## Attempted
What was tried.
## Resulted
What happened (outcome / error / fix).
## Remember next time
The durable lesson.
\`\`\`
`;

const ACTIONS_README = `# actions/ — procedural module (how to DO things)

Named, reusable procedures/skills for this project (scripts, runbooks, tool recipes).
- **Who writes:** the human; later, zuzuu proposes crystallized actions mined from traces (human-approved).
- **Contract:** one action per file; state what it does, inputs, and how to invoke it.
- **Propose a reusable action**: \`zuzuu act propose <slug>\` scaffolds into \`actions/inbox/\` for review. A human approves via \`zuzuu review\` (or \`zuzuu act approve <slug>\`). Never write active actions directly from an agent.
`;

const INSTRUCTIONS_README = `# instructions/ — the Instructions module (directive: who the agent is)

Cognition steering: identity, conventions, priorities — the project-level seed of
the pinned system prompt. The host agent reads and follows this.
- \`items/steering.md\` — the pinned steering item (what this is, conventions, priorities).
- Approved amendments land as further items in \`items/\` (kind: amendment).
- Hard *enforced* rules live in \`../guardrails/\` (a separate module), not here.
`;

const STEERING_SEED = serializeEnvelope({
  id: 'steering',
  module: 'instructions',
  kind: 'steering',
  title: 'Project steering',
  status: 'active',
  created_at: SEED_AT,
  payload: { scope: 'project' },
  body: '<!-- Fill in: what this project is, conventions, priorities. The host agent reads this. -->',
});

const GUARDRAILS_README = `# guardrails/ — the Guardrails module (enforced, not advisory)

One rule per envelope item in \`items/\` (markdown + frontmatter; payload =
\`{ action: deny|ask|allow, tool: "Bash"|"*", pattern: <regex over the tool
input>, reason }\`; the body is optional rationale prose). Every tool call is
evaluated by the zuzuu PreToolUse gate (installed by \`zuzuu enable\`). Severity
wins: deny > ask > allow; no match → the host's normal permission flow. The
engine FAILS OPEN — a malformed item is skipped, never a block — and matched
decisions are logged for the trace. Edit, commit, done — rules are definitions,
versioned in git like everything else.
`;

/** Seeded rules, one envelope item each (the Module Standard, W24). */
const ruleSeed = ({ id, title, action, tool, pattern, reason, body }) =>
  serializeEnvelope({
    id, module: 'guardrails', kind: 'rule', title, status: 'active', created_at: SEED_AT,
    payload: { action, tool, pattern, reason }, body,
  });

const RULE_SEEDS = {
  'no-root-wipe': ruleSeed({
    id: 'no-root-wipe', title: 'No destructive delete at filesystem root', action: 'deny', tool: 'Bash',
    pattern: 'rm\\s+-[a-z]*r[a-z]*\\s+/(\\s|$)', reason: 'destructive delete at filesystem root',
    body: 'Blocks `rm -rf /` and flag-order variants targeting the filesystem root.',
  }),
  'no-secret-reads': ruleSeed({
    id: 'no-secret-reads', title: 'No reading secret material', action: 'deny', tool: '*',
    pattern: '\\.env(\\.|\\b)|id_rsa|\\.pem\\b', reason: 'secret material should not enter the context',
    body: 'Keys and env files must not enter the model context — across every tool, not just Bash.',
  }),
  'confirm-force-push': ruleSeed({
    id: 'confirm-force-push', title: 'Confirm before force-push', action: 'ask', tool: 'Bash',
    pattern: 'git\\b.*\\bpush\\b.*--force', reason: 'force-push rewrites shared history',
    // \b.*\bpush, not push adjacent to git: a real session bypassed the
    // adjacent form with `git -C /path push --force-with-lease` (exp-8).
    body: 'Asks (never blocks) on any force-push. The loose `git\\b.*\\bpush` form catches the real exp-8 bypass: `git -C /path push --force-with-lease`.',
  }),
};

/** Envelope spec seed (.zuzuu/schema.json) — descriptive, for humans + tools. */
const ENVELOPE_SPEC = JSON.stringify(
  {
    standard: 'zuzuu-module-envelope',
    version: 1,
    description: 'One file per item: markdown body + strict frontmatter. One rigid envelope across all five modules; payload is module-typed and validated by <module>/schema.json.',
    envelope: {
      id: 'required — slug [a-z0-9-]',
      module: 'required — knowledge|memory|actions|instructions|guardrails',
      kind: 'required — per-module kinds (see kinds)',
      title: 'required — single line',
      status: 'active|archived (default active)',
      created_at: 'required — ISO date/datetime',
      updated_at: 'optional — ISO date/datetime',
      provenance: 'optional list of {session, ref}',
      payload: 'module-typed machine fields (see <module>/schema.json)',
    },
    kinds: { ...MODULE_KINDS, knowledge: 'registry-governed (knowledge/registry/types.json)' },
  },
  null,
  2,
) + '\n';

const payloadSchemaSeed = (f) => JSON.stringify(PAYLOAD_SCHEMAS[f], null, 2) + '\n';

/** Module manifest seed (module.json) — the built-in module's canonical
 *  manifest, serialized. Pinned definitions: byte-identical on re-init. */
export const manifestSeed = (f) => JSON.stringify(BUILTIN_MODULES[f].manifest, null, 2) + '\n';

/** The layout contract: dirs + seed files (relative to the project root). */
export const LAYOUT = {
  dirs: ['.zuzuu', '.zuzuu/knowledge', '.zuzuu/knowledge/registry', '.zuzuu/knowledge/items', '.zuzuu/knowledge/inbox', '.zuzuu/knowledge/proposals', '.zuzuu/memory', '.zuzuu/memory/entries', '.zuzuu/memory/inbox', '.zuzuu/memory/proposals', '.zuzuu/actions', '.zuzuu/actions/inbox', '.zuzuu/instructions', '.zuzuu/instructions/items', '.zuzuu/instructions/inbox', '.zuzuu/instructions/proposals', '.zuzuu/guardrails', '.zuzuu/guardrails/items', '.zuzuu/guardrails/inbox', '.zuzuu/guardrails/proposals', '.zuzuu/generations', '.zuzuu/generations/snapshots'],
  files: {
    '.zuzuu/README.md': AGENT_README,
    '.zuzuu/schema.json': ENVELOPE_SPEC,
    '.zuzuu/knowledge/README.md': KNOWLEDGE_README,
    '.zuzuu/knowledge/schema.json': payloadSchemaSeed('knowledge'),
    '.zuzuu/knowledge/module.json': manifestSeed('knowledge'),
    '.zuzuu/memory/README.md': MEMORY_README,
    '.zuzuu/memory/schema.json': payloadSchemaSeed('memory'),
    '.zuzuu/memory/module.json': manifestSeed('memory'),
    '.zuzuu/actions/README.md': ACTIONS_README,
    '.zuzuu/actions/schema.json': payloadSchemaSeed('actions'),
    '.zuzuu/actions/module.json': manifestSeed('actions'),
    '.zuzuu/instructions/README.md': INSTRUCTIONS_README,
    '.zuzuu/instructions/schema.json': payloadSchemaSeed('instructions'),
    '.zuzuu/instructions/module.json': manifestSeed('instructions'),
    '.zuzuu/instructions/items/steering.md': STEERING_SEED,
    '.zuzuu/guardrails/README.md': GUARDRAILS_README,
    '.zuzuu/guardrails/schema.json': payloadSchemaSeed('guardrails'),
    '.zuzuu/guardrails/module.json': manifestSeed('guardrails'),
    '.zuzuu/guardrails/items/no-root-wipe.md': RULE_SEEDS['no-root-wipe'],
    '.zuzuu/guardrails/items/no-secret-reads.md': RULE_SEEDS['no-secret-reads'],
    '.zuzuu/guardrails/items/confirm-force-push.md': RULE_SEEDS['confirm-force-push'],
    '.zuzuu/knowledge/registry/types.json': JSON.stringify(SEED_TYPES, null, 2) + '\n',
    '.zuzuu/knowledge/registry/attributes.json': JSON.stringify(SEED_ATTRIBUTES, null, 2) + '\n',
    '.zuzuu/knowledge/registry/relations.json': JSON.stringify(SEED_RELATIONS, null, 2) + '\n',
  },
};

/** Gitignore lines the project needs (trace blobs + liveness state stay local). */
export const IGNORE_LINES = ['.zuzuu/.traces/', '.zuzuu/.live/', '.zuzuu/knowledge/.index.db', '.gemini/settings.json', '.codex/hooks.json', '.pi/extensions/zuzuu.ts'];

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
  const manifestMissing = !existsSync(join(cwd, '.zuzuu', 'agent.json'));
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
    mkdirSync(join(cwd, '.zuzuu'), { recursive: true });
    writeFileSync(join(cwd, '.zuzuu', 'agent.json'), JSON.stringify(manifest(new Date(now).toISOString()), null, 2) + '\n');
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
  return existsSync(join(cwd, '.zuzuu'));
}
