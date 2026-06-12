// zuzuu/commands/faculty.mjs — `zuzuu faculty` (W24 Faculty Standard + the
// 2026-06-13 Faculty Module contract).
//
// The read surface over the one envelope format + the module contract:
//   zuzuu faculty items <f> [--json|--jsonl]   list a faculty's envelope items
//   zuzuu faculty schema <f> [--json]          print its payload schema
//   zuzuu faculty manifest <f> [--json]        print its faculty.json manifest
//   zuzuu faculty overview [--json]            ALL faculties in ONE process:
//                                              manifest.ui + counts + top-3 item
//                                              titles + pending counts (the
//                                              daemon's batching endpoint)
//
// `--json` = one document; `--jsonl` = one item per line (streaming consumers).
// Declarative faculties (manifest-only folders) are first-class here: items
// list from manifest.itemsDir, schemas serve from the home, the overview and
// digest include them. Fail-soft like everything on the serve path.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from '../core/store.mjs';
import { listFacultyItems } from '../faculty/items.mjs';
import { listProposals } from '../faculty/proposal.mjs';
import { PAYLOAD_SCHEMAS, FACULTY_KINDS } from '../faculty/envelope.mjs';
import { facultiesOf, facultyOf, get as getAdapter } from '../faculty/registry.mjs';

/** Pure: one faculty's envelope items + parse errors (the --json document). */
export function facultyItemsData(agentDir, faculty, manifest = null) {
  const m = manifest ?? facultyOf(agentDir, faculty)?.manifest;
  const { items, errors } = listFacultyItems(agentDir, faculty, { itemsDir: m?.itemsDir });
  return { faculty, count: items.length, items, errors };
}

/**
 * Pure: the payload schema served for a faculty — the home's seeded
 * `<faculty>/schema.json` when present and parseable (humans may extend it),
 * else the built-in default. Never throws.
 */
export function facultySchemaData(agentDir, faculty) {
  const seeded = join(agentDir, faculty, 'schema.json');
  if (existsSync(seeded)) {
    try { return { faculty, source: 'home', schema: JSON.parse(readFileSync(seeded, 'utf8')) }; }
    catch { /* fall through to the built-in */ }
  }
  return { faculty, source: 'builtin', schema: PAYLOAD_SCHEMAS[faculty] ?? null };
}

/**
 * Pure: one faculty's manifest document (home faculty.json when present,
 * built-in fallback), or null for an unknown faculty.
 */
export function facultyManifestData(agentDir, faculty) {
  const entry = facultyOf(agentDir, faculty);
  if (!entry) return null;
  return {
    faculty: entry.id,
    source: entry.manifestSource,
    declarative: entry.declarative,
    ...(entry.manifestError ? { error: entry.manifestError } : {}),
    manifest: entry.manifest,
  };
}

/** Pending-proposal count for one faculty (dir-shaped adapters override). */
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
 * Pure: the overview document — EVERY faculty (built-in + declarative) with
 * manifest/ui, item + pending counts and the top-3 item titles, computed in
 * ONE process (the web daemon's batching endpoint — kills 5-spawn cycles).
 * Fail-soft per faculty: a broken one reports zeros + its manifestError.
 */
export function facultyOverviewData(agentDir) {
  const faculties = facultiesOf(agentDir).map((entry) => {
    let items = [], errors = [];
    try {
      ({ items, errors } = listFacultyItems(agentDir, entry.id, { itemsDir: entry.manifest?.itemsDir }));
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
  return { faculties };
}

/** `zuzuu faculty <sub> [<f>]` — items | schema | manifest | overview. */
export function faculty(args = {}, log = console.log) {
  const [sub, f] = args._ ?? [];
  if (!sub || !['items', 'schema', 'manifest', 'overview'].includes(sub)) {
    console.error('usage: zuzuu faculty items <faculty> [--json|--jsonl] · faculty schema <faculty> [--json] · faculty manifest <faculty> [--json] · faculty overview [--json]');
    process.exitCode = 1;
    return;
  }
  const agentDir = paths().dir;

  if (sub === 'overview') {
    const d = facultyOverviewData(agentDir);
    if (args.json) { log(JSON.stringify(d, null, 2)); return; }
    for (const fac of d.faculties) {
      const pending = fac.counts.pending ? ` · ${fac.counts.pending} pending` : '';
      const flag = fac.declarative ? ' [declarative]' : '';
      log(`${fac.id.padEnd(13)} ${String(fac.counts.items).padStart(3)} item(s)${pending}${flag}${fac.manifestError ? `  ✗ ${fac.manifestError}` : ''}`);
    }
    return;
  }

  const entry = facultyOf(agentDir, f);
  if (!entry) {
    const known = facultiesOf(agentDir).map((x) => x.id);
    console.error(`unknown faculty: ${f ?? '(none)'} — one of ${known.join(' · ')}`);
    process.exitCode = 1;
    return;
  }

  if (sub === 'manifest') {
    const d = facultyManifestData(agentDir, entry.id);
    log(JSON.stringify(args.json ? d : d.manifest, null, 2));
    return;
  }

  if (sub === 'schema') {
    const { schema } = facultySchemaData(agentDir, entry.id);
    log(JSON.stringify(schema, null, 2));
    return;
  }

  const data = facultyItemsData(agentDir, entry.id, entry.manifest);
  if (args.jsonl) {
    for (const item of data.items) log(JSON.stringify(item));
    return;
  }
  if (args.json) {
    log(JSON.stringify(data, null, 2));
    return;
  }
  const kinds = FACULTY_KINDS[entry.id] ?? (entry.declarative && entry.manifest?.kinds?.length ? entry.manifest.kinds : null);
  log(`${entry.id} — ${data.count} item(s)${kinds ? ` [${kinds.join('|')}]` : ''}`);
  for (const it of data.items) {
    log(`  ${it.id}  ${it.kind} · ${it.status ?? 'active'} — ${it.title}`);
  }
  for (const e of data.errors) log(`  ✗ ${e.file}: ${e.error}`);
  if (!data.count && !data.errors.length) log('  (none yet)');
}
