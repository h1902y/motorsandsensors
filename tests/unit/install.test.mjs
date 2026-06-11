import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addHooks, removeHooks, isInstalled, LIFECYCLE_EVENTS, SIGNATURE } from '../../zuzuu/live/install.mjs';

const commandFor = (e) => `node /x/bin/zuzuu.mjs hook ${e} || true`;
const hasSig = (s) => JSON.stringify(s).includes(SIGNATURE);

const NARROW_DENIES = ['Read(./agent/.traces/**)', 'Read(./agent/.live/**)'];

test('addHooks installs all lifecycle events + the narrowed deny rules', () => {
  const s = addHooks({}, commandFor);
  for (const ev of LIFECYCLE_EVENTS) assert.ok(s.hooks[ev].some((m) => m.hooks[0].command.includes(SIGNATURE)));
  for (const rule of NARROW_DENIES) assert.ok(s.permissions.deny.includes(rule), rule);
  // the faculty home must stay readable — no blanket agent/ or legacy .mns deny
  assert.ok(!s.permissions.deny.includes('Read(./.mns/**)'));
  assert.ok(isInstalled(s));
});

test('addHooks is idempotent (no duplicate entries / deny rules)', () => {
  const once = addHooks({}, commandFor);
  const twice = addHooks(once, commandFor);
  for (const ev of LIFECYCLE_EVENTS) assert.equal(twice.hooks[ev].filter((m) => m.hooks[0].command.includes(SIGNATURE)).length, 1);
  for (const rule of NARROW_DENIES) assert.equal(twice.permissions.deny.filter((r) => r === rule).length, 1);
});

test('addHooks scrubs ALL legacy .mns deny forms and adds the agent/ rules', () => {
  const legacy = { permissions: { deny: ['Read(./.mns/**)', 'Read(./.mns/traces/**)', 'Read(./.mns/live/**)', 'Read(./secrets/**)'] } };
  const s = addHooks(legacy, commandFor);
  for (const old of ['Read(./.mns/**)', 'Read(./.mns/traces/**)', 'Read(./.mns/live/**)'])
    assert.ok(!s.permissions.deny.includes(old), `legacy ${old} removed`);
  for (const rule of NARROW_DENIES) assert.ok(s.permissions.deny.includes(rule));
  assert.ok(s.permissions.deny.includes('Read(./secrets/**)'), 'user rules preserved');
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
