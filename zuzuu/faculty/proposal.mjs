// zuzuu/faculty/proposal.mjs
// Unified Proposal record for the faculty spine (WS2-T1).
// Mirrors zuzuu/knowledge/proposals.mjs's id scheme (<slug>-<shortHash(slug+source)>)
// and extends it to be faculty-agnostic.
//
// Dual-read: transparently normalises legacy {candidate, er} → {payload, analysis}
// so old knowledge proposals are readable without a migration step.

import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { proposalsDir, archiveDir } from './contract.mjs';

// ---------------------------------------------------------------------------
// internal helpers
// ---------------------------------------------------------------------------
const shortHash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 6);

/** Normalise a raw JSON object from disk (handles legacy candidate/er keys). */
function normalise(raw, faculty) {
  if (!raw) return null;
  const rec = { ...raw };
  // faculty: always set (default to the arg if absent)
  if (!rec.faculty) rec.faculty = faculty;
  // dual-read: map legacy `candidate` → `payload`
  if (!rec.payload && rec.candidate !== undefined) {
    rec.payload = rec.candidate;
  }
  // dual-read: map legacy `er` → `analysis.er`
  if (!rec.analysis && rec.er !== undefined) {
    rec.analysis = { er: rec.er };
  }
  // ensure defaults
  if (!rec.analysis) rec.analysis = {};
  if (!rec.evidence) rec.evidence = {};
  if (!rec.provenance) rec.provenance = [];
  return rec;
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

/**
 * Deterministic proposal id: `<slug>-<shortHash(slug + source)>`.
 * Replicates the scheme in zuzuu/knowledge/proposals.mjs exactly.
 */
export function proposalId(slug, source) {
  return `${slug}-${shortHash(slug + source)}`;
}

/**
 * Build a proposal record object (does not write to disk).
 * Defaults: analysis={}, evidence={}, provenance=[].
 */
export function makeProposal({ faculty, kind, source, payload, analysis = {}, evidence = {}, provenance = [] }) {
  const slug = (payload && payload.id) ? payload.id : kind;
  const id = proposalId(slug, source);
  return {
    id,
    faculty,
    kind,
    status: 'pending',
    created_at: new Date().toISOString(),
    source,
    payload: payload ?? {},
    analysis,
    evidence,
    provenance,
  };
}

/**
 * Write a proposal record to `.zuzuu/<faculty>/proposals/<id>.json`.
 * Creates directories as needed. Returns the written path.
 */
export function writeProposal(agentDir, proposal) {
  const dir = proposalsDir(agentDir, proposal.faculty);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${proposal.id}.json`);
  writeFileSync(path, JSON.stringify(proposal, null, 2) + '\n');
  return path;
}

/**
 * Read and normalise a single proposal by faculty + id.
 * Returns null if the file does not exist (never throws).
 */
export function readProposal(agentDir, faculty, id) {
  const path = join(proposalsDir(agentDir, faculty), `${id}.json`);
  if (!existsSync(path)) return null;
  try {
    return normalise(JSON.parse(readFileSync(path, 'utf8')), faculty);
  } catch {
    return null;
  }
}

/**
 * List all pending proposals for a faculty (files in proposals/ not in archive/).
 * Normalises each record. Skips unreadable files (fail-soft).
 */
export function listProposals(agentDir, faculty) {
  const dir = proposalsDir(agentDir, faculty);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return normalise(JSON.parse(readFileSync(join(dir, f), 'utf8')), faculty);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
}

/**
 * Move a proposal from pending into archive/ with a resolved status.
 * @param {string} status - 'approved' | 'rejected'
 * @param {string} [reason] - human-readable reason
 * @param {string} [applied] - what was done on approval
 * @returns the resolved record
 */
export function archiveProposal(agentDir, faculty, id, { status, reason = '', applied = '' } = {}) {
  const pending = join(proposalsDir(agentDir, faculty), `${id}.json`);
  const archDir = archiveDir(agentDir, faculty);
  mkdirSync(archDir, { recursive: true });

  // read & normalise the pending record (or whatever we can find)
  let proposal;
  if (existsSync(pending)) {
    try {
      proposal = normalise(JSON.parse(readFileSync(pending, 'utf8')), faculty);
    } catch {
      proposal = { id, faculty };
    }
  } else {
    proposal = { id, faculty };
  }

  const resolved = {
    ...proposal,
    status,
    resolved_at: new Date().toISOString(),
    reason,
    applied,
  };

  const archPath = join(archDir, `${id}.json`);
  writeFileSync(archPath, JSON.stringify(resolved, null, 2) + '\n');

  // remove the pending file (rename is atomic; fall back to just leaving archive)
  if (existsSync(pending)) {
    try {
      renameSync(pending, archPath);
      // re-write with resolved fields (rename replaces content, so write again)
      writeFileSync(archPath, JSON.stringify(resolved, null, 2) + '\n');
    } catch {
      // archive already written above; ignore rename failure
    }
  }

  return resolved;
}
