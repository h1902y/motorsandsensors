// The inbox — where candidates arrive. Agents (per the faculty block) drop one
// fact per file into agent/knowledge/inbox/; `mns distill` drops mined candidates
// the same way. Processing wraps each into an ER'd proposal (the file's full
// content is preserved inside the proposal JSON) and removes the inbox file.
//
// Tolerant input: plain text, or our frontmatter grammar for typed candidates.

import { join, basename } from 'node:path';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { parseItem, slugify } from './items.mjs';
import { createProposal, fileRegistryProposals } from './proposals.mjs';

export const inboxDir = (mnsDir) => join(mnsDir, 'knowledge', 'inbox');

/** Lenient candidate parse: full item grammar, or bare prose. */
export function parseCandidate(text, filename = '') {
  try {
    const item = parseItem(text);
    return { id: item.id, type: item.type, body: item.body, attributes: item.attributes, relations: item.relations, provenance: item.provenance };
  } catch {
    const body = text.trim();
    return { id: slugify(body), type: 'fact', body, attributes: {}, relations: [], provenance: [] };
  }
}

/**
 * Process every inbox file → proposal. Returns {processed, proposals, registryProposals}.
 * source tags where candidates came from ('agent' for inbox drops).
 */
export function processInbox(mnsDir, { source = 'agent' } = {}) {
  const dir = inboxDir(mnsDir);
  if (!existsSync(dir)) return { processed: 0, proposals: [], registryProposals: [] };
  const proposals = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.md') || f.endsWith('.txt'))) {
    const path = join(dir, f);
    const cand = parseCandidate(readFileSync(path, 'utf8'), f);
    cand.provenance = [...(cand.provenance ?? []), { session: source, ref: `inbox/${basename(f)}` }];
    proposals.push(createProposal(mnsDir, { candidate: cand, source, evidence: { inboxFile: f } }));
    rmSync(path); // full candidate now lives inside the proposal
  }
  const registryProposals = fileRegistryProposals(mnsDir);
  return { processed: proposals.length, proposals, registryProposals };
}
