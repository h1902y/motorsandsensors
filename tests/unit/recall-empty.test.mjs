import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recallEmptyMessage } from '../../zuzuu/commands/knowledge.mjs';

test('no items at all → points at remember', () => {
  assert.match(recallEmptyMessage({ itemCount: 0, query: 'foo' }), /no knowledge yet/i);
  assert.match(recallEmptyMessage({ itemCount: 0, query: 'foo' }), /mns remember/);
});

test('items exist but query missed → points at query/reindex', () => {
  const m = recallEmptyMessage({ itemCount: 5, query: 'foo' });
  assert.match(m, /no matches/i);
  assert.doesNotMatch(m, /no knowledge yet/i);
});
