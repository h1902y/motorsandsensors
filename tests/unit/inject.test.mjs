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
  assert.match(out, /^<!-- >>> mns:faculties:v\d+ >>> -->/);
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

test('v4 block carries the ground/cite/harvest contract', () => {
  const out = injectBlock('# proj\n', facultiesBlock(4));
  assert.ok(out.includes('mns:faculties:v4'), 'is v4');
  assert.match(out, /digest/i);             // ground on the digest
  assert.match(out, /from knowledge:/);     // cite in-flight
  assert.match(out, /knowledge\/inbox\//);  // harvest at close
  assert.match(out, /mns review/);
});

test('a v3 block upgrades to v4 in place, user text intact', () => {
  const v3 = injectBlock('# proj\n', facultiesBlock(3)) + '\n## after\n';
  const v4 = injectBlock(v3, facultiesBlock(4));
  assert.ok(v4.includes('mns:faculties:v4'));
  assert.ok(!v4.includes('mns:faculties:v3'));
  assert.ok(v4.includes('## after'));
});

test('v5 block tells agents to propose actions via the gate', () => {
  const out = injectBlock('# proj\n');
  assert.ok(out.includes('mns:faculties:v5'), 'is v5');
  assert.match(out, /mns act propose/);
});

test('a v4 block upgrades to v5 in place', () => {
  const v4 = injectBlock('# proj\n', facultiesBlock(4)) + '\n## after\n';
  const v5 = injectBlock(v4);
  assert.ok(v5.includes('mns:faculties:v5'));
  assert.ok(!v5.includes('mns:faculties:v4'));
  assert.ok(v5.includes('## after'));
});
