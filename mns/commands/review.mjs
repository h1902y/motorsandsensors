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
import { getProposal, proposalsDir } from '../knowledge/proposals.mjs';
import { readItem } from '../knowledge/items.mjs';
import * as registry from '../faculty/registry.mjs';
import * as gate from '../faculty/gate.mjs';
import { listProposals as spineListProposals } from '../faculty/proposal.mjs';
import '../knowledge/adapter.mjs';    // self-registers the 'knowledge' adapter
import '../actions/adapter.mjs';      // self-registers the 'actions' adapter
import '../guardrails/adapter.mjs';   // self-registers the 'guardrails' adapter
import '../instructions/adapter.mjs'; // self-registers the 'instructions' adapter
import '../memory/adapter.mjs';       // self-registers the 'memory' adapter

// Review walks faculties in a fixed order so piped sessions are deterministic
// (the combo smoke test feeds one stdin across the actions pass then knowledge).
const REVIEW_ORDER = ['actions', 'knowledge', 'guardrails', 'instructions', 'memory'];

/** Ordered list of adapters that have pending proposals to review. */
function pendingByFaculty(mnsDir) {
  const adapters = registry.all();
  const seen = new Set();
  const ordered = [];
  for (const name of REVIEW_ORDER) {
    const a = adapters.find((x) => x.name === name);
    if (a) { ordered.push(a); seen.add(name); }
  }
  for (const a of adapters) if (!seen.has(a.name)) ordered.push(a);
  const out = [];
  for (const a of ordered) {
    const proposals = facultyPending(mnsDir, a);
    if (proposals.length) out.push({ adapter: a, proposals });
  }
  return out;
}

/** Pending proposals for one adapter (dir-shaped adapters override listProposals). */
function facultyPending(mnsDir, a) {
  if (typeof a.listProposals === 'function') return a.listProposals(mnsDir);
  // JSON-record faculties: read via the spine (records carry both the spine shape
  // and the legacy candidate/er keys the knowledge card renders from).
  return spineListProposals(mnsDir, a.name);
}

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
  const groups = pendingByFaculty(mnsDir);
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

  let approved = 0, rejected = 0, skipped = 0;
  let totalLeft = groups.reduce((n, g) => n + g.proposals.length, 0);
  // One loop over faculties with pending proposals (adapter-driven, WS2-T3).
  for (const { adapter, proposals } of groups) {
    const isActions = adapter.name === 'actions';
    for (let i = 0; i < proposals.length; i++) {
      const p = proposals[i];
      // Card: knowledge keeps its rich card (ER + existing-item lookup); other
      // faculties render through the adapter contract.
      if (adapter.name === 'knowledge') console.log(card(mnsDir, p, i, proposals.length));
      else {
        const r = adapter.render(p);
        const [head, ...rest] = r.card.split('\n');
        console.log(`\n━━ ${adapter.name} ${i + 1}/${proposals.length} ── ${head} ━━`);
        if (rest.length) console.log(rest.join('\n'));
      }
      const prompt = isActions
        ? '  [y]activate [n]reject [s]kip [q]uit > '
        : '  [y]approve [n]reject [e]dit [s]kip [q]uit > ';
      let acted = false;
      while (!acted) {
        const a = (await ask(prompt)).trim().toLowerCase();
        if (a === 'y') {
          const r = gate.approve(mnsDir, adapter.name, p.id);
          if (isActions) console.log(r.ok ? '  ✓ activated' : `  ✗ ${(r.errors ?? [r.action]).join('; ')}`);
          else { console.log(r.ok ? `  ✓ ${r.action}` : `  ✗ ${(r.errors ?? [r.action]).join('; ')}`); for (const w of r.warnings ?? []) console.log(`  ⚠ ${w}`); }
          approved++; totalLeft--; acted = true;
        } else if (a === 'n') {
          const reason = isActions ? '' : (await ask('  reason (optional) > ')).trim();
          gate.reject(mnsDir, adapter.name, p.id, reason);
          console.log('  ✗ rejected');
          rejected++; totalLeft--; acted = true;
        } else if (a === 'e' && !isActions) {
          const editor = process.env.EDITOR || 'vi';
          spawnSync(editor, [join(proposalsDir(mnsDir), `${p.id}.json`)], { stdio: 'inherit' });
          const fresh = getProposal(mnsDir, p.id);
          if (fresh) {
            proposals[i] = fresh;
            console.log(card(mnsDir, fresh, i, proposals.length));
          }
        } else if (a === 's') {
          skipped++; totalLeft--; acted = true;
        } else if (a === 'q' || a === '') {
          rl.close();
          console.log(`\nreview: ${approved} approved · ${rejected} rejected · ${skipped} skipped · ${totalLeft} left`);
          return;
        }
      }
    }
  }
  rl.close();
  console.log(`\nreview complete: ${approved} approved · ${rejected} rejected · ${skipped} skipped`);
}

/**
 * Resolve which faculty owns a given proposal id (used when --faculty is omitted).
 * Defaults to 'knowledge' (the historical path) when no other faculty claims it.
 */
function facultyOf(mnsDir, id, only) {
  if (only) return only;
  for (const { adapter, proposals } of pendingByFaculty(mnsDir)) {
    if (proposals.some((p) => p.id === id)) return adapter.name;
  }
  return 'knowledge';
}

/** Non-interactive: mns proposals list|show <id>|approve <id>|reject <id> [--reason r] [--faculty f] */
export function proposals(args) {
  const mnsDir = paths().dir;
  const sub = args._[0] || 'list';
  const only = args.faculty; // optional filter; default = all
  if (sub === 'list') {
    const inbox = processInbox(mnsDir);
    if (inbox.processed) console.log(`(processed ${inbox.processed} inbox candidate(s))`);
    const groups = pendingByFaculty(mnsDir).filter((g) => !only || g.adapter.name === only);
    const any = groups.some((g) => g.proposals.length);
    if (!any) return console.log('no pending proposals');
    for (const { adapter, proposals } of groups) {
      for (const p of proposals) {
        // knowledge keeps its historical one-liner; other faculties use adapter.render
        if (adapter.name === 'knowledge') {
          const what = p.kind === 'registry'
            ? `register ${p.registry.slice(0, -1)} '${p.key}'`
            : `${p.candidate.type}: ${p.candidate.body?.slice(0, 60).replace(/\n/g, ' ')}`;
          console.log(`  ${p.id}  [${p.er?.verdict ?? p.kind}]  ${what}`);
        } else {
          console.log(`  ${adapter.render(p).line}`);
        }
      }
    }
    return;
  }
  const id = args._[1];
  if (sub === 'show') {
    const faculty = facultyOf(mnsDir, id, only);
    const a = registry.get(faculty);
    const p = (a && typeof a.getProposal === 'function') ? a.getProposal(mnsDir, id) : getProposal(mnsDir, id);
    if (!p) return console.error('not found');
    console.log(JSON.stringify(p, null, 2));
    return;
  }
  if (sub === 'approve') {
    const faculty = facultyOf(mnsDir, id, only);
    const r = gate.approve(mnsDir, faculty, id);
    console.log(r.ok ? `✓ ${r.action}` : `✗ ${(r.errors ?? [r.action]).join('; ')}`);
    for (const w of r.warnings ?? []) console.log(`⚠ ${w}`);
    process.exit(r.ok ? 0 : 1);
  }
  if (sub === 'reject') {
    const faculty = facultyOf(mnsDir, id, only);
    const r = gate.reject(mnsDir, faculty, id, args.reason || '');
    console.log(r.ok ? '✓ rejected' : '✗ not found');
    process.exit(r.ok ? 0 : 1);
  }
  console.error('usage: mns proposals list|show <id>|approve <id>|reject <id> [--reason r] [--faculty f]');
  process.exit(1);
}
