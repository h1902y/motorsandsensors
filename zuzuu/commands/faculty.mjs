// zuzuu/commands/faculty.mjs — `zuzuu faculty` (W24, the Faculty Standard).
//
// The read surface over the one envelope format:
//   zuzuu faculty items <f> [--json|--jsonl]   list a faculty's envelope items
//   zuzuu faculty schema <f> [--json]          print its payload schema
//
// `--json` = one document; `--jsonl` = one item per line (streaming consumers).
// Fail-soft like everything on the serve path: unparseable items are listed as
// errors next to the good ones, never thrown.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from '../core/store.mjs';
import { FACULTIES } from '../faculty/contract.mjs';
import { listFacultyItems } from '../faculty/items.mjs';
import { PAYLOAD_SCHEMAS, FACULTY_KINDS } from '../faculty/envelope.mjs';

/** Pure: one faculty's envelope items + parse errors (the --json document). */
export function facultyItemsData(agentDir, faculty) {
  const { items, errors } = listFacultyItems(agentDir, faculty);
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
  return { faculty, source: 'builtin', schema: PAYLOAD_SCHEMAS[faculty] };
}

/** `zuzuu faculty <sub> <f>` — items | schema. */
export function faculty(args = {}, log = console.log) {
  const [sub, f] = args._ ?? [];
  if (!sub || !['items', 'schema'].includes(sub)) {
    console.error('usage: zuzuu faculty items <faculty> [--json|--jsonl] · faculty schema <faculty> [--json]');
    process.exitCode = 1;
    return;
  }
  if (!FACULTIES.includes(f)) {
    console.error(`unknown faculty: ${f ?? '(none)'} — one of ${FACULTIES.join(' · ')}`);
    process.exitCode = 1;
    return;
  }
  const agentDir = paths().dir;

  if (sub === 'schema') {
    const { schema } = facultySchemaData(agentDir, f);
    log(JSON.stringify(schema, null, 2));
    return;
  }

  const data = facultyItemsData(agentDir, f);
  if (args.jsonl) {
    for (const item of data.items) log(JSON.stringify(item));
    return;
  }
  if (args.json) {
    log(JSON.stringify(data, null, 2));
    return;
  }
  const kinds = FACULTY_KINDS[f];
  log(`${f} — ${data.count} item(s)${kinds ? ` [${kinds.join('|')}]` : ''}`);
  for (const it of data.items) {
    log(`  ${it.id}  ${it.kind} · ${it.status ?? 'active'} — ${it.title}`);
  }
  for (const e of data.errors) log(`  ✗ ${e.file}: ${e.error}`);
  if (!data.count && !data.errors.length) log('  (none yet)');
}
