import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { code } from '../../mns/commands/code.mjs';

// A deps recorder: every external effect is captured; nothing real runs.
function fakeDeps(over = {}) {
  const calls = [];
  const deps = {
    detect: () => over.detect ?? true,
    install: () => { calls.push(['install']); return over.install ?? true; },
    prompt: () => over.prompt ?? 'y',
    runInit: (dir) => calls.push(['init', dir]),
    runEnable: (dir) => { calls.push(['enable', dir]); if (over.enableThrows) throw new Error('boom'); },
    launch: ({ cwd, model, passthrough }) => { calls.push(['launch', cwd, model, passthrough]); return over.launchCode ?? 0; },
    log: () => {},
  };
  return { calls, deps };
}
function withDir(fn, withMns = false) {
  const d = mkdtempSync(join(tmpdir(), 'mns-code-'));
  if (withMns) mkdirSync(join(d, '.mns'), { recursive: true });
  try { return fn(d); } finally { rmSync(d, { recursive: true, force: true }); }
}

test('launches opencode pre-wired: init (no .mns) + enable + launch with cwd', () => {
  withDir((d) => {
    const { calls, deps } = fakeDeps();
    const ex = code({ _: [d] }, deps);
    const kinds = calls.map((c) => c[0]);
    assert.ok(kinds.includes('init'), 'init called when .mns absent');
    assert.ok(kinds.includes('enable'), 'enable called');
    const launch = calls.find((c) => c[0] === 'launch');
    assert.equal(launch[1], d, 'launch cwd = resolved dir');
    assert.equal(ex, 0);
  });
});

test('existing .mns → init NOT called', () => {
  withDir((d) => {
    const { calls, deps } = fakeDeps();
    code({ _: [d] }, deps);
    assert.ok(!calls.some((c) => c[0] === 'init'), 'init skipped when .mns present');
  }, true);
});

test('opencode missing + prompt y + install ok → installs then launches', () => {
  withDir((d) => {
    let detected = false; // first detect false, true after install
    const { calls, deps } = fakeDeps({ install: true });
    deps.detect = () => { const r = detected; detected = true; return r; };
    code({ _: [d] }, deps);
    assert.ok(calls.some((c) => c[0] === 'install'), 'install ran');
    assert.ok(calls.some((c) => c[0] === 'launch'), 'launched after install');
  });
});

test('opencode missing + prompt n → exit 1, no launch', () => {
  withDir((d) => {
    const { calls, deps } = fakeDeps({ prompt: 'n' });
    deps.detect = () => false;
    const ex = code({ _: [d] }, deps);
    assert.equal(ex, 1);
    assert.ok(!calls.some((c) => c[0] === 'launch'), 'did not launch');
  });
});

test('--yes skips the prompt and installs directly when missing', () => {
  withDir((d) => {
    let detected = false;
    const { calls, deps } = fakeDeps();
    let prompted = false;
    deps.prompt = () => { prompted = true; return 'y'; };
    deps.detect = () => { const r = detected; detected = true; return r; };
    code({ _: [d], yes: true }, deps);
    assert.equal(prompted, false, 'no prompt with --yes');
    assert.ok(calls.some((c) => c[0] === 'install'));
  });
});

test('--model + passthrough reach launch', () => {
  withDir((d) => {
    const { calls, deps } = fakeDeps();
    code({ _: [d], model: 'openrouter/x', '--': ['--share'] }, deps);
    const launch = calls.find((c) => c[0] === 'launch');
    assert.equal(launch[2], 'openrouter/x', 'model forwarded');
    assert.deepEqual(launch[3], ['--share'], 'passthrough forwarded');
  });
});

test('enable throwing → still launches (fail-open)', () => {
  withDir((d) => {
    const { calls, deps } = fakeDeps({ enableThrows: true });
    const ex = code({ _: [d] }, deps);
    assert.ok(calls.some((c) => c[0] === 'launch'), 'launched despite enable failure');
    assert.equal(ex, 0);
  });
});

test('no such directory → exit 1', () => {
  const { calls, deps } = fakeDeps();
  const ex = code({ _: ['/no/such/dir/xyz-mns-code'] }, deps);
  assert.equal(ex, 1);
  assert.ok(!calls.some((c) => c[0] === 'launch'));
});
