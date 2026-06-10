// `mns review` — the human gate, as a daily ritual. Walks pending proposals
// one-by-one: shows the candidate, its evidence, and the ER verdict (with the
// matched item when enrich/duplicate) → y approve · n reject · e edit · s skip ·
// q quit. Works piped (answers on stdin) — that's also how it's tested.
// Non-interactive surface: `mns proposals list|show|approve|reject`.

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { paths } from '../store.mjs';
import { processInbox } from '../knowledge/inbox.mjs';
import { listProposals, getProposal, approveProposal, rejectProposal, proposalsDir } from '../knowledge/proposals.mjs';
import { readItem } from '../knowledge/items.mjs';

function card(mnsDir, p, i, total) {
  const lines = [];
  lines.push(`\n━━ proposal ${i + 1}/${total} ── ${p.id} ── ${p.kind} ── source: ${p.source ?? '-'} ━━`);
  if (p.kind === 'registry') {
    lines.push(`  register ${p.registry.slice(0, -1)}: '${p.key}'  (seen ${p.evidence?.occurrences}× in candidates)`);
  } else {
    const c = p.candidate;
    lines.push(`  ${c.type}: ${c.body?.slice(0, 100).replace(/\n/g, ' ')}`);
    for (const [k, v] of Object.entries(c.attributes ?? {})) lines.push(`    · ${k} = ${v}`);
    for (const r of c.relations ?? []) lines.push(`    → ${r.type} ${r.target}`);
    const ev = p.evidence ?? {};
    if (Object.keys(ev).length) lines.push(`  evidence: ${Object.entries(ev).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join('  ')}`);
    const er = p.er ?? {};
    lines.push(`  er: ${er.verdict}${er.match ? ` → ${er.match}` : ''}  (${(er.confidence ?? 0).toFixed(2)} · ${er.reason ?? ''})`);
    if (er.match) {
      const m = readItem(mnsDir, er.match);
      if (m) lines.push(`  existing: ${m.body.slice(0, 80).replace(/\n/g, ' ')}`);
    }
  }
  return lines.join('\n');
}

export async function review() {
  const mnsDir = paths().dir;
  const inbox = processInbox(mnsDir);
  if (inbox.processed) console.log(`(processed ${inbox.processed} inbox candidate(s) → proposals)`);
  const pending = listProposals(mnsDir);
  if (!pending.length) {
    console.log('no pending proposals — inbox empty, knowledge is current');
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
  let approved = 0, rejected = 0, skipped = 0;
  for (let i = 0; i < pending.length; i++) {
    const p = pending[i];
    console.log(card(mnsDir, p, i, pending.length));
    let acted = false;
    while (!acted) {
      const a = (await ask('  [y]approve [n]reject [e]dit [s]kip [q]uit > ')).trim().toLowerCase();
      if (a === 'y') {
        const r = approveProposal(mnsDir, p.id);
        console.log(r.ok ? `  ✓ ${r.action}` : `  ✗ ${r.action}`);
        for (const w of r.warnings) console.log(`  ⚠ ${w}`);
        approved++;
        acted = true;
      } else if (a === 'n') {
        const reason = (await ask('  reason (optional) > ')).trim();
        rejectProposal(mnsDir, p.id, reason);
        console.log('  ✗ rejected');
        rejected++;
        acted = true;
      } else if (a === 'e') {
        const editor = process.env.EDITOR || 'vi';
        spawnSync(editor, [join(proposalsDir(mnsDir), `${p.id}.json`)], { stdio: 'inherit' });
        const fresh = getProposal(mnsDir, p.id);
        if (fresh) {
          pending[i] = fresh;
          console.log(card(mnsDir, fresh, i, pending.length));
        }
      } else if (a === 's') {
        skipped++;
        acted = true;
      } else if (a === 'q' || a === '') {
        rl.close();
        console.log(`\nreview: ${approved} approved · ${rejected} rejected · ${skipped} skipped · ${pending.length - i - 1} left`);
        return;
      }
    }
  }
  rl.close();
  console.log(`\nreview complete: ${approved} approved · ${rejected} rejected · ${skipped} skipped`);
}

/** Non-interactive: mns proposals list|show <id>|approve <id>|reject <id> [--reason r] */
export function proposals(args) {
  const mnsDir = paths().dir;
  const sub = args._[0] || 'list';
  if (sub === 'list') {
    const inbox = processInbox(mnsDir);
    if (inbox.processed) console.log(`(processed ${inbox.processed} inbox candidate(s))`);
    const pending = listProposals(mnsDir);
    if (!pending.length) return console.log('no pending proposals');
    for (const p of pending) {
      const what = p.kind === 'registry' ? `register ${p.registry.slice(0, -1)} '${p.key}'` : `${p.candidate.type}: ${p.candidate.body?.slice(0, 60).replace(/\n/g, ' ')}`;
      console.log(`  ${p.id}  [${p.er?.verdict ?? p.kind}]  ${what}`);
    }
    return;
  }
  const id = args._[1];
  if (sub === 'show') {
    const p = getProposal(mnsDir, id);
    if (!p) return console.error('not found');
    console.log(JSON.stringify(p, null, 2));
    return;
  }
  if (sub === 'approve') {
    const r = approveProposal(mnsDir, id);
    console.log(r.ok ? `✓ ${r.action}` : `✗ ${r.action}`);
    for (const w of r.warnings) console.log(`⚠ ${w}`);
    process.exit(r.ok ? 0 : 1);
  }
  if (sub === 'reject') {
    const r = rejectProposal(mnsDir, id, args.reason || '');
    console.log(r.ok ? '✓ rejected' : '✗ not found');
    process.exit(r.ok ? 0 : 1);
  }
  console.error('usage: mns proposals list|show <id>|approve <id>|reject <id> [--reason r]');
  process.exit(1);
}
