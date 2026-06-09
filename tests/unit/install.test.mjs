import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addHooks, removeHooks, isInstalled, LIFECYCLE_EVENTS, SIGNATURE } from '../../mns/live/install.mjs';

const commandFor = (e) => `node /x/bin/mns.mjs hook ${e} || true`;
const hasSig = (s) => JSON.stringify(s).includes(SIGNATURE);

test('addHooks installs all lifecycle events + the deny rule', () => {
  const s = addHooks({}, commandFor);
  for (const ev of LIFECYCLE_EVENTS) assert.ok(s.hooks[ev].some((m) => m.hooks[0].command.includes(SIGNATURE)));
  assert.ok(s.permissions.deny.includes('Read(./.mns/**)'));
  assert.ok(isInstalled(s));
});

test('addHooks is idempotent (no duplicate entries / deny rules)', () => {
  const once = addHooks({}, commandFor);
  const twice = addHooks(once, commandFor);
  for (const ev of LIFECYCLE_EVENTS) assert.equal(twice.hooks[ev].filter((m) => m.hooks[0].command.includes(SIGNATURE)).length, 1);
  assert.equal(twice.permissions.deny.filter((r) => r === 'Read(./.mns/**)').length, 1);
});

test('addHooks preserves the user’s existing hooks; removeHooks keeps them', () => {
  const user = { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'my-guard.sh' }] }] } };
  const added = addHooks(user, commandFor);
  assert.ok(added.hooks.PreToolUse[0].hooks[0].command === 'my-guard.sh');
  const removed = removeHooks(added);
  assert.ok(removed.hooks.PreToolUse[0].hooks[0].command === 'my-guard.sh'); // user hook survives
  assert.ok(!hasSig(removed)); // all mns entries gone
  assert.ok(!isInstalled(removed));
});

test('removeHooks strips an mns-only settings back to empty', () => {
  const removed = removeHooks(addHooks({}, commandFor));
  assert.deepEqual(removed, {});
});
