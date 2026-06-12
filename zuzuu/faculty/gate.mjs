// zuzuu/faculty/gate.mjs
// The generic approve/reject orchestrator for the faculty spine (WS2-T3).
// Replaces the per-faculty inline approve/reject bodies with one adapter-driven
// path: look up the faculty adapter, validate the payload, apply on approve,
// archive the proposal record, and record an observability trail entry.
//
// Dir-shaped faculties (Actions) carry their payload as a directory, not a JSON
// blob. Such adapters expose `rejectDir(agentDir, id, reason)` (a dir move into
// proposals/archive/) which the gate prefers over the JSON archiveProposal.
//
// Fail-soft on trail: a logging failure must never affect approve/reject.

import * as registry from './registry.mjs';
import { readProposal, archiveProposal } from './proposal.mjs';
import { recordTrail } from './trail.mjs';

/** Trail is observability only — never let it throw into the caller. */
function trail(agentDir, faculty, entry) {
  try {
    recordTrail(agentDir, faculty, entry);
  } catch {
    /* fail-soft */
  }
}

/**
 * Approve a proposal: validate → apply → archive (status approved) → trail.
 * @returns the adapter's apply result, or {ok:false, errors} on a validation miss.
 */
export function approve(agentDir, faculty, id) {
  const a = registry.get(faculty);
  if (!a) return { ok: false, errors: [`no adapter for faculty '${faculty}'`] };
  // dir-shaped faculties (Actions) carry no JSON record — let the adapter resolve.
  const p = (typeof a.getProposal === 'function')
    ? a.getProposal(agentDir, id)
    : readProposal(agentDir, faculty, id);
  if (!p) return { ok: false, errors: [`no proposal '${id}' in '${faculty}'`] };
  const v = a.validate(agentDir, p.payload);
  if (!v.ok) return { ok: false, errors: v.errors };
  const r = a.apply(agentDir, p);
  // Only archive as approved if apply actually succeeded — a failed apply (e.g.
  // an action that already exists) must leave the proposal PENDING so it can be
  // retried, never silently archived as "approved" (matches the prior
  // approveProposal `if (!r.ok) return r` guard).
  if (!r || !r.ok) return r || { ok: false, errors: ['apply returned nothing'] };
  archiveProposal(agentDir, faculty, id, { status: 'approved', applied: r.action });
  trail(agentDir, faculty, { kind: 'approve', id, applied: r.action });
  return r;
}

/**
 * Reject a proposal: archive (status rejected) → trail. NEVER a destructive
 * delete — the record (or dir, for dir-shaped faculties) moves to archive/.
 * @returns {{ok:true}}
 */
export function reject(agentDir, faculty, id, reason = '') {
  const a = registry.get(faculty);
  if (a && typeof a.rejectDir === 'function') {
    a.rejectDir(agentDir, id, reason);
  } else {
    archiveProposal(agentDir, faculty, id, { status: 'rejected', reason });
  }
  trail(agentDir, faculty, { kind: 'reject', id, reason });
  return { ok: true };
}
