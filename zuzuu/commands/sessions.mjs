// zuzuu/commands/sessions.mjs — the sessions observability surface (overhaul
// Part A, 2026-06-13).
//
//   zuzuu sessions [--json]              recorded sessions w/ state labels
//   zuzuu session inspect <id> [--json]  one session: trace summary +
//                                        per-module mined signals
//
// inspect = { session, trace: {spans, tools, duration}, signals: {<module>:
// counts} } — the span count reads the stored OTLP blob; the signals re-mine
// the HOST transcript through the proven adapters' mineSignals and map the
// superset onto modules via each module's sessionSignals hook. Fail-soft
// throughout: a gone blob/transcript degrades to warnings, never a throw.

import { readFileSync } from 'node:fs';
import { readIndex, resolveTrace, paths } from '../core/store.mjs';
import { transcriptsFor, mineHostSession } from '../knowledge/distill.mjs';
import { modulesOf, invoke } from '../module/registry.mjs';

/** Pure: the sessions list with state labels — the web Sessions section source. */
export function sessionsListData(cwd = process.cwd()) {
  const { sessions } = readIndex(cwd);
  return {
    sessions: sessions.map((s) => ({
      id: s.id,
      host: s.host,
      state: s.status, // active | completed | abandoned | crashed | captured | opening
      startedAt: s.startedAt ?? null,
      endedAt: s.endedAt ?? null,
      durationMs: s.durationMs ?? 0,
      counts: s.counts ?? { turns: 0, tools: 0, errors: 0 },
      generation: s.generation ?? null,
      git: s.git ?? { commit: null, branch: null },
    })),
  };
}

/** Count spans across an OTLP/JSON NDJSON blob (one export request per line). */
function countTraceSpans(file) {
  let spans = 0;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const req = JSON.parse(line);
    for (const rs of req.resourceSpans ?? []) {
      for (const ss of rs.scopeSpans ?? []) spans += (ss.spans ?? []).length;
    }
  }
  return spans;
}

/**
 * Pure-ish: one session's observability document, or null for an unknown id.
 * Accepts a unique id prefix (the table shows 8-char ids).
 * @param {string} cwd
 * @param {string} idArg
 * @param {{transcripts?: Array<{host,ref,sessionId}>}} [opts]  injectable for hermetic tests
 * @returns {{session, trace:{spans,tools,duration}, signals:object, warnings:string[]} | null}
 */
export function sessionInspectData(cwd, idArg, { transcripts } = {}) {
  if (!idArg) return null;
  const { sessions } = readIndex(cwd);
  const matches = sessions.filter((s) => s.id === idArg);
  const byPrefix = matches.length ? matches : sessions.filter((s) => String(s.id).startsWith(idArg));
  if (!byPrefix.length) return null;
  const s = byPrefix[0];
  const warnings = [];

  // trace summary — span count from the stored OTLP blob (fail-soft)
  let spans = null;
  try {
    spans = countTraceSpans(resolveTrace(s.traceRef, cwd));
  } catch {
    warnings.push('trace blob unavailable — span count unknown');
  }
  const trace = { spans, tools: s.counts?.tools ?? 0, duration: s.durationMs ?? 0 };

  // per-module mined signals — re-mine the host transcript (fail-soft when gone)
  const signals = {};
  try {
    const pairs = transcripts ?? transcriptsFor({ scope: 'all', cwd });
    const pair = pairs.find((p) => p.host === s.host && String(p.sessionId) === String(s.id));
    const mined = pair ? mineHostSession(pair) : null;
    if (!mined) {
      warnings.push('host transcript unavailable — signals empty');
    } else {
      const agentDir = paths(cwd).dir;
      for (const entry of modulesOf(agentDir)) {
        const r = invoke(entry, 'sessionSignals', mined);
        if (r.ok && r.value && typeof r.value === 'object') signals[entry.id] = r.value;
      }
    }
  } catch {
    warnings.push('signal mining failed — signals empty');
  }

  return {
    session: {
      id: s.id,
      host: s.host,
      state: s.status,
      startedAt: s.startedAt ?? null,
      endedAt: s.endedAt ?? null,
      durationMs: s.durationMs ?? 0,
      counts: s.counts ?? { turns: 0, tools: 0, errors: 0 },
      generation: s.generation ?? null,
      git: s.git ?? { commit: null, branch: null },
      traceRef: s.traceRef ?? null,
    },
    trace,
    signals,
    warnings,
  };
}

const fmtDur = (ms) => (ms < 60_000 ? `${(ms / 1000).toFixed(0)}s` : `${(ms / 60_000).toFixed(1)}m`);

/** `zuzuu sessions [--json]` — the recorded-sessions list with state labels. */
export function sessions(args = {}) {
  const cwd = process.cwd();
  const d = sessionsListData(cwd);
  if (args.json) { console.log(JSON.stringify(d)); return; }
  if (!d.sessions.length) {
    console.log('no recorded sessions yet — run `zuzuu capture`, or just start your agent (live capture)');
    return;
  }
  console.log('  STATE      HOST          DUR     T/TOOLS/ERR  STARTED               SESSION');
  for (const s of d.sessions) {
    const dur = fmtDur(s.durationMs || 0).padStart(6);
    const cnt = `${s.counts.turns}/${s.counts.tools}/${s.counts.errors}`.padEnd(11);
    const started = (s.startedAt ?? '').slice(0, 19).padEnd(20);
    console.log(`  ${s.state.padEnd(10)} ${s.host.padEnd(13)} ${dur}  ${cnt}  ${started}  ${String(s.id).slice(0, 8)}`);
  }
  console.log(`\n${d.sessions.length} session(s) — inspect one: zuzuu session inspect <id>`);
}

/** `zuzuu session inspect <id> [--json]` — print one session's document. */
export function sessionInspect(args = {}) {
  const cwd = process.cwd();
  const id = args._?.[1];
  const d = sessionInspectData(cwd, id);
  if (!d) {
    console.error(id ? `no recorded session matching '${id}'` : 'usage: zuzuu session inspect <id> [--json]');
    process.exit(1);
  }
  if (args.json) { console.log(JSON.stringify(d)); return; }
  const s = d.session;
  console.log(`${s.id} — ${s.host} · ${s.state}`);
  console.log(`  started: ${s.startedAt ?? '?'}  ended: ${s.endedAt ?? '?'}  dur: ${fmtDur(s.durationMs || 0)}`);
  console.log(`  git: ${s.git?.commit ? s.git.commit.slice(0, 8) : '-'} (${s.git?.branch ?? '-'})  generation: ${s.generation ?? '-'}`);
  console.log(`  trace: ${d.trace.spans ?? '?'} span(s) · ${d.trace.tools} tool(s) · ${fmtDur(d.trace.duration || 0)}`);
  const sigs = Object.entries(d.signals);
  if (sigs.length) {
    console.log('  signals:');
    for (const [module, counts] of sigs) {
      const parts = Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · ');
      console.log(`    ${module.padEnd(13)} ${parts}`);
    }
  }
  for (const w of d.warnings) console.log(`  ⚠ ${w}`);
}
