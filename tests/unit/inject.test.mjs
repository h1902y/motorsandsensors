import { test } from 'node:test';
import assert from 'node:assert/strict';
import { facultiesBlock, injectBlock, removeBlock, hasBlock } from '../../mns/inject.mjs';

const USER = '# My project\n\nHand-written instructions the user owns.\n';

test('inject appends the block to existing content, user text intact', () => {
  const out = injectBlock(USER);
  assert.ok(out.startsWith(USER), 'user content first, untouched');
  assert.ok(hasBlock(out));
  assert.match(out, /mns — agent faculty home/);
});

test('inject into empty text yields just the block', () => {
  const out = injectBlock('');
  assert.ok(out.startsWith('<!-- >>> mns:faculties:v1 >>> -->'));
});

test('re-inject does not duplicate (replaces own block only)', () => {
  const once = injectBlock(USER);
  const twice = injectBlock(once);
  assert.equal((twice.match(/mns:faculties:v\d+/g) || []).length, 1);
  assert.ok(twice.startsWith(USER));
});

test('a newer block version replaces an older one in place', () => {
  const v1 = injectBlock(USER, facultiesBlock(1)) + '\n## User section after\n';
  const v2 = injectBlock(v1, facultiesBlock(2));
  assert.ok(v2.includes('mns:faculties:v2'));
  assert.ok(!v2.includes('mns:faculties:v1'));
  assert.ok(v2.includes('## User section after'), 'content after the block survives');
});

test('removeBlock strips our block and only our block', () => {
  const injected = injectBlock(USER);
  const removed = removeBlock(injected);
  assert.ok(!hasBlock(removed));
  assert.ok(removed.includes('Hand-written instructions'));
});
