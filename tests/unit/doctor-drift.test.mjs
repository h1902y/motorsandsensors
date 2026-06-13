// Tests for detectDrift — the pure module-hash drift checker extracted from doctor.
// Verifies four paths:
//   1. No active generation → { noneActive: true }
//   2. Active generation, no edits → empty drifted array
//   3. Active generation, a knowledge item mutated → drifted contains that item
//   4. Item added after mint → appears in drifted (reason: 'added')
//   5. Item removed after mint → appears in drifted (reason: 'removed')

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mintGeneration } from '../../zuzuu/module/generation/write.mjs';
import { detectDrift } from '../../zuzuu/commands/doctor.mjs';

function withMns(fn) {
  const root = mkdtempSync(join(tmpdir(), 'zuzuu-drift-'));
  const agentDir = join(root, '.zuzuu');
  mkdirSync(agentDir, { recursive: true });
  try {
    return fn({ root, agentDir });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Populate a minimal module layout (knowledge items) so mintGeneration has content. */
function seedKnowledge(agentDir, items) {
  const dir = join(agentDir, 'knowledge', 'items');
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(items)) {
    writeFileSync(join(dir, name), content);
  }
}

test('detectDrift: no active generation → noneActive', () => {
  withMns(({ agentDir }) => {
    const result = detectDrift(agentDir);
    assert.equal(result.noneActive, true, 'should report noneActive when no generation is pinned');
    assert.equal(result.drifted, undefined);
  });
});

test('detectDrift: active generation with no edits → empty drifted array', () => {
  withMns(({ agentDir }) => {
    seedKnowledge(agentDir, { 'fact-a.md': 'content of fact A', 'fact-b.md': 'content of fact B' });
    mintGeneration(agentDir);
    const result = detectDrift(agentDir);
    assert.equal(result.noneActive, undefined, 'should not be noneActive');
    assert.ok(Array.isArray(result.drifted), 'drifted must be an array');
    assert.equal(result.drifted.length, 0, 'no drift when nothing changed');
  });
});

test('detectDrift: mutated knowledge item appears in drifted', () => {
  withMns(({ agentDir }) => {
    seedKnowledge(agentDir, { 'fact-a.md': 'original content', 'fact-b.md': 'stable content' });
    mintGeneration(agentDir);
    // Mutate one item after minting
    writeFileSync(join(agentDir, 'knowledge', 'items', 'fact-a.md'), 'CHANGED content');
    const result = detectDrift(agentDir);
    assert.ok(Array.isArray(result.drifted), 'drifted must be an array');
    assert.equal(result.drifted.length, 1, 'exactly one item drifted');
    const d = result.drifted[0];
    assert.equal(d.id, 'fact-a', 'drifted id should be fact-a');
    assert.equal(d.module, 'knowledge');
    assert.equal(d.reason, 'hash_changed');
    assert.ok(d.pinned, 'should include pinned hash');
    assert.ok(d.current, 'should include current hash');
    assert.notEqual(d.pinned, d.current, 'hashes should differ');
  });
});

test('detectDrift: new item added after mint appears in drifted', () => {
  withMns(({ agentDir }) => {
    seedKnowledge(agentDir, { 'fact-a.md': 'content A' });
    mintGeneration(agentDir);
    // Add a new item after minting
    writeFileSync(join(agentDir, 'knowledge', 'items', 'fact-new.md'), 'brand new');
    const result = detectDrift(agentDir);
    assert.ok(Array.isArray(result.drifted));
    const added = result.drifted.find((d) => d.id === 'fact-new');
    assert.ok(added, 'added item should appear in drifted');
    assert.equal(added.reason, 'added');
  });
});

test('detectDrift: item removed after mint appears in drifted', () => {
  withMns(({ agentDir }) => {
    seedKnowledge(agentDir, { 'fact-a.md': 'content A', 'fact-b.md': 'content B' });
    mintGeneration(agentDir);
    // Remove an item that was pinned
    rmSync(join(agentDir, 'knowledge', 'items', 'fact-b.md'));
    const result = detectDrift(agentDir);
    const removed = result.drifted.find((d) => d.id === 'fact-b');
    assert.ok(removed, 'removed item should appear in drifted');
    assert.equal(removed.reason, 'removed');
  });
});
