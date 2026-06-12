// tests/unit/review-generation.test.mjs
// WS3-T2: batch-mint a generation on review close.
//
// Uses spawnSync with piped stdin (same pattern as review-actions.test.mjs) so
// the test is fully hermetic — it exercises the real CLI entry point end-to-end.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { listGenerations, readGeneration, activeGeneration } from '../../zuzuu/faculty/generation/read.mjs';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'zuzuu.mjs');

/**
 * Build a minimal .home home with N knowledge inbox facts (which processInbox
 * turns into pending proposals during `home review`).
 */
function freshHome(facts) {
  const root = mkdtempSync(join(tmpdir(), 'zuzuu-rev-gen-'));
  const home = join(root, '.zuzuu');
  for (const d of ['knowledge/items', 'knowledge/inbox', 'knowledge/proposals', 'knowledge/registry', 'actions/inbox']) {
    mkdirSync(join(home, d), { recursive: true });
  }
  // seed the type registry so 'fact' is a valid type during apply
  writeFileSync(
    join(home, 'knowledge', 'registry', 'types.json'),
    JSON.stringify([{ name: 'fact', description: 'A declarative truth' }]),
  );
  // drop each fact into the inbox (one file = one candidate = one proposal)
  for (let i = 0; i < facts.length; i++) {
    writeFileSync(join(home, 'knowledge', 'inbox', `fact${i}.md`), facts[i]);
  }
  return { root, home };
}

// ---------------------------------------------------------------------------
// Test 1: approve both → exactly ONE generation minted with both proposal ids
// ---------------------------------------------------------------------------
test('review: approve both proposals → exactly one generation minted, mintedFrom contains both ids', () => {
  const { root, home } = freshHome([
    'zero deps is a hard policy',
    'playground exit 2 means skip not fail',
  ]);
  try {
    // y\ny\n approves both inbox proposals
    const r = spawnSync(process.execPath, [BIN, 'review'], { cwd: root, input: 'y\ny\n', encoding: 'utf8' });
    assert.equal(r.status, 0, `process exited non-zero: ${r.stderr}`);

    // exactly ONE generation
    const gens = listGenerations(home);
    assert.equal(gens.length, 1, `expected 1 generation, got ${gens.length}`);

    const gen = readGeneration(home, gens[0]);
    assert.ok(gen, 'generation lockfile readable');
    assert.ok(Array.isArray(gen.mintedFrom), 'mintedFrom is an array');
    assert.equal(gen.mintedFrom.length, 2, `mintedFrom should contain 2 ids, got ${gen.mintedFrom.length}`);

    // activeGeneration should be this generation
    assert.equal(activeGeneration(home), gens[0], 'active generation updated');

    // stdout should mention the mint as a graduation ceremony
    assert.match(r.stdout, /generation gen_001 minted/);
    assert.match(r.stdout, /zuzuu generation show/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 2: reject both → NO generation minted
// ---------------------------------------------------------------------------
test('review: reject all proposals → no generation minted', () => {
  const { root, home } = freshHome([
    'no generation on reject',
    'second reject fact',
  ]);
  try {
    // n\nn\n — each rejection also asks for a reason; send empty lines
    const r = spawnSync(process.execPath, [BIN, 'review'], { cwd: root, input: 'n\n\nn\n\n', encoding: 'utf8' });
    assert.equal(r.status, 0, `process exited non-zero: ${r.stderr}`);

    const gens = listGenerations(home);
    assert.equal(gens.length, 0, `expected 0 generations, got ${gens.length}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 3: approve one then quit → one generation minted with only that id
// ---------------------------------------------------------------------------
test('review: approve first, quit before second → one generation with one approved id', () => {
  const { root, home } = freshHome([
    'early quit after approve',
    'this one never gets reviewed',
  ]);
  try {
    // y\nq\n — approve first, quit on second
    const r = spawnSync(process.execPath, [BIN, 'review'], { cwd: root, input: 'y\nq\n', encoding: 'utf8' });
    assert.equal(r.status, 0, `process exited non-zero: ${r.stderr}`);

    const gens = listGenerations(home);
    assert.equal(gens.length, 1, `expected 1 generation, got ${gens.length}`);

    const gen = readGeneration(home, gens[0]);
    assert.ok(gen, 'generation lockfile readable');
    assert.equal(gen.mintedFrom.length, 1, 'mintedFrom has exactly one approved id');

    assert.match(r.stdout, /generation gen_001 minted from 1 approval/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
