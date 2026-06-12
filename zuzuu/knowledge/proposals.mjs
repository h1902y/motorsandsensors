// Proposals — the human gate, as files. The first build of DESIGN's Proposal
// entity: { candidate, source, evidence, er-verdict, status }. Pending under
// .zuzuu/knowledge/proposals/<id>.json; resolved ones move to proposals/archive/
// (an auditable history — approvals also show up as item-file diffs in git).
//
// Registry governance rides the same gate: an unregistered attribute/relation
// key seen ≥3 times across proposals becomes a REGISTRY proposal (where Notes
// silently auto-registered, we ask).

import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadRegistry, validateItem } from './registry.mjs';
import { allItems, readItem, writeItem, slugify } from './items.mjs';
import { upsertItem } from './index.mjs';
import { resolve as erResolve, merge } from './er.mjs';
import { mechanicalScore } from '../eval/score.mjs';

export const proposalsDir = (agentDir) => join(agentDir, 'knowledge', 'proposals');
const archiveDir = (agentDir) => join(proposalsDir(agentDir), 'archive');

const shortHash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 6);

function writeProposal(agentDir, p) {
  mkdirSync(proposalsDir(agentDir), { recursive: true });
  writeFileSync(join(proposalsDir(agentDir), `${p.id}.json`), JSON.stringify(p, null, 2) + '\n');
  return p;
}

/** Run ER for a candidate and file a pending proposal (deduped per candidate). */
export function createProposal(agentDir, { candidate, source, evidence = {} }) {
  const { items } = allItems(agentDir);
  candidate.id = candidate.id || slugify(candidate.body);
  const er = erResolve(candidate, items);
  const id = `${candidate.id}-${shortHash(candidate.id + source)}`;
  const existing = join(proposalsDir(agentDir), `${id}.json`);
  if (existsSync(existing)) {
    // refresh evidence on the pending proposal instead of duplicating it
    const prev = JSON.parse(readFileSync(existing, 'utf8'));
    prev.evidence = { ...prev.evidence, ...evidence };
    prev.er = er;
    // keep analysis in sync so scorer can use updated er verdict
    prev.analysis = { ...(prev.analysis ?? {}), er: { verdict: er.verdict } };
    prev.score = scoreProposal(prev);
    return writeProposal(agentDir, prev);
  }
  const proposal = { id, kind: 'item', status: 'pending', created_at: new Date().toISOString(), source, candidate, evidence, er, analysis: { er: { verdict: er.verdict } } };
  proposal.score = scoreProposal(proposal);
  return writeProposal(agentDir, proposal);
}

/** Compute mechanicalScore for a proposal — fail-open (returns null on error). */
function scoreProposal(proposal) {
  try {
    const { score, confidence, rationale } = mechanicalScore(proposal, {});
    return { score, confidence, rationale };
  } catch {
    return null;
  }
}

export function listProposals(agentDir) {
  const dir = proposalsDir(agentDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')))
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
}

export function getProposal(agentDir, id) {
  const p = join(proposalsDir(agentDir), `${id}.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}

function archive(agentDir, proposal, status, extra = {}) {
  mkdirSync(archiveDir(agentDir), { recursive: true });
  const resolved = { ...proposal, status, resolved_at: new Date().toISOString(), ...extra };
  writeFileSync(join(archiveDir(agentDir), `${proposal.id}.json`), JSON.stringify(resolved, null, 2) + '\n');
  const pending = join(proposalsDir(agentDir), `${proposal.id}.json`);
  if (existsSync(pending)) renameSync(pending, join(archiveDir(agentDir), `${proposal.id}.json`));
  writeFileSync(join(archiveDir(agentDir), `${proposal.id}.json`), JSON.stringify(resolved, null, 2) + '\n');
  return resolved;
}

/**
 * Apply an approved proposal's effects — the canonical write path, extracted so
 * the Knowledge faculty adapter (WS2-T2) can call the *same* logic. This is the
 * registry-branch + ER-merge + writeItem + upsertItem body; it does NOT archive
 * (the caller decides lifecycle). Behaviour is identical to the old inline body.
 * @returns {{ok:boolean, action:string, item?:string, warnings:string[]}}
 */
export function applyKnowledgeProposal(agentDir, proposal) {
  const warnings = [];
  const id = proposal.id;

  if (proposal.kind === 'registry') {
    const file = join(agentDir, 'knowledge', 'registry', `${proposal.registry}.json`);
    const defs = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
    if (proposal.registry === 'attributes') defs.push({ key: proposal.key, value: 'string', description: `registered via proposal ${id}` });
    else defs.push({ name: proposal.key, inverse: proposal.key, description: `registered via proposal ${id} (symmetric — edit inverse if directional)` });
    writeFileSync(file, JSON.stringify(defs, null, 2) + '\n');
    return { ok: true, action: `registered ${proposal.registry.slice(0, -1)} '${proposal.key}'`, warnings };
  }

  const registry = loadRegistry(agentDir);
  const cand = proposal.candidate;
  const v = validateItem(registry, cand);
  for (const k of v.unknownKeys.attributes) {
    warnings.push(`dropped unregistered attribute '${k}' (approve its registry proposal first, then re-propose)`);
    delete cand.attributes[k];
  }
  cand.relations = (cand.relations ?? []).filter((r) => {
    if (registry.relations.has(r.type)) return true;
    warnings.push(`dropped relation with unregistered type '${r.type}'`);
    return false;
  });
  const v2 = validateItem(registry, cand);
  if (!v2.ok) return { ok: false, action: 'invalid', warnings: [...warnings, ...v2.errors] };

  let item;
  let action;
  if ((proposal.er?.verdict === 'enrich' || proposal.er?.verdict === 'duplicate') && proposal.er.match) {
    const existing = readItem(agentDir, proposal.er.match);
    if (existing) {
      item = merge(existing, cand);
      action = `enriched ${existing.id}`;
    }
  }
  if (!item) {
    item = { created_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), status: 'active', attributes: {}, relations: [], provenance: [], ...cand };
    action = `created ${item.id}`;
  }
  writeItem(agentDir, item);
  upsertItem(agentDir, item);
  return { ok: true, action, item: item.id, warnings };
}

/**
 * Approve: registry proposals append their key; item proposals write/merge the
 * item (unknown keys are DROPPED with warnings — knowledge stays registry-clean).
 * Delegates the effect to applyKnowledgeProposal, then archives.
 * @returns {{ok:boolean, action:string, item?:string, warnings:string[]}}
 */
export function approveProposal(agentDir, id) {
  const proposal = getProposal(agentDir, id);
  if (!proposal) return { ok: false, action: 'not-found', warnings: [] };

  const r = applyKnowledgeProposal(agentDir, proposal);
  if (!r.ok) return r;

  if (proposal.kind === 'registry') archive(agentDir, proposal, 'approved');
  else archive(agentDir, proposal, 'approved', { applied: r.action });
  return r;
}

export function rejectProposal(agentDir, id, reason = '') {
  const proposal = getProposal(agentDir, id);
  if (!proposal) return { ok: false };
  archive(agentDir, proposal, 'rejected', { reason });
  return { ok: true };
}

/**
 * Registry governance: unknown keys appearing ≥3 times across all proposals
 * (pending + archive) get a registry proposal filed — once.
 */
export function fileRegistryProposals(agentDir) {
  const registry = loadRegistry(agentDir);
  const counts = { attributes: {}, relations: {} };
  const dirs = [proposalsDir(agentDir), archiveDir(agentDir)];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      let p;
      try {
        p = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      } catch {
        continue;
      }
      if (p.kind !== 'item') continue;
      for (const k of Object.keys(p.candidate?.attributes ?? {})) if (!registry.attributes.has(k)) counts.attributes[k] = (counts.attributes[k] ?? 0) + 1;
      for (const r of p.candidate?.relations ?? []) if (!registry.relations.has(r.type)) counts.relations[r.type] = (counts.relations[r.type] ?? 0) + 1;
    }
  }
  const filed = [];
  for (const [kind, tally] of Object.entries(counts)) {
    for (const [key, n] of Object.entries(tally)) {
      if (n < 3) continue;
      const id = `register-${kind.slice(0, 3)}-${slugify(key)}`;
      if (getProposal(agentDir, id) || existsSync(join(archiveDir(agentDir), `${id}.json`))) continue;
      filed.push(writeProposal(agentDir, { id, kind: 'registry', registry: kind, key, status: 'pending', created_at: new Date().toISOString(), evidence: { occurrences: n } }));
    }
  }
  return filed;
}
