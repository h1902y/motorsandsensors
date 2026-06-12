// zuzuu/actions/adapter.mjs
// The Actions faculty adapter (WS2-T3). Wraps the EXISTING Actions inbox gate
// (proposed dirs under .zuzuu/actions/inbox/<slug>/) behind the faculty-spine
// adapter contract — { name, ingest, validate, apply, render } — so the generic
// `zuzuu review` gate can drive Actions the same way it drives Knowledge.
//
// Actions payloads are DIRECTORIES (ACTION.md + sibling scripts), not JSON.
// Strategy (lowest-risk): the inbox stays a dir; this adapter emits/reads a
// spine-shaped proposal RECORD that REFERENCES the dir
// (payload = { slug, kind, dir:'inbox/<slug>' }). The gate resolves a single
// record via `getProposal`, lists pending via `listProposals`, and — because
// the payload is dir-shaped — archives rejections via `rejectDir` (a dir move
// into actions/proposals/archive/, not a JSON archive).
//
// Registers itself on import.

import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { listActions, inboxDir, isSafeSlug } from './manifest.mjs';
import { activateAction, rejectAction } from './inbox.mjs';
import { parseEnvelope, validateEnvelope, PAYLOAD_SCHEMAS } from '../faculty/envelope.mjs';
import * as registry from '../faculty/registry.mjs';

const name = 'actions';

/** Build a spine-shaped proposal record for one proposed action. */
function recordFor(a) {
  return {
    id: a.slug,
    faculty: name,
    kind: 'action',
    status: 'pending',
    source: 'agent',
    payload: { slug: a.slug, kind: a.kind, dir: `inbox/${a.slug}` },
    // carry render hints alongside the payload (cheap, dir read already done)
    title: a.title,
    promptSnippet: a.promptSnippet,
    analysis: {},
    evidence: {},
    provenance: [],
  };
}

/**
 * Pending action proposals (dirs in .zuzuu/actions/inbox/), surfaced as
 * spine-shaped records so the gate can render/approve/reject them uniformly.
 */
function listProposals(agentDir) {
  return listActions(inboxDir(agentDir)).map(recordFor);
}

/** Resolve a single proposed action by slug → spine-shaped record, or null. */
function getProposal(agentDir, slug) {
  if (!isSafeSlug(slug)) return null;
  return listProposals(agentDir).find((p) => p.id === slug) ?? null;
}

/**
 * Ingest is a pass-through for Actions: proposing scaffolds a dir
 * (zuzuu act propose / act-author). Kept for adapter-contract symmetry.
 */
function ingest(_agentDir, raw) {
  return { payload: raw?.payload ?? raw ?? {}, analysis: {} };
}

/**
 * Validate a proposed action's ACTION.md envelope (id matches the dir; the
 * payload validates against the actions schema). Missing ACTION.md → accept
 * (slug fallback, mirrors the historical missing-manifest tolerance).
 * @returns {{ok:boolean, errors:string[], warnings:string[]}}
 */
function validate(agentDir, payload) {
  const slug = payload?.slug;
  if (!isSafeSlug(slug)) return { ok: false, errors: [`invalid slug '${slug}'`], warnings: [] };
  const manPath = join(inboxDir(agentDir), slug, 'ACTION.md');
  if (!existsSync(manPath)) return { ok: true, errors: [], warnings: [] };
  const { ok, item, errors: parseErrors } = parseEnvelope(readFileSync(manPath, 'utf8'));
  if (!ok) return { ok: false, errors: [`ACTION.md is not a valid envelope: ${parseErrors[0]}`], warnings: [] };
  if (item.id && item.id !== slug) return { ok: false, errors: [`ACTION.md id '${item.id}' ≠ dir '${slug}'`], warnings: [] };
  if (item.faculty !== 'actions') return { ok: false, errors: [`ACTION.md faculty must be 'actions' (got '${item.faculty}')`], warnings: [] };
  const v = validateEnvelope(item, PAYLOAD_SCHEMAS.actions);
  return { ok: v.ok, errors: v.errors, warnings: [] };
}

/**
 * Apply an approved action proposal: activate it (move inbox/<slug> → <slug>).
 * Preserves the "already exists" guard from activateAction.
 * @returns {{ok:boolean, action:string, itemIds:string[], warnings:string[]}}
 */
function apply(agentDir, proposal) {
  const slug = proposal?.payload?.slug ?? proposal?.id;
  const r = activateAction(agentDir, slug);
  if (!r.ok) return { ok: false, action: r.error, itemIds: [], warnings: [] };
  return { ok: true, action: `activated ${slug}`, itemIds: [slug], warnings: [] };
}

/**
 * Reject path: dir-shaped, so the gate calls this instead of the JSON archive.
 * Moves inbox/<slug> → actions/proposals/archive/<slug> (archive, not delete).
 */
function rejectDir(agentDir, slug, _reason = '') {
  return rejectAction(agentDir, slug);
}

/**
 * Render a proposed action for the human gate. `card` mirrors the current review
 * card (slug ── kind, then the prompt snippet); `line` is the one-line list form.
 * @returns {{line:string, card:string}}
 */
function render(proposal) {
  const slug = proposal?.id ?? proposal?.payload?.slug ?? '';
  const kind = proposal?.payload?.kind ?? proposal?.kind ?? 'action';
  const snippet = proposal?.promptSnippet ?? '';
  return {
    line: `${slug}  [${kind}]  ${snippet}`,
    card: `${slug} ── ${kind}\n  ${snippet}`,
  };
}

export const adapter = { name, ingest, validate, apply, render, listProposals, getProposal, rejectDir };

registry.register(adapter);
