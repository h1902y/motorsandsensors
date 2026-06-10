import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addHookEntries, removeHookEntries } from '../../mns/live/install.mjs';

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
