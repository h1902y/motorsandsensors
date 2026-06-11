import { test } from 'node:test';
import assert from 'node:assert/strict';
import { facultiesBlock, injectBlock, removeBlock, hasBlock } from '../../zuzuu/inject.mjs';

const USER = '# My project\n\nHand-written instructions the user owns.\n';

test('inject appends the block to existing content, user text intact', () => {
  const out = injectBlock(USER);
  assert.ok(out.startsWith(USER), 'user content first, untouched');
  assert.ok(hasBlock(out));
  assert.match(out, /zuzuu — agent faculty home/);
});

test('inject into empty text yields just the block', () => {
  const out = injectBlock('');
  assert.match(out, /^<!-- >>> zuzuu:faculties:v\d+ >>> -->/);
});

test('re-inject does not duplicate (replaces own block only)', () => {
  const once = injectBlock(USER);
  const twice = injectBlock(once);
  assert.equal((twice.match(/zuzuu:faculties:v\d+/g) || []).length, 1);
  assert.ok(twice.startsWith(USER));
});

test('a newer block version replaces an older one in place', () => {
  const v1 = injectBlock(USER, facultiesBlock(1)) + '\n## User section after\n';
  const v2 = injectBlock(v1, facultiesBlock(2));
  assert.ok(v2.includes('zuzuu:faculties:v2'));
  assert.ok(!v2.includes('zuzuu:faculties:v1'));
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
  assert.ok(out.includes('zuzuu:faculties:v4'), 'is v4');
  assert.match(out, /digest/i);             // ground on the digest
  assert.match(out, /from knowledge:/);     // cite in-flight
  assert.match(out, /knowledge\/inbox\//);  // harvest at close
  assert.match(out, /zuzuu review/);
});

test('a v3 block upgrades to v4 in place, user text intact', () => {
  const v3 = injectBlock('# proj\n', facultiesBlock(3)) + '\n## after\n';
  const v4 = injectBlock(v3, facultiesBlock(4));
  assert.ok(v4.includes('zuzuu:faculties:v4'));
  assert.ok(!v4.includes('zuzuu:faculties:v3'));
  assert.ok(v4.includes('## after'));
});

test('v8 block is the zuzuu marker + points to the digest + zuzuu commands', () => {
  const out = injectBlock('# proj\n');
  assert.ok(out.includes('zuzuu:faculties:v8'), 'is v8 zuzuu');
  assert.match(out, /zuzuu act propose/);
  assert.match(out, /agent\/\.live\/digest\.md/, 'Ground bullet points to the digest file');
});

test('REBRAND COMPAT: a legacy v7 mns:faculties block upgrades in place to v8 zuzuu (no duplicate)', () => {
  // hand-build the pre-rebrand v7 mns block (the marker name that exists in every prior project)
  const legacy = '<!-- >>> mns:faculties:v7 >>> -->\n## mns — agent faculty home\nold body\n<!-- <<< mns:faculties <<< -->';
  const doc = '# proj\n\n' + legacy + '\n\n## after\n';
  const out = injectBlock(doc);
  assert.ok(out.includes('zuzuu:faculties:v8'), 'upgraded to v8 zuzuu');
  assert.ok(!out.includes('mns:faculties'), 'the old mns marker is gone (replaced, not duplicated)');
  assert.equal((out.match(/>>> (?:mns|zuzuu):faculties/g) || []).length, 1, 'exactly ONE block');
  assert.ok(out.startsWith('# proj'), 'user heading intact');
  assert.ok(out.includes('## after'), 'trailing user content intact');
});

test('a v8 zuzuu block re-injects in place (idempotent)', () => {
  const once = injectBlock('# proj\n', facultiesBlock(8)) + '\n## after\n';
  const twice = injectBlock(once);
  assert.equal((twice.match(/zuzuu:faculties/g) || []).length, 2, 'one block = begin+end markers only');
  assert.ok(twice.includes('## after'));
});
