// tests/unit/proposal-archive-gate.test.mjs
// Policy: a rejection is remembered. Re-distilling the same sessions must NOT
// resurrect a proposal id that was already resolved (rejected OR approved) into
// proposals/archive/. The gate lives at the FILING layer (createProposal /
// miner propose), never inside the low-level writeProposal.
//
// Ids are exercised through the real flow (create → resolve → re-create), never
// hand-computed — matching the golden-id convention.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtempSync, existsSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { SEED_TYPES, SEED_ATTRIBUTES, SEED_RELATIONS } from '../../zuzuu/knowledge/registry.mjs';
import { createProposal, rejectProposal, approveProposal, listProposals } from '../../zuzuu/knowledge/proposals.mjs';
import { propose as kPropose } from '../../zuzuu/modules/knowledge/index.mjs';
import { aggregate as gAggregate, propose as gPropose } from '../../zuzuu/modules/guardrails/index.mjs';
import { archiveProposal, listProposals as listModuleProposals, readArchived, isArchivedResolved } from '../../zuzuu/module/proposal.mjs';

const home = (prefix) => mkdtempSync(join(tmpdir(), prefix));

const cand = (id, body) => ({ id, type: 'fact', body, attributes: {}, relations: [], provenance: [] });

// ---------------------------------------------------------------------------
// Knowledge distill path (createProposal)

test('createProposal: a rejected id is remembered — re-filing is skipped as archived-skip', () => {
  const agentDir = home('zuzuu-arch-gate-');

  // File → reject (the real flow that produces the archive record).
  const p1 = createProposal(agentDir, { candidate: cand('design-md', 'docs/DESIGN.md is the canonical design'), source: 'distill', evidence: { occurrences: 5 } });
  assert.equal(p1.status, 'pending');
  rejectProposal(agentDir, p1.id, 'not useful');
  assert.equal(listProposals(agentDir).length, 0, 'rejection empties pending');

  // Re-distill derives the same id → must NOT resurrect, and must say so.
  const p2 = createProposal(agentDir, { candidate: cand('design-md', 'docs/DESIGN.md is the canonical design'), source: 'distill', evidence: { occurrences: 6 } });
  assert.equal(p2.status, 'archived-skip', 'skip is reported, not silent');
  assert.equal(p2.id, p1.id);
  assert.equal(p2.archived, 'rejected');
  assert.equal(listProposals(agentDir).length, 0, 'NO pending proposal resurrected');
  assert.ok(existsSync(join(agentDir, 'knowledge', 'proposals', 'archive', `${p1.id}.json`)), 'archive record intact');
});

test('createProposal: an approved id is not re-filed either (work is done)', () => {
  const agentDir = home('zuzuu-arch-gate-appr-');
  // seed the registry so approval can validate the candidate type
  const reg = join(agentDir, 'knowledge', 'registry');
  mkdirSync(reg, { recursive: true });
  writeFileSync(join(reg, 'types.json'), JSON.stringify(SEED_TYPES));
  writeFileSync(join(reg, 'attributes.json'), JSON.stringify(SEED_ATTRIBUTES));
  writeFileSync(join(reg, 'relations.json'), JSON.stringify(SEED_RELATIONS));
  const p1 = createProposal(agentDir, { candidate: cand('node-version', 'This project requires Node 22'), source: 'distill' });
  const r = approveProposal(agentDir, p1.id);
  assert.ok(r.ok, 'approval applies');
  const p2 = createProposal(agentDir, { candidate: cand('node-version', 'This project requires Node 22'), source: 'distill' });
  assert.equal(p2.status, 'archived-skip');
  assert.equal(p2.archived, 'approved');
  assert.equal(listProposals(agentDir).length, 0);
});

test('createProposal: an id NOT in the archive still files normally (no over-blocking)', () => {
  const agentDir = home('zuzuu-arch-gate-pos-');
  const p1 = createProposal(agentDir, { candidate: cand('reject-me', 'fact one'), source: 'distill' });
  rejectProposal(agentDir, p1.id);
  // a DIFFERENT id files fine after a rejection exists in the archive
  const p2 = createProposal(agentDir, { candidate: cand('fresh-fact', 'fact two'), source: 'distill' });
  assert.equal(p2.status, 'pending');
  assert.equal(listProposals(agentDir).length, 1);
  assert.equal(listProposals(agentDir)[0].id, p2.id);
});

test('knowledge miner propose: archived-skips are not counted as filed proposals', () => {
  const agentDir = home('zuzuu-arch-gate-kminer-');
  const c = { candidate: cand('hot-file', 'a hot file fact'), evidence: { occurrences: 5 } };
  assert.equal(kPropose(agentDir, [c]), 1, 'first run files 1');
  const id = listProposals(agentDir)[0].id;
  rejectProposal(agentDir, id, 'noise');
  assert.equal(kPropose(agentDir, [c]), 0, 're-run files 0 (rejection remembered)');
  assert.equal(listProposals(agentDir).length, 0);
});

// ---------------------------------------------------------------------------
// Spine miners path (module/proposal.mjs writers)

const makeSession = (id, destructiveFailures) => ({ sessionId: id, commands: [], files: [], failures: [], sequences: [], correctionTurns: [], destructiveFailures });
const df = (cmd) => ({ cmd, tool: 'Bash' });

test('guardrails miner: archived-rejected id is never re-proposed', () => {
  const agentDir = home('zuzuu-arch-gate-guard-');
  const cmd = 'rm -rf /data';
  const cands = gAggregate([makeSession('sA', [df(cmd), df(cmd)]), makeSession('sB', [df(cmd)])]);
  assert.equal(gPropose(agentDir, cands), 1, 'first run files 1');

  // Reject it through the spine archive (what `zuzuu review` does).
  const pending = listModuleProposals(agentDir, 'guardrails');
  assert.equal(pending.length, 1);
  archiveProposal(agentDir, 'guardrails', pending[0].id, { status: 'rejected', reason: 'too noisy' });
  assert.equal(listModuleProposals(agentDir, 'guardrails').length, 0);

  // Re-distill same sessions → nothing files, nothing pending.
  assert.equal(gPropose(agentDir, cands), 0, 'rejection remembered: propose files nothing');
  const propDir = join(agentDir, 'guardrails', 'proposals');
  const files = readdirSync(propDir).filter((f) => f.endsWith('.json'));
  assert.equal(files.length, 0, 'no pending proposal file resurrected');
});

test('guardrails miner: a different (un-archived) candidate still files after a rejection', () => {
  const agentDir = home('zuzuu-arch-gate-guard-pos-');
  const rejectedCmd = 'rm -rf /data';
  const freshCmd = 'git push --force origin main';
  const cands1 = gAggregate([makeSession('sA', [df(rejectedCmd), df(rejectedCmd)]), makeSession('sB', [df(rejectedCmd)])]);
  gPropose(agentDir, cands1);
  archiveProposal(agentDir, 'guardrails', listModuleProposals(agentDir, 'guardrails')[0].id, { status: 'rejected' });

  const cands2 = gAggregate([makeSession('sC', [df(freshCmd), df(freshCmd)]), makeSession('sD', [df(freshCmd)])]);
  assert.equal(gPropose(agentDir, cands2), 1, 'fresh id files normally');
  assert.equal(listModuleProposals(agentDir, 'guardrails').length, 1);
});

// ---------------------------------------------------------------------------
// Shared helper

test('readArchived / isArchivedResolved: read the archive record; absent → null/false', () => {
  const agentDir = home('zuzuu-arch-gate-helper-');
  assert.equal(readArchived(agentDir, 'guardrails', 'nope-000000'), null);
  assert.equal(isArchivedResolved(agentDir, 'guardrails', 'nope-000000'), false);

  const cands = gAggregate([makeSession('sA', [df('rm -rf /x'), df('rm -rf /x')]), makeSession('sB', [df('rm -rf /x')])]);
  gPropose(agentDir, cands);
  const id = listModuleProposals(agentDir, 'guardrails')[0].id;
  archiveProposal(agentDir, 'guardrails', id, { status: 'rejected', reason: 'r' });

  const rec = readArchived(agentDir, 'guardrails', id);
  assert.ok(rec);
  assert.equal(rec.status, 'rejected');
  assert.equal(isArchivedResolved(agentDir, 'guardrails', id), true);
});
