// Entity resolution — the gatekeeper between candidates and canonical items.
//
// Pure matcher: given a candidate and the existing items, decide
//   new        — nothing like it exists
//   duplicate  — an item already says this (candidate adds nothing)
//   enrich     — an existing item is the same entity; candidate adds evidence/
//                attributes/relations → merge into it
//
// Deliberately mechanical (v1): exact id → slug-normalized id → token-overlap
// fuzzy on body+id with attribute corroboration. Deterministic, hermetically
// testable; an LLM judge is a later, separate rung. Thresholds are conservative:
// a false "duplicate" silently loses knowledge, a false "new" merely creates a
// reviewable proposal the human can reject — so we bias toward "new"/"enrich".

import { slugify } from './items.mjs';

const STOP = new Set(['the', 'a', 'an', 'is', 'are', 'this', 'that', 'with', 'for', 'and', 'or', 'of', 'in', 'on', 'to', 'it', 'its', 'project', 's']);

// light stemmer: trailing 's' off words >3 chars (tests→test, runs→run) —
// enough to stop trivial morphology from sinking real overlaps; no more.
const stem = (t) => (t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t);

export function tokens(text) {
  return new Set(
    String(text)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1 && !STOP.has(t))
      .map(stem),
  );
}

export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Shared attribute VALUES count as strong corroboration (e.g. same command line). */
function sharedAttrValues(a = {}, b = {}) {
  let shared = 0;
  for (const [k, v] of Object.entries(a)) if (k in b && String(b[k]) === String(v)) shared++;
  return shared;
}

/**
 * @param {object} candidate  {id?, type, body, attributes?}
 * @param {Array}  items      existing canonical items
 * @returns {{verdict:'new'|'duplicate'|'enrich', match?:string, confidence:number, reason:string}}
 */
export function resolve(candidate, items) {
  const candId = candidate.id || slugify(candidate.body);
  const candTokens = tokens(`${candId} ${candidate.body ?? ''}`);

  let best = null;
  for (const item of items) {
    // 1. exact / slug-normalized id match
    if (item.id === candId || slugify(item.id) === candId) {
      best = { item, sim: 1, why: 'id match' };
      break;
    }
    // 2. fuzzy: token overlap + attribute corroboration (same-type only)
    if (item.type !== candidate.type) continue;
    const sim = jaccard(candTokens, tokens(`${item.id} ${item.body ?? ''}`));
    const corroboration = sharedAttrValues(candidate.attributes, item.attributes);
    const score = sim + corroboration * 0.25;
    if (!best || score > best.sim) best = { item, sim: score, why: corroboration ? `token overlap + ${corroboration} shared attribute(s)` : 'token overlap' };
  }

  if (!best || best.sim < 0.5) {
    return { verdict: 'new', confidence: best ? 1 - best.sim : 1, reason: 'no sufficiently similar item' };
  }
  // same entity — duplicate (nothing new) or enrich (new attrs/relations/evidence)?
  const item = best.item;
  const newAttrs = Object.entries(candidate.attributes ?? {}).filter(([k, v]) => String(item.attributes?.[k]) !== String(v));
  const newRels = (candidate.relations ?? []).filter((r) => !(item.relations ?? []).some((e) => e.type === r.type && e.target === r.target));
  const addsSomething = newAttrs.length || newRels.length || (candidate.provenance ?? []).length;
  return {
    verdict: addsSomething ? 'enrich' : 'duplicate',
    match: item.id,
    confidence: Math.min(best.sim, 1),
    reason: best.why,
  };
}

/** Merge a candidate into an existing item (enrich verdict). Pure. */
export function merge(item, candidate) {
  const merged = { ...item, attributes: { ...item.attributes }, relations: [...(item.relations ?? [])], provenance: [...(item.provenance ?? [])] };
  for (const [k, v] of Object.entries(candidate.attributes ?? {})) if (!(k in merged.attributes)) merged.attributes[k] = v;
  for (const r of candidate.relations ?? []) {
    if (!merged.relations.some((e) => e.type === r.type && e.target === r.target)) merged.relations.push(r);
  }
  for (const p of candidate.provenance ?? []) {
    if (!merged.provenance.some((e) => e.session === p.session && e.ref === p.ref)) merged.provenance.push(p);
  }
  return merged;
}
