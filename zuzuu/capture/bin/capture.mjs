#!/usr/bin/env node
// capture — read a host's session log, normalize it, write an OTLP/JSON trace.
//
//   node bin/capture.mjs [--host NAME] [--project STR] [--session ID] [--file PATH] [--out PATH]
//   node bin/capture.mjs --list                 # show detected hosts + sessions
//
// With no --host, picks the first detected host (transcript-present). Pure file
// parsing — no host needs to be running.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ADAPTERS, byName, detected } from '../adapters/registry.mjs';
import { eventsToSpans } from '../core/spans.mjs';
import { toExportRequest, writeNdjson } from '../core/otlp.mjs';
import { EventKind } from '../core/event.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT_DIR = join(HERE, '..', 'out');

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--list') a.list = true;
    else if (t === '-h' || t === '--help') a.help = true;
    else if (t.startsWith('--')) a[t.slice(2)] = argv[++i];
    else a._.push(t);
  }
  return a;
}

function printList() {
  const hosts = detected();
  if (!hosts.length) {
    console.log('No hosts detected on this machine.');
    return;
  }
  for (const adapter of hosts) {
    const sessions = adapter.listSessions({ cwd: process.cwd() });
    console.log(`\n● ${adapter.name} — ${sessions.length} session(s)`);
    for (const s of sessions.slice(0, 8)) {
      console.log(`    ${s.sessionId}  ${s.label ?? ''}`);
    }
    if (sessions.length > 8) console.log(`    … and ${sessions.length - 8} more`);
  }
  console.log();
}

function chooseRef(adapter, args) {
  if (args.file) return args.file; // explicit transcript path (claude-code)
  const sessions = adapter.listSessions({ cwd: process.cwd(), project: args.project });
  let pool = sessions;
  if (args.project) pool = pool.filter((s) => (s.label ?? '').includes(args.project));
  if (args.session) pool = pool.filter((s) => s.sessionId === args.session || s.sessionId.includes(args.session));
  if (!pool.length) throw new Error(`no matching session for ${adapter.name} (sessions found: ${sessions.length})`);
  return pool[0].ref;
}

function summarize(trace) {
  const counts = {};
  for (const e of trace.events) counts[e.kind] = (counts[e.kind] || 0) + 1;
  return counts;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('usage: capture.mjs [--host NAME] [--project STR] [--session ID] [--file PATH] [--out PATH] | --list');
    console.log('hosts:', ADAPTERS.map((a) => a.name).join(', '));
    return;
  }
  if (args.list) return printList();

  const adapter = args.host ? byName(args.host) : detected()[0];
  if (!adapter) {
    console.error(args.host ? `unknown host: ${args.host}` : 'no host detected (try --list)');
    process.exit(1);
  }

  const ref = chooseRef(adapter, args);
  const trace = adapter.parse(ref);
  const { traceId, spans } = eventsToSpans(trace);
  const request = toExportRequest({ traceId, spans }, { host: trace.host, sessionId: trace.sessionId });

  const outPath = args.out || join(DEFAULT_OUT_DIR, `${trace.host}-${trace.sessionId}.otlp.jsonl`);
  writeNdjson(outPath, [request]);

  const counts = summarize(trace);
  const root = trace.events.find((e) => e.kind === EventKind.SESSION) || trace.events[0];
  const durSec = root ? ((root.endMs - root.startMs) / 1000).toFixed(1) : '?';
  console.log(`captured ${trace.host} session ${trace.sessionId}`);
  console.log(`  trace_id : ${traceId}`);
  console.log(`  events   : ${spans.length}  (${Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(', ')})`);
  console.log(`  duration : ${durSec}s`);
  console.log(`  written  : ${outPath}`);
  console.log(`  inspect  : node ${join('zuzuu', 'capture', 'bin', 'inspect-trace.mjs')} "${outPath}"`);
}

main();
