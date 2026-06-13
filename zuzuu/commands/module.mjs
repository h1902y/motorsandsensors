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

/** `zuzuu module <sub> [<f>]` — items | schema | manifest | overview. */
export function module(args = {}, log = console.log) {
  const [sub, f] = args._ ?? [];
  if (!sub || !['items', 'schema', 'manifest', 'overview'].includes(sub)) {
    console.error('usage: zuzuu module items <module> [--json|--jsonl] · module schema <module> [--json] · module manifest <module> [--json] · module overview [--json]');
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
