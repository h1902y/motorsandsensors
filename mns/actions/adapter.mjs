// mns/actions/adapter.mjs
// The Actions faculty adapter (WS2-T3). Wraps the EXISTING Actions inbox gate
// (proposed dirs under agent/actions/inbox/<slug>/) behind the faculty-spine
// adapter contract — { name, ingest, validate, apply, render } — so the generic
// `mns review` gate can drive Actions the same way it drives Knowledge.
//
// Actions payloads are DIRECTORIES (run.mjs/SKILL.md + action.json), not JSON.
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
import { validateInputs } from './schema.mjs';
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
 * Pending action proposals (dirs in agent/actions/inbox/), surfaced as
 * spine-shaped records so the gate can render/approve/reject them uniformly.
 */
function listProposals(mnsDir) {
  return listActions(inboxDir(mnsDir)).map(recordFor);
}

/** Resolve a single proposed action by slug → spine-shaped record, or null. */
function getProposal(mnsDir, slug) {
  if (!isSafeSlug(slug)) return null;
  return listProposals(mnsDir).find((p) => p.id === slug) ?? null;
}

/**
 * Ingest is a pass-through for Actions: proposing scaffolds a dir
 * (mns act propose / act-author). Kept for adapter-contract symmetry.
 */
function ingest(_mnsDir, raw) {
  return { payload: raw?.payload ?? raw ?? {}, analysis: {} };
}

/**
 * Validate a proposed action's manifest against the schema subset and confirm
 * the manifest slug matches the dir. Missing manifest → accept (slug fallback).
 * @returns {{ok:boolean, errors:string[], warnings:string[]}}
 */
function validate(mnsDir, payload) {
  const slug = payload?.slug;
  if (!isSafeSlug(slug)) return { ok: false, errors: [`invalid slug '${slug}'`], warnings: [] };
  const manPath = join(inboxDir(mnsDir), slug, 'action.json');
  if (!existsSync(manPath)) return { ok: true, errors: [], warnings: [] };
  let man;
  try { man = JSON.parse(readFileSync(manPath, 'utf8')); }
  catch { return { ok: false, errors: ['manifest is not valid JSON'], warnings: [] }; }
  if (man.slug && man.slug !== slug) return { ok: false, errors: [`manifest slug '${man.slug}' ≠ dir '${slug}'`], warnings: [] };
  const errors = [];
  // the manifest schema is itself JSON-Schema-subset shaped; sanity-check both ends
  if (man.inputs) {
    const vi = validateInputs(man.inputs, man.default_args, {});
    // inputs schema is for caller args, not the manifest — only flag a structurally
    // broken schema (validateInputs is permissive on empty args), so this is a no-op
    // for well-formed manifests. Kept for symmetry with the knowledge adapter.
    if (vi.ok === false && !/required/i.test(vi.error ?? '')) errors.push(vi.error);
  }
  if (man.outputs && typeof man.outputs !== 'object') errors.push('outputs schema must be an object');
  return { ok: errors.length === 0, errors, warnings: [] };
}

/**
 * Apply an approved action proposal: activate it (move inbox/<slug> → <slug>).
 * Preserves the "already exists" guard from activateAction.
 * @returns {{ok:boolean, action:string, itemIds:string[], warnings:string[]}}
 */
function apply(mnsDir, proposal) {
  const slug = proposal?.payload?.slug ?? proposal?.id;
  const r = activateAction(mnsDir, slug);
  if (!r.ok) return { ok: false, action: r.error, itemIds: [], warnings: [] };
  return { ok: true, action: `activated ${slug}`, itemIds: [slug], warnings: [] };
}

/**
 * Reject path: dir-shaped, so the gate calls this instead of the JSON archive.
 * Moves inbox/<slug> → actions/proposals/archive/<slug> (archive, not delete).
 */
function rejectDir(mnsDir, slug, _reason = '') {
  return rejectAction(mnsDir, slug);
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
