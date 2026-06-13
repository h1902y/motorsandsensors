// zuzuu/actions/inbox.mjs
// The Actions crystallization gate (the same governed pipeline as Knowledge
// promotion, kept out of the knowledge ER/registry machinery). A proposed action
// is a real dir under .zuzuu/actions/inbox/<slug>/. A human activates it (move to
// .zuzuu/actions/<slug>/) or rejects it (remove). Never auto-activates.

import { join } from 'node:path';
import { existsSync, readFileSync, renameSync, mkdirSync, rmSync } from 'node:fs';
import { actionsDir, inboxDir, listActions, isSafeSlug } from './manifest.mjs';
import { parseEnvelope } from '../module/envelope.mjs';

/** Archive dir for rejected action proposals: .zuzuu/actions/proposals/archive/. */
const archiveBaseDir = (agentDir) => join(actionsDir(agentDir), 'proposals', 'archive');

/** Proposed actions awaiting review (in .zuzuu/actions/inbox/). */
export function listProposedActions(agentDir) {
  return listActions(inboxDir(agentDir));
}

/**
 * Activate a proposed action: validate, then move inbox/<slug> → actions/<slug>.
 * @returns {{ok:true} | {ok:false, error:string}}
 */
export function activateAction(agentDir, slug) {
  if (!isSafeSlug(slug)) return { ok: false, error: `invalid slug '${slug}'` };
  const from = join(inboxDir(agentDir), slug);
  const to = join(actionsDir(agentDir), slug);
  if (!existsSync(from)) return { ok: false, error: `no proposed action '${slug}'` };
  if (existsSync(to)) return { ok: false, error: `an active action '${slug}' already exists — reject or rename first` };
  const manPath = join(from, 'ACTION.md');
  if (existsSync(manPath)) {
    const { ok, item } = parseEnvelope(readFileSync(manPath, 'utf8'));
    if (!ok) return { ok: false, error: 'ACTION.md is not a valid envelope' };
    if (item.id && item.id !== slug) return { ok: false, error: `ACTION.md id '${item.id}' ≠ dir '${slug}'` };
  }
  renameSync(from, to);
  return { ok: true };
}

/**
 * Reject a proposed action: ARCHIVE its dir (move inbox/<slug> →
 * actions/proposals/archive/<slug>), never destroy it (WS2-T3). An auditable
 * history mirrors the Knowledge gate's archive-on-reject.
 */
export function rejectAction(agentDir, slug) {
  if (!isSafeSlug(slug)) return { ok: false, error: `invalid slug '${slug}'` };
  const from = join(inboxDir(agentDir), slug);
  if (!existsSync(from)) return { ok: false, error: `no proposed action '${slug}'` };
  const archBase = archiveBaseDir(agentDir);
  mkdirSync(archBase, { recursive: true });
  const to = join(archBase, slug);
  // if a prior rejection of the same slug exists, clear it so the move succeeds
  if (existsSync(to)) rmSync(to, { recursive: true, force: true });
  renameSync(from, to);
  return { ok: true };
}
