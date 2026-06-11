import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addHookEntries, removeHookEntries } from '../../zuzuu/live/install.mjs';

const cmd = (ev) => `node /x/mns.mjs hook ${ev} --host gemini-cli || true`;

test('addHookEntries installs the shared shape for the given events; no permissions', () => {
  const s = addHookEntries({}, cmd, ['SessionStart', 'AfterAgent', 'BeforeTool']);
  assert.deepEqual(Object.keys(s.hooks).sort(), ['AfterAgent', 'BeforeTool', 'SessionStart']);
  assert.equal(s.hooks.BeforeTool[0].hooks[0].command, cmd('BeforeTool'));
  assert.equal(s.permissions, undefined, 'no Claude permission rules for other hosts');
});

test('addHookEntries is idempotent; removeHookEntries strips only ours', () => {
  const once = addHookEntries({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'user-hook' }] }] } }, cmd, ['SessionStart']);
  const twice = addHookEntries(once, cmd, ['SessionStart']);
  assert.equal(twice.hooks.SessionStart.length, 2, 'user hook + one mns hook, not duplicated');
  const removed = removeHookEntries(twice);
  assert.equal(removed.hooks.SessionStart.length, 1);
  assert.equal(removed.hooks.SessionStart[0].hooks[0].command, 'user-hook');
});

test('idempotent + removable with the REAL quoted command form (mns.mjs" hook)', () => {
  // the real enable command quotes the BIN path: node "/abs/bin/zuzuu.mjs" hook X --host h || true
  const real = (ev) => `node "/Users/x/bin/zuzuu.mjs" hook ${ev} --host gemini-cli || true`;
  const once = addHookEntries({}, real, ['SessionStart', 'BeforeTool']);
  const twice = addHookEntries(once, real, ['SessionStart', 'BeforeTool']);
  assert.equal(twice.hooks.SessionStart.length, 1, 'no duplicate on re-enable');
  assert.equal(twice.hooks.BeforeTool.length, 1);
  const removed = removeHookEntries(twice);
  assert.equal(removed.hooks, undefined, 'disable removed all mns hooks');
});
