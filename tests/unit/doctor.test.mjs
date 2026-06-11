import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summaryLine } from '../../zuzuu/commands/doctor.mjs';

test('summary: clean when no problems and no warnings', () => {
  assert.match(summaryLine(0, 0), /all good/);
});

test('summary: does not say "all good" when warnings exist', () => {
  const s = summaryLine(0, 2);
  assert.doesNotMatch(s, /all good/);
  assert.match(s, /2 warning/);
});

test('summary: reports problems', () => {
  assert.match(summaryLine(1, 0), /1 problem/);
});
