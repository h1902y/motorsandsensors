// mns/actions/inbox.mjs
// The Actions crystallization gate (the same governed pipeline as Knowledge
// promotion, kept out of the knowledge ER/registry machinery). A proposed action
// is a real dir under agent/actions/inbox/<slug>/. A human activates it (move to
// agent/actions/<slug>/) or rejects it (remove). Never auto-activates.

import { join } from 'node:path';
import { existsSync, readFileSync, renameSync, mkdirSync, rmSync } from 'node:fs';
import { actionsDir, inboxDir, listActions, isSafeSlug } from './manifest.mjs';

/** Archive dir for rejected action proposals: agent/actions/proposals/archive/. */
const archiveBaseDir = (mnsDir) => join(actionsDir(mnsDir), 'proposals', 'archive');

/** Proposed actions awaiting review (in agent/actions/inbox/). */
export function listProposedActions(mnsDir) {
  return listActions(inboxDir(mnsDir));
}

/**
 * Activate a proposed action: validate, then move inbox/<slug> → actions/<slug>.
 * @returns {{ok:true} | {ok:false, error:string}}
 */
export function activateAction(mnsDir, slug) {
  if (!isSafeSlug(slug)) return { ok: false, error: `invalid slug '${slug}'` };
  const from = join(inboxDir(mnsDir), slug);
  const to = join(actionsDir(mnsDir), slug);
  if (!existsSync(from)) return { ok: false, error: `no proposed action '${slug}'` };
  if (existsSync(to)) return { ok: false, error: `an active action '${slug}' already exists — reject or rename first` };
  const manPath = join(from, 'action.json');
  if (existsSync(manPath)) {
    let man;
    try { man = JSON.parse(readFileSync(manPath, 'utf8')); }
    catch { return { ok: false, error: `manifest is not valid JSON` }; }
    if (man.slug && man.slug !== slug) return { ok: false, error: `manifest slug '${man.slug}' ≠ dir '${slug}'` };
  }
  renameSync(from, to);
  return { ok: true };
}

/**
 * Reject a proposed action: ARCHIVE its dir (move inbox/<slug> →
 * actions/proposals/archive/<slug>), never destroy it (WS2-T3). An auditable
 * history mirrors the Knowledge gate's archive-on-reject.
 */
export function rejectAction(mnsDir, slug) {
  if (!isSafeSlug(slug)) return { ok: false, error: `invalid slug '${slug}'` };
  const from = join(inboxDir(mnsDir), slug);
  if (!existsSync(from)) return { ok: false, error: `no proposed action '${slug}'` };
  const archBase = archiveBaseDir(mnsDir);
  mkdirSync(archBase, { recursive: true });
  const to = join(archBase, slug);
  // if a prior rejection of the same slug exists, clear it so the move succeeds
  if (existsSync(to)) rmSync(to, { recursive: true, force: true });
  renameSync(from, to);
  return { ok: true };
}
