// zuzuu/commands/act-author.mjs
// `zuzuu act new <slug>` — scaffold a script action (idempotent, no-clobber).
// `zuzuu act schema <slug> [--mcp|--openai|--anthropic]` — convert the manifest.
// Actions are described by ACTION.md (the Module Standard envelope, W24).

import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { actionsDir, inboxDir, loadManifest, isSafeSlug } from '../actions/manifest.mjs';
import { toMcpTool, toOpenAITool, toAnthropicTool } from '../actions/convert.mjs';
import { serializeEnvelope } from '../module/envelope.mjs';

function actionMdStub(slug) {
  return serializeEnvelope({
    id: slug,
    module: 'actions',
    kind: 'script',
    title: slug,
    status: 'active',
    created_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    payload: { exec: 'run.mjs' },
    body: [
      `What ${slug} does — the first line is the one-liner the digest shows.`,
      '',
      '## Usage',
      '',
      `\`zuzuu act ${slug} --args '{"key":"value"}'\``,
      '',
      'Describe inputs, outputs, and when to reach for this action here.',
    ].join('\n'),
  });
}

const RUN_TEMPLATE = `// run.mjs — implement the action. Export async main(args) → a JSON object.
// Optional: export prepareArguments(args) to fold legacy args before validation.

// export function prepareArguments(args) { return args; }

export async function main(args) {
  // args = ACTION.md payload.args defaults merged with caller --args (caller wins).
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
  write('ACTION.md', actionMdStub(slug));
  write('run.mjs', RUN_TEMPLATE);
  return { created };
}

/** Scaffold a live action (.zuzuu/actions/<slug>/). Humans author here directly. */
export function scaffoldAction(agentDir, slug) {
  return scaffoldInto(actionsDir(agentDir), slug);
}

/** Scaffold a PROPOSED action (.zuzuu/actions/inbox/<slug>/) — agents propose here. */
export function proposeAction(agentDir, slug) {
  return scaffoldInto(inboxDir(agentDir), slug);
}

export function newAction(agentDir, slug) {
  if (!slug) { console.error('usage: zuzuu act new <slug>'); process.exit(1); }
  const { created } = scaffoldAction(agentDir, slug);
  if (created.length) console.log(`scaffolded action '${slug}' → ${created.join(', ')} in .zuzuu/actions/${slug}/`);
  else console.log(`action '${slug}' already complete — nothing to do`);
}

export function schema(agentDir, slug, args = {}) {
  if (!slug) { console.error('usage: zuzuu act schema <slug> [--mcp|--openai|--anthropic]'); process.exit(1); }
  const man = loadManifest(agentDir, slug);
  if (!man) { console.error(`no action '${slug}' (missing ACTION.md)`); process.exit(1); }
  const def = args.openai ? toOpenAITool(man) : args.anthropic ? toAnthropicTool(man) : toMcpTool(man);
  console.log(JSON.stringify(def, null, 2));
}
