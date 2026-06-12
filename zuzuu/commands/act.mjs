// zuzuu/commands/act.mjs
// `zuzuu act` — the Actions faculty CLI. The host's Bash invokes this, so each run
// is an observable span already covered by the guardrails gate. Subcommands:
//   zuzuu act [list]            the index (slug · kind · snippet)
//   zuzuu act show <slug>       full manifest (script) or SKILL.md (runbook)
//   zuzuu act <slug> [--args J] run a script action
//   zuzuu act new <slug>        scaffold (Task 8)
//   zuzuu act schema <slug>     convert to a tool definition (Task 8)

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from '../store.mjs';
import { allActions, loadManifest, actionsDir, isSafeSlug } from '../actions/manifest.mjs';
import { runAction } from '../actions/dispatch.mjs';
import { MARKER } from '../actions/marker.mjs';
import { newAction, schema as schemaCmd, proposeAction } from './act-author.mjs';
import { listProposedActions, activateAction, rejectAction } from '../actions/inbox.mjs';
import { recordOutcome } from '../actions/trail.mjs';

const RESERVED = new Set(['list', 'show', 'new', 'schema', 'propose', 'inbox', 'approve', 'reject']);

function requireSlug(slug, usage) {
  if (!slug) { console.error(usage); process.exit(1); }
  if (!isSafeSlug(slug)) { console.error(`invalid slug '${slug}' — letters, digits, - and _ only`); process.exit(1); }
  return slug;
}

function list(agentDir) {
  const actions = allActions(agentDir);
  if (!actions.length) return console.log('no actions yet — scaffold one with `zuzuu act new <slug>`');
  for (const a of actions.sort((x, y) => x.slug.localeCompare(y.slug))) {
    console.log(`  ${a.slug}  [${a.kind}]  ${a.promptSnippet}`);
  }
}

function show(agentDir, slug) {
  if (!slug) { console.error('usage: zuzuu act show <slug>'); process.exit(1); }
  const man = loadManifest(agentDir, slug);
  if (man) return console.log(JSON.stringify(man, null, 2));
  const skill = join(actionsDir(agentDir), slug, 'SKILL.md');
  if (existsSync(skill)) return process.stdout.write(readFileSync(skill, 'utf8'));
  console.error(`no action '${slug}'`);
  process.exit(1);
}

function run(agentDir, slug, args) {
  let callerArgs = {};
  if (args.args) {
    try { callerArgs = JSON.parse(args.args); }
    catch { console.error('--args must be valid JSON'); process.exit(1); }
  }
  const r = runAction(agentDir, slug, callerArgs);
  recordOutcome(agentDir, { slug, ok: r.ok, error: r.ok ? undefined : r.error });
  if (r.logs) process.stdout.write(r.logs + '\n');
  console.log(MARKER + JSON.stringify(r.ok ? { ok: true, value: r.value } : { ok: false, error: r.error, detail: r.detail }));
  if (r.ok) console.log(`✓ ${slug} ok`);
  else console.error(`✗ ${slug}: ${r.error}${r.detail ? ` — ${r.detail}` : ''}`);
  process.exit(r.ok ? 0 : 1);
}

function propose(agentDir, slug) {
  const { created } = proposeAction(agentDir, slug);
  if (created.length) console.log(`proposed action '${slug}' → ${created.join(', ')} in .zuzuu/actions/inbox/${slug}/ (review with \`zuzuu review\`)`);
  else console.log(`proposed action '${slug}' already complete — nothing to do`);
}

function inbox(agentDir) {
  const pending = listProposedActions(agentDir);
  if (!pending.length) return console.log('no proposed actions — inbox empty');
  for (const a of pending.sort((x, y) => x.slug.localeCompare(y.slug))) {
    console.log(`  ${a.slug}  [${a.kind}]  ${a.promptSnippet}`);
  }
}

function approve(agentDir, slug) {
  const r = activateAction(agentDir, slug);
  console.log(r.ok ? `✓ activated '${slug}'` : `✗ ${r.error}`);
  process.exit(r.ok ? 0 : 1);
}

function reject(agentDir, slug) {
  const r = rejectAction(agentDir, slug);
  console.log(r.ok ? `✓ rejected '${slug}'` : `✗ ${r.error}`);
  process.exit(r.ok ? 0 : 1);
}

export function act(args) {
  const agentDir = paths().dir;
  const sub = args._[0];
  if (!sub || sub === 'list') return list(agentDir);
  if (sub === 'show') return show(agentDir, requireSlug(args._[1], 'usage: zuzuu act show <slug>'));
  if (sub === 'new') return newAction(agentDir, requireSlug(args._[1], 'usage: zuzuu act new <slug>'));
  if (sub === 'schema') return schemaCmd(agentDir, requireSlug(args._[1], 'usage: zuzuu act schema <slug> [--openai|--anthropic]'), args);
  if (sub === 'propose') return propose(agentDir, requireSlug(args._[1], 'usage: zuzuu act propose <slug>'));
  if (sub === 'inbox') return inbox(agentDir);
  if (sub === 'approve') return approve(agentDir, requireSlug(args._[1], 'usage: zuzuu act approve <slug>'));
  if (sub === 'reject') return reject(agentDir, requireSlug(args._[1], 'usage: zuzuu act reject <slug>'));
  // future-reserved guard: extend RESERVED + add a handler above in tandem
  if (RESERVED.has(sub)) { console.error(`unknown: zuzuu act ${sub}`); process.exit(1); }
  return run(agentDir, requireSlug(sub, 'usage: zuzuu act <slug> [--args JSON]'), args);
}
