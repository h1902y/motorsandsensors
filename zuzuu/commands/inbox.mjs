// zuzuu/commands/inbox.mjs — `zuzuu inbox` (WS-C).
//
// One glance at what is pending YOUR approval, per module. Counts pending
// proposals across all five modules, shows a one-line title for each, and
// points at `zuzuu review`. Fail-soft per module — a broken adapter or unreadable
// proposal never sinks the whole view.

import { paths } from '../core/store.mjs';
import { MODULES } from '../module/contract.mjs';
import { listProposals } from '../module/proposal.mjs';
import * as registry from '../module/registry.mjs';

/** Best-effort one-line title for a proposal (adapter.render → payload → id). */
function titleOf(module, p) {
  try {
    const a = registry.get(module);
    if (a && typeof a.render === 'function') {
      const line = a.render(p).line;
      if (line) return line.trim();
    }
  } catch { /* fail-soft */ }
  const body = p.payload?.body ?? p.candidate?.body ?? p.payload?.id ?? p.id;
  return String(body).split('\n')[0].slice(0, 60);
}

/** Pure: flat list of pending proposals across modules (id, module, title) — the zuzuu-web /inbox source. */
export function inboxData(agentDir) {
  const pending = [];
  for (const module of MODULES) {
    let proposals = [];
    try { proposals = listProposals(agentDir, module); } catch { proposals = []; }
    for (const p of proposals) pending.push({ id: p.id, module, title: titleOf(module, p) });
  }
  return { pending, total: pending.length };
}

/**
 * Pure-ish: gather pending counts per module for a home.
 * @returns {{ rows: Array<{module, count, first}>, total: number }}
 */
export function inboxRows(agentDir) {
  const rows = [];
  let total = 0;
  for (const module of MODULES) {
    let proposals = [];
    try { proposals = listProposals(agentDir, module); } catch { proposals = []; }
    if (!proposals.length) continue;
    total += proposals.length;
    rows.push({ module, count: proposals.length, first: titleOf(module, proposals[0]) });
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
  for (const { module, count, first } of rows) {
    log(`  ${module}: ${count} pending — ${first}`);
  }
  log('→ run `zuzuu review` to approve/reject (each approval mints a generation checkpoint).');
}
