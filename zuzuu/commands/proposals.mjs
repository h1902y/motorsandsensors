// `zuzuu proposals` — the human gate, non-interactive: list|show|approve|reject.
// The same adapter-driven path `zuzuu review` walks, minus the ceremony. Pure
// data fns (proposalsListData/approveData/rejectData) feed the --json surface
// and the web workbench.

import { paths } from '../core/store.mjs';
import { processInbox } from '../knowledge/inbox.mjs';
import { getProposal } from '../knowledge/proposals.mjs';
import * as registry from '../module/registry.mjs';
import * as gate from '../module/gate.mjs';
import { pendingByModule } from '../module/pending.mjs';
import { knowledgeLine, proposalTitle } from '../module/render.mjs';

/**
 * Resolve which module owns a given proposal id (used when --module is omitted).
 * Defaults to 'knowledge' (the historical path) when no other module claims it.
 */
function moduleOf(agentDir, id, only) {
  if (only) return only;
  for (const { adapter, proposals } of pendingByModule(agentDir)) {
    if (proposals.some((p) => p.id === id)) return adapter.name;
  }
  return 'knowledge';
}

/**
 * Pure: the structured object for `proposals approve --json`.
 * Calls gate.approve and returns the result object the branch prints.
 * @param {string} agentDir
 * @param {string} id
 * @param {string} module
 * @returns {object}  the gate result (contains ok, action, etc.)
 */
export function approveData(agentDir, id, module) {
  return gate.approve(agentDir, module, id);
}

/**
 * Pure: the structured object for `proposals reject --json`.
 * Calls gate.reject and returns the result object the branch prints.
 * @param {string} agentDir
 * @param {string} id
 * @param {string} module
 * @param {string} [reason]
 * @returns {object}  { ok, id, ... }
 */
export function rejectData(agentDir, id, module, reason = '') {
  const r = gate.reject(agentDir, module, id, reason);
  return { ...r, id };
}

/**
 * Pure: list pending proposals as structured data — the zuzuu-web /proposals source.
 * @param {string} agentDir
 * @param {string} [only]  optional module filter
 * @returns {{ pending: Array<{id, module, title}> }}
 */
export function proposalsListData(agentDir, only) {
  const groups = pendingByModule(agentDir).filter((g) => !only || g.adapter.name === only);
  const pending = [];
  for (const { adapter, proposals } of groups) {
    for (const p of proposals) {
      pending.push({ id: p.id, module: adapter.name, title: proposalTitle(adapter, p) });
    }
  }
  return { pending };
}

/** Non-interactive: zuzuu proposals list|show <id>|approve <id>|reject <id> [--reason r] [--module f] */
export function proposals(args) {
  const agentDir = paths().dir;
  const sub = args._[0] || 'list';
  const only = args.module; // optional filter; default = all
  if (sub === 'list') {
    if (args.json) {
      processInbox(agentDir);  // promote plain-text inbox candidates, same as text path
      const d = proposalsListData(agentDir, only);
      console.log(JSON.stringify(d));
      return;
    }
    const inbox = processInbox(agentDir);
    if (inbox.processed) console.log(`(processed ${inbox.processed} inbox candidate(s))`);
    const groups = pendingByModule(agentDir).filter((g) => !only || g.adapter.name === only);
    const any = groups.some((g) => g.proposals.length);
    if (!any) return console.log('no pending proposals');
    for (const { adapter, proposals } of groups) {
      for (const p of proposals) {
        // knowledge keeps its historical one-liner; other modules use adapter.render
        if (adapter.name === 'knowledge') {
          console.log(knowledgeLine(p));
        } else {
          console.log(`  ${adapter.render(p).line}`);
        }
      }
    }
    return;
  }
  const id = args._[1];
  if (sub === 'show') {
    const module = moduleOf(agentDir, id, only);
    const a = registry.get(module);
    const p = (a && typeof a.getProposal === 'function') ? a.getProposal(agentDir, id) : getProposal(agentDir, id);
    if (!p) return console.error('not found');
    // show always prints JSON (both with and without --json flag)
    console.log(JSON.stringify(p, null, 2));
    return;
  }
  if (sub === 'approve') {
    const module = moduleOf(agentDir, id, only);
    const r = approveData(agentDir, id, module);
    if (args.json) {
      console.log(JSON.stringify(r));
    } else {
      console.log(r.ok ? `✓ ${r.action}` : `✗ ${(r.errors ?? [r.action]).join('; ')}`);
      for (const w of r.warnings ?? []) console.log(`⚠ ${w}`);
    }
    process.exit(r.ok ? 0 : 1);
  }
  if (sub === 'reject') {
    const module = moduleOf(agentDir, id, only);
    const r = rejectData(agentDir, id, module, args.reason || '');
    if (args.json) {
      console.log(JSON.stringify(r));
    } else {
      console.log(r.ok ? '✓ rejected' : '✗ not found');
    }
    process.exit(r.ok ? 0 : 1);
  }
  console.error('usage: zuzuu proposals list|show <id>|approve <id>|reject <id> [--reason r] [--module f]');
  process.exit(1);
}
