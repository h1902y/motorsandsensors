// zuzuu/commands/module.mjs — `zuzuu module` (W24 Module Standard + the
// 2026-06-13 Module contract).
//
// The read surface over the one envelope format + the module contract:
//   zuzuu module items <f> [--json|--jsonl]   list a module's envelope items
//   zuzuu module schema <f> [--json]          print its payload schema
//   zuzuu module manifest <f> [--json]        print its module.json manifest
//   zuzuu module overview [--json]            ALL modules in ONE process:
//                                              manifest.ui + counts + top-3 item
//                                              titles + pending counts (the
//                                              daemon's batching endpoint)
//
// `--json` = one document; `--jsonl` = one item per line (streaming consumers).
// Declarative modules (manifest-only folders) are first-class here: items
// list from manifest.itemsDir, schemas serve from the home, the overview and
// digest include them. Fail-soft like everything on the serve path.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from '../core/store.mjs';
import { listModuleItems } from '../module/items.mjs';
import { listProposals } from '../module/proposal.mjs';
import { PAYLOAD_SCHEMAS, MODULE_KINDS } from '../module/envelope.mjs';
import { modulesOf, moduleOf, get as getAdapter } from '../module/registry.mjs';
import { MODULES } from '../module/contract.mjs';
import {
  moduleGenerations, readModuleGeneration, diffModuleGenerations,
} from '../module/generation/read.mjs';
import { rollbackModule, mintModuleGeneration } from '../module/generation/write.mjs';

/** Pure: one module's envelope items + parse errors (the --json document). */
export function moduleItemsData(agentDir, module, manifest = null) {
  const m = manifest ?? moduleOf(agentDir, module)?.manifest;
  const { items, errors } = listModuleItems(agentDir, module, { itemsDir: m?.itemsDir });
  return { module, count: items.length, items, errors };
}

/**
 * Pure: the payload schema served for a module — the home's seeded
 * `<module>/schema.json` when present and parseable (humans may extend it),
 * else the built-in default. Never throws.
 */
export function moduleSchemaData(agentDir, module) {
  const seeded = join(agentDir, module, 'schema.json');
  if (existsSync(seeded)) {
    try { return { module, source: 'home', schema: JSON.parse(readFileSync(seeded, 'utf8')) }; }
    catch { /* fall through to the built-in */ }
  }
  return { module, source: 'builtin', schema: PAYLOAD_SCHEMAS[module] ?? null };
}

/**
 * Pure: one module's manifest document (home module.json when present,
 * built-in fallback), or null for an unknown module.
 */
export function moduleManifestData(agentDir, module) {
  const entry = moduleOf(agentDir, module);
  if (!entry) return null;
  return {
    module: entry.id,
    source: entry.manifestSource,
    declarative: entry.declarative,
    ...(entry.manifestError ? { error: entry.manifestError } : {}),
    manifest: entry.manifest,
  };
}

/** Pending-proposal count for one module (dir-shaped adapters override). */
function pendingCount(agentDir, entry) {
  try {
    const a = getAdapter(entry.id);
    if (a && typeof a.listProposals === 'function') return a.listProposals(agentDir).length;
    return listProposals(agentDir, entry.id).length;
  } catch {
    return 0;
  }
}

/**
 * Pure: the overview document — EVERY module (built-in + declarative) with
 * manifest/ui, item + pending counts and the top-3 item titles, computed in
 * ONE process (the web daemon's batching endpoint — kills 5-spawn cycles).
 * Fail-soft per module: a broken one reports zeros + its manifestError.
 */
export function moduleOverviewData(agentDir) {
  const modules = modulesOf(agentDir).map((entry) => {
    let items = [], errors = [];
    try {
      ({ items, errors } = listModuleItems(agentDir, entry.id, { itemsDir: entry.manifest?.itemsDir }));
    } catch { /* unreadable → zeros */ }
    return {
      id: entry.id,
      title: entry.manifest?.title ?? entry.id,
      tagline: entry.manifest?.tagline ?? '',
      ui: entry.manifest?.ui ?? {},
      kinds: entry.manifest?.kinds ?? [],
      declarative: entry.declarative,
      ...(entry.manifestError ? { manifestError: entry.manifestError } : {}),
      counts: { items: items.length, pending: pendingCount(agentDir, entry), errors: errors.length },
      top: items.slice(0, 3).map((i) => i.title ?? i.id),
    };
  });
  return { modules };
}

// --- per-module generations (W2.5 Phase 2) ---------------------------------

/** Pure: one module's generation list + active — the daemon /module/:key/generations source. */
export function moduleGenerationsData(agentDir, module) {
  return moduleGenerations(agentDir, module);
}

/** Pure: one module's generation diff, or null for an unknown id. */
export function moduleGenerationShowData(agentDir, module, id) {
  return diffModuleGenerations(agentDir, module, id);
}

/** The text lines for `module <m> generation show <id>`. */
function showLines(agentDir, module, id) {
  const d = diffModuleGenerations(agentDir, module, id);
  if (!d) return null;
  const parts = [];
  if (d.added.length) parts.push(`+${d.added.length} added`);
  if (d.changed.length) parts.push(`~${d.changed.length} changed`);
  if (d.removed.length) parts.push(`-${d.removed.length} removed`);
  return [
    `${module} ${id}  ${d.mintedAt ?? '?'}`,
    `  forkedFrom: ${d.forkedFrom ?? '(none — first generation)'}`,
    `  mintedFrom: ${d.mintedFrom.length} proposal(s)`,
    `  changes vs parent: ${parts.length ? parts.join(' · ') : 'no change'}`,
  ].join('\n');
}

/** `zuzuu module <m> generations | generation show <id> | generation rollback <id>`. */
function moduleGenerationCmd(agentDir, module, rest, args, log) {
  const verb = rest[0];
  if (verb === 'generations') {
    const d = moduleGenerationsData(agentDir, module);
    if (args.json) { log(JSON.stringify(d)); return; }
    if (!d.generations.length) { log(`no ${module} generations yet — approve a ${module} proposal in \`zuzuu review\``); return; }
    for (const g of d.generations) {
      const mark = g.id === d.active ? '●' : ' ';
      log(`${mark} ${g.id}  ${g.mintedAt ?? '?'}  mintedFrom:${g.mintedFrom.length}`);
    }
    return;
  }
  // verb === 'generation'
  const op = rest[1];
  const id = rest[2];
  if (op === 'show') {
    if (!id) { console.error(`usage: zuzuu module ${module} generation show <id>`); process.exitCode = 1; return; }
    if (args.json) {
      const d = moduleGenerationShowData(agentDir, module, id);
      if (!d) { console.error(`no ${module} generation '${id}'`); process.exitCode = 1; return; }
      log(JSON.stringify(d)); return;
    }
    const out = showLines(agentDir, module, id);
    if (out == null) { console.error(`no ${module} generation '${id}'`); process.exitCode = 1; return; }
    log(out);
    return;
  }
  if (op === 'rollback') {
    if (!id) { console.error(`usage: zuzuu module ${module} generation rollback <id>`); process.exitCode = 1; return; }
    if (!readModuleGeneration(agentDir, module, id)) { console.error(`no ${module} generation '${id}'`); process.exitCode = 1; return; }
    const r = rollbackModule(agentDir, module, id);
    if (args.json) { log(JSON.stringify({ ok: r.ok, module, restored: r.restored, active: id })); return; }
    log(`✓ rolled back ${module} to ${id} — restored ${r.restored} item(s); active=${id}`);
    return;
  }
  if (op === 'mint') {
    // freeze this module's current items into its next generation (the ceremony
    // does this automatically on review; this is the explicit/web surface).
    const mintedFrom = args.from ? String(args.from).split(',').map((s) => s.trim()).filter(Boolean) : [];
    const lf = mintModuleGeneration(agentDir, module, { mintedFrom });
    if (args.json) { log(JSON.stringify({ id: lf.id, module, mintedFrom: lf.mintedFrom, forkedFrom: lf.forkedFrom })); return; }
    log(`✓ minted ${module} ${lf.id}${lf.forkedFrom ? ` (forkedFrom ${lf.forkedFrom})` : ''} — now active`);
    return;
  }
  console.error(`usage: zuzuu module ${module} generation [show <id>|rollback <id>|mint]`);
  process.exitCode = 1;
}

/** `zuzuu module <sub> [<f>]` — items | schema | manifest | overview;
 *  also `zuzuu module <m> generations | generation show|rollback <id>`. */
export function module(args = {}, log = console.log) {
  const [sub, f] = args._ ?? [];
  // per-module generations: `module <m> generations|generation …`
  if (MODULES.includes(sub) && (f === 'generations' || f === 'generation')) {
    return moduleGenerationCmd(paths().dir, sub, (args._ ?? []).slice(1), args, log);
  }
  if (!sub || !['items', 'schema', 'manifest', 'overview'].includes(sub)) {
    console.error('usage: zuzuu module items <module> [--json|--jsonl] · module schema <module> [--json] · module manifest <module> [--json] · module overview [--json] · module <module> generations · module <module> generation show|rollback <id>');
    process.exitCode = 1;
    return;
  }
  const agentDir = paths().dir;

  if (sub === 'overview') {
    const d = moduleOverviewData(agentDir);
    if (args.json) { log(JSON.stringify(d, null, 2)); return; }
    for (const fac of d.modules) {
      const pending = fac.counts.pending ? ` · ${fac.counts.pending} pending` : '';
      const flag = fac.declarative ? ' [declarative]' : '';
      log(`${fac.id.padEnd(13)} ${String(fac.counts.items).padStart(3)} item(s)${pending}${flag}${fac.manifestError ? `  ✗ ${fac.manifestError}` : ''}`);
    }
    return;
  }

  const entry = moduleOf(agentDir, f);
  if (!entry) {
    const known = modulesOf(agentDir).map((x) => x.id);
    console.error(`unknown module: ${f ?? '(none)'} — one of ${known.join(' · ')}`);
    process.exitCode = 1;
    return;
  }

  if (sub === 'manifest') {
    const d = moduleManifestData(agentDir, entry.id);
    log(JSON.stringify(args.json ? d : d.manifest, null, 2));
    return;
  }

  if (sub === 'schema') {
    const { schema } = moduleSchemaData(agentDir, entry.id);
    log(JSON.stringify(schema, null, 2));
    return;
  }

  const data = moduleItemsData(agentDir, entry.id, entry.manifest);
  if (args.jsonl) {
    for (const item of data.items) log(JSON.stringify(item));
    return;
  }
  if (args.json) {
    log(JSON.stringify(data, null, 2));
    return;
  }
  const kinds = MODULE_KINDS[entry.id] ?? (entry.declarative && entry.manifest?.kinds?.length ? entry.manifest.kinds : null);
  log(`${entry.id} — ${data.count} item(s)${kinds ? ` [${kinds.join('|')}]` : ''}`);
  for (const it of data.items) {
    log(`  ${it.id}  ${it.kind} · ${it.status ?? 'active'} — ${it.title}`);
  }
  for (const e of data.errors) log(`  ✗ ${e.file}: ${e.error}`);
  if (!data.count && !data.errors.length) log('  (none yet)');
}
