// `zuzuu review` — the human gate, as a daily ritual (the interactive ceremony).
// Walks pending proposals one-by-one: shows the candidate, its evidence, and
// the ER verdict (with the matched item when enrich/duplicate) → y approve ·
// n reject · e edit · s skip · q quit. Works piped (answers on stdin) — that's
// also how it's tested. The non-interactive surface lives in proposals.mjs.

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { paths } from '../core/store.mjs';
import { processInbox } from '../knowledge/inbox.mjs';
import { getProposal, proposalsDir } from '../knowledge/proposals.mjs';
import * as gate from '../module/gate.mjs';
import { pendingByModule, buildSessionMtimes } from '../module/pending.mjs';
import { knowledgeCard } from '../module/render.mjs';
import { mintModuleGeneration } from '../module/generation/write.mjs';
import { getScorer } from '../eval/score.mjs';
import { evalLine } from './eval.mjs';

/**
 * Pure: mint a per-module generation for each module with ≥1 approved proposal.
 * The old single global mint is gone — generations are per-module atoms now.
 * @param {string} agentDir
 * @param {Object<string,string[]>} approvedByModule  module → approved proposal ids
 * @returns {Array<{module:string, generation:string, count:number}>}  one per minted module
 */
export function mintApprovedModules(agentDir, approvedByModule) {
  const minted = [];
  for (const [module, ids] of Object.entries(approvedByModule)) {
    if (!ids.length) continue;
    const lf = mintModuleGeneration(agentDir, module, { mintedFrom: ids });
    minted.push({ module, generation: lf.id, count: ids.length });
  }
  return minted;
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Pure: the graduation ceremony block shown after per-module generations mint.
 * "Knowledge → gen_006 (2) · Guardrails → gen_003 (1)".
 * @param {Array<{module:string, generation:string, count:number}>} minted
 * @returns {string}
 */
export function ceremonyBlock(minted) {
  if (!minted.length) return '';
  const line = minted.map((m) => `${cap(m.module)} → ${m.generation} (${m.count})`).join(' · ');
  const first = minted[0];
  return [
    `\n✓ minted: ${line}`,
    `  inspect: zuzuu module ${first.module} generation show ${first.generation}   ·   checkpoint: zuzuu checkpoint mint`,
  ].join('\n');
}

export async function review() {
  const agentDir = paths().dir;
  const inbox = processInbox(agentDir);
  if (inbox.processed) console.log(`(processed ${inbox.processed} inbox candidate(s) → proposals)`);
  const groups = pendingByModule(agentDir);
  if (!groups.length) {
    console.log('nothing to review — knowledge and actions are current');
    return;
  }
  // Line-queue instead of rl.question: with piped stdin, lines that arrive
  // between questions would otherwise be dropped (the readline-pipe race —
  // caught by the first smoke test). EOF answers 'q' (graceful quit).
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const queued = [];
  let waiter = null;
  let closed = false;
  rl.on('line', (l) => {
    if (waiter) {
      const w = waiter;
      waiter = null;
      w(l);
    } else queued.push(l);
  });
  rl.on('close', () => {
    closed = true;
    if (waiter) {
      const w = waiter;
      waiter = null;
      w('q');
    }
  });
  const ask = async (q) => {
    process.stdout.write(q);
    if (queued.length) return queued.shift();
    if (closed) return 'q';
    return new Promise((res) => {
      waiter = res;
    });
  };

  const approvedIds = [];
  const approvedByModule = {}; // module → approved proposal ids (per-module mint)
  let approved = 0, rejected = 0, skipped = 0;
  let totalLeft = groups.reduce((n, g) => n + g.proposals.length, 0);
  const sessionMtimes = buildSessionMtimes();
  const now = Date.now();
  const scorer = getScorer();
  // One loop over modules with pending proposals (adapter-driven, WS2-T3).
  for (const { adapter, proposals } of groups) {
    const isActions = adapter.name === 'actions';
    for (let i = 0; i < proposals.length; i++) {
      const p = proposals[i];
      // Compute scoreResult for this proposal (fail-open).
      let scoreResult = null;
      try { scoreResult = scorer(p, { now, sessionMtimes }); } catch { /* fail-open */ }
      // Card: knowledge keeps its rich card (ER + existing-item lookup); other
      // modules render through the adapter contract.
      if (adapter.name === 'knowledge') console.log(knowledgeCard(agentDir, p, i, proposals.length, scoreResult));
      else {
        const r = adapter.render(p);
        const [head, ...rest] = r.card.split('\n');
        console.log(`\n━━ ${adapter.name} ${i + 1}/${proposals.length} ── ${head} ━━`);
        if (rest.length) console.log(rest.join('\n'));
        if (scoreResult) console.log(`  ${evalLine(scoreResult)}`);
      }
      const prompt = isActions
        ? '  [y]activate [n]reject [s]kip [q]uit > '
        : '  [y]approve [n]reject [e]dit [s]kip [q]uit > ';
      let acted = false;
      while (!acted) {
        const a = (await ask(prompt)).trim().toLowerCase();
        if (a === 'y') {
          const r = gate.approve(agentDir, adapter.name, p.id);
          if (isActions) console.log(r.ok ? '  ✓ activated' : `  ✗ ${(r.errors ?? [r.action]).join('; ')}`);
          else { console.log(r.ok ? `  ✓ ${r.action}` : `  ✗ ${(r.errors ?? [r.action]).join('; ')}`); for (const w of r.warnings ?? []) console.log(`  ⚠ ${w}`); }
          if (r.ok) { approvedIds.push(p.id); (approvedByModule[adapter.name] ??= []).push(p.id); }
          approved++; totalLeft--; acted = true;
        } else if (a === 'n') {
          const reason = isActions ? '' : (await ask('  reason (optional) > ')).trim();
          gate.reject(agentDir, adapter.name, p.id, reason);
          console.log('  ✗ rejected');
          rejected++; totalLeft--; acted = true;
        } else if (a === 'e' && !isActions) {
          const editor = process.env.EDITOR || 'vi';
          spawnSync(editor, [join(proposalsDir(agentDir), `${p.id}.json`)], { stdio: 'inherit' });
          const fresh = getProposal(agentDir, p.id);
          if (fresh) {
            proposals[i] = fresh;
            let freshScore = null;
            try { freshScore = scorer(fresh, { now, sessionMtimes }); } catch { /* fail-open */ }
            console.log(knowledgeCard(agentDir, fresh, i, proposals.length, freshScore));
          }
        } else if (a === 's') {
          skipped++; totalLeft--; acted = true;
        } else if (a === 'q' || a === '') {
          rl.close();
          console.log(`\nreview: ${approved} approved · ${rejected} rejected · ${skipped} skipped · ${totalLeft} left`);
          if (approvedIds.length > 0) {
            console.log(ceremonyBlock(mintApprovedModules(agentDir, approvedByModule)));
          }
          return;
        }
      }
    }
  }
  rl.close();
  console.log(`\nreview complete: ${approved} approved · ${rejected} rejected · ${skipped} skipped`);
  if (approvedIds.length > 0) {
    console.log(ceremonyBlock(mintApprovedModules(agentDir, approvedByModule)));
  }
}
