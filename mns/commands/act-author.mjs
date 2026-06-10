// mns/commands/act-author.mjs
// `mns act new <slug>` — scaffold a script action (idempotent, no-clobber).
// `mns act schema <slug> [--mcp|--openai|--anthropic]` — convert the manifest.

import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { actionsDir, inboxDir, loadManifest, isSafeSlug } from '../actions/manifest.mjs';
import { toMcpTool, toOpenAITool, toAnthropicTool } from '../actions/convert.mjs';

function manifestStub(slug) {
  return JSON.stringify({
    slug,
    title: slug,
    description: 'what this action does',
    promptSnippet: `one line the digest shows for ${slug}`,
    inputs: { type: 'object', properties: {}, required: [] },
    outputs: { type: 'object', properties: {} },
    default_args: {},
    requires: [],
  }, null, 2) + '\n';
}

const RUN_TEMPLATE = `// run.mjs — implement the action. Export async main(args) → a JSON object.
// Optional: export prepareArguments(args) to fold legacy args before validation.

// export function prepareArguments(args) { return args; }

export async function main(args) {
  // args is validated against action.json "inputs"; return must match "outputs".
  return { ok: true };
}
`;

/** Scaffold an action dir under `baseDir/<slug>/`. No-clobber. */
function scaffoldInto(baseDir, slug) {
  if (!isSafeSlug(slug)) throw new Error(`invalid slug '${slug}' — letters, digits, - and _ only`);
  const dir = join(baseDir, slug);
  mkdirSync(dir, { recursive: true });
  const created = [];
  const write = (name, body) => {
    const p = join(dir, name);
    if (!existsSync(p)) { writeFileSync(p, body); created.push(name); }
  };
  write('action.json', manifestStub(slug));
  write('run.mjs', RUN_TEMPLATE);
  return { created };
}

/** Scaffold a live action (.mns/actions/<slug>/). Humans author here directly. */
export function scaffoldAction(mnsDir, slug) {
  return scaffoldInto(actionsDir(mnsDir), slug);
}

/** Scaffold a PROPOSED action (.mns/actions/inbox/<slug>/) — agents propose here. */
export function proposeAction(mnsDir, slug) {
  return scaffoldInto(inboxDir(mnsDir), slug);
}

export function newAction(mnsDir, slug) {
  if (!slug) { console.error('usage: mns act new <slug>'); process.exit(1); }
  const { created } = scaffoldAction(mnsDir, slug);
  if (created.length) console.log(`scaffolded action '${slug}' → ${created.join(', ')} in .mns/actions/${slug}/`);
  else console.log(`action '${slug}' already complete — nothing to do`);
}

export function schema(mnsDir, slug, args = {}) {
  if (!slug) { console.error('usage: mns act schema <slug> [--mcp|--openai|--anthropic]'); process.exit(1); }
  const man = loadManifest(mnsDir, slug);
  if (!man) { console.error(`no action '${slug}' (missing action.json)`); process.exit(1); }
  const def = args.openai ? toOpenAITool(man) : args.anthropic ? toAnthropicTool(man) : toMcpTool(man);
  console.log(JSON.stringify(def, null, 2));
}
