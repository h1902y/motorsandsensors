// zuzuu/commands/inbox.mjs — `zuzuu inbox` (WS-C).
//
// One glance at what is pending YOUR approval, per faculty. Counts pending
// proposals across all five faculties, shows a one-line title for each, and
// points at `zuzuu review`. Fail-soft per faculty — a broken adapter or unreadable
// proposal never sinks the whole view.

import { paths } from '../core/store.mjs';
import { FACULTIES } from '../faculty/contract.mjs';
import { listProposals } from '../faculty/proposal.mjs';
import * as registry from '../faculty/registry.mjs';
import '../knowledge/adapter.mjs';    // self-registers the 'knowledge' adapter
import '../actions/adapter.mjs';      // self-registers the 'actions' adapter
import '../guardrails/adapter.mjs';   // self-registers the 'guardrails' adapter
import '../instructions/adapter.mjs'; // self-registers the 'instructions' adapter
import '../memory/adapter.mjs';       // self-registers the 'memory' adapter

/** Best-effort one-line title for a proposal (adapter.render → payload → id). */
function titleOf(faculty, p) {
  try {
    const a = registry.get(faculty);
    if (a && typeof a.render === 'function') {
      const line = a.render(p).line;
      if (line) return line.trim();
    }
  } catch { /* fail-soft */ }
  const body = p.payload?.body ?? p.candidate?.body ?? p.payload?.id ?? p.id;
  return String(body).split('\n')[0].slice(0, 60);
}

/** Pure: flat list of pending proposals across faculties (id, faculty, title) — the zuzuu-web /inbox source. */
export function inboxData(agentDir) {
  const pending = [];
  for (const faculty of FACULTIES) {
    let proposals = [];
    try { proposals = listProposals(agentDir, faculty); } catch { proposals = []; }
    for (const p of proposals) pending.push({ id: p.id, faculty, title: titleOf(faculty, p) });
  }
  return { pending, total: pending.length };
}

/**
 * Pure-ish: gather pending counts per faculty for a home.
 * @returns {{ rows: Array<{faculty, count, first}>, total: number }}
 */
export function inboxRows(agentDir) {
  const rows = [];
  let total = 0;
  for (const faculty of FACULTIES) {
    let proposals = [];
    try { proposals = listProposals(agentDir, faculty); } catch { proposals = []; }
    if (!proposals.length) continue;
    total += proposals.length;
    rows.push({ faculty, count: proposals.length, first: titleOf(faculty, proposals[0]) });
  }
  return { rows, total };
}

/** `zuzuu inbox` — print what is pending review. */
export function inbox(args = {}, log = console.log) {
  const agentDir = args.agentDir || paths().dir;
  if (args.json) { log(JSON.stringify(inboxData(agentDir))); return; }
  const { rows, total } = inboxRows(agentDir);
  if (!total) {
    log("inbox: nothing pending — you're all caught up.");
    return;
  }
  log(`inbox — ${total} pending your approval:`);
  for (const { faculty, count, first } of rows) {
    log(`  ${faculty}: ${count} pending — ${first}`);
  }
  log('→ run `zuzuu review` to approve/reject (each approval mints a generation checkpoint).');
}
