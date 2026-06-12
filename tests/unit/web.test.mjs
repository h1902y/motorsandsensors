import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { web } from '../../zuzuu/commands/web.mjs';

// A deps recorder: every external effect is captured; nothing real runs.
function fakeDeps(over = {}) {
  const calls = [];
  const deps = {
    resolveBundled: () => over.bundled ?? null,
    detect: () => over.detect ?? true,
    install: () => { calls.push(['install']); return over.install ?? true; },
    prompt: () => over.prompt ?? 'y',
    launch: ({ cwd, binScript }) => { calls.push(['launch', cwd, binScript ?? null]); },
    log: () => {},
  };
  return { calls, deps };
}

test('bundled optional dep wins: launches its bin script, never detects/prompts/installs', () => {
  const { calls, deps } = fakeDeps({ bundled: '/g/node_modules/@zuzuucodes/web/bin/zuzuu-web.js' });
  let probed = false;
  deps.detect = () => { probed = true; return false; };
  web({}, deps);
  const launch = calls.find((c) => c[0] === 'launch');
  assert.ok(launch, 'launch called');
  assert.equal(launch[2], '/g/node_modules/@zuzuucodes/web/bin/zuzuu-web.js', 'bundled bin script passed to launch');
  assert.equal(probed, false, 'PATH detect skipped when bundled copy exists');
  assert.ok(!calls.some((c) => c[0] === 'install'), 'no install');
});

test('no bundled copy + PATH binary → launches without a bin script (PATH mode)', () => {
  const { calls, deps } = fakeDeps({ bundled: null, detect: true });
  web({}, deps);
  const launch = calls.find((c) => c[0] === 'launch');
  assert.equal(launch[2], null, 'no bin script → realLaunch falls back to the PATH binary');
});

test('detected → launches with resolved cwd, no install or prompt', () => {
  const { calls, deps } = fakeDeps({ detect: true });
  let prompted = false;
  deps.prompt = () => { prompted = true; return 'y'; };
  web({}, deps);
  assert.ok(!calls.some((c) => c[0] === 'install'), 'no install when already detected');
  assert.equal(prompted, false, 'no prompt when already detected');
  const launch = calls.find((c) => c[0] === 'launch');
  assert.ok(launch, 'launch called');
  assert.equal(launch[1], process.cwd(), 'launch dir = process.cwd()');
});

test('absent + prompt accepted → install then launch (order asserted)', () => {
  const { calls, deps } = fakeDeps({ detect: false, install: true });
  // after install, detect returns true
  let installed = false;
  deps.detect = () => installed;
  deps.install = () => { calls.push(['install']); installed = true; return true; };
  web({}, deps);
  const kinds = calls.map((c) => c[0]);
  assert.ok(kinds.includes('install'), 'install ran');
  assert.ok(kinds.includes('launch'), 'launch ran');
  const installIdx = kinds.indexOf('install');
  const launchIdx = kinds.indexOf('launch');
  assert.ok(installIdx < launchIdx, 'install comes before launch');
});

test('absent + prompt declined → neither install nor launch', () => {
  const { calls, deps } = fakeDeps({ detect: false, prompt: 'n' });
  deps.detect = () => false;
  web({}, deps);
  assert.ok(!calls.some((c) => c[0] === 'install'), 'no install when declined');
  assert.ok(!calls.some((c) => c[0] === 'launch'), 'no launch when declined');
});

test('args._[0] dir is resolved absolute and passed to launch', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'zuzuu-web-'));
  try {
    const { calls, deps } = fakeDeps({ detect: true });
    web({ _: [tmp] }, deps);
    const launch = calls.find((c) => c[0] === 'launch');
    assert.ok(launch, 'launch called');
    assert.equal(launch[1], resolve(tmp), 'launch dir = resolved absolute path');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('absent + prompt accepted + install fails → launch NOT called, failure logged', () => {
  const logs = [];
  const { calls, deps } = fakeDeps({ detect: false, install: false });
  deps.detect = () => false;
  deps.install = () => { calls.push(['install']); return false; };
  deps.log = (...m) => logs.push(m.join(' '));
  web({}, deps);
  assert.ok(calls.some((c) => c[0] === 'install'), 'install was attempted');
  assert.ok(!calls.some((c) => c[0] === 'launch'), 'launch NOT called after failed install');
  assert.ok(logs.some((l) => l.includes('install failed')), 'failure message logged');
});
