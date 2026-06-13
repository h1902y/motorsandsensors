import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { code } from '../../zuzuu/commands/code.mjs';
import { home } from '../helpers/home.mjs';

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
function withDir(fn, withHome = false) {
  const d = mkdtempSync(join(tmpdir(), 'zuzuu-code-'));
  if (withHome) mkdirSync(home(d), { recursive: true });
  try { return fn(d); } finally { rmSync(d, { recursive: true, force: true }); }
}

test('launches opencode pre-wired: init (no .zuzuu/) + enable + launch with cwd', () => {
  withDir((d) => {
    const { calls, deps } = fakeDeps();
    const ex = code({ _: [d] }, deps);
    const kinds = calls.map((c) => c[0]);
    assert.ok(kinds.includes('init'), 'init called when .zuzuu/ absent');
    assert.ok(kinds.includes('enable'), 'enable called');
    const launch = calls.find((c) => c[0] === 'launch');
    assert.equal(launch[1], d, 'launch cwd = resolved dir');
    assert.equal(ex, 0);
  });
});

test('existing .zuzuu/ → init NOT called', () => {
  withDir((d) => {
    const { calls, deps } = fakeDeps();
    code({ _: [d] }, deps);
    assert.ok(!calls.some((c) => c[0] === 'init'), 'init skipped when .zuzuu/ present');
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

test('prints a clean summary banner + launching line before launch', () => {
  withDir((d) => {
    const out = [];
    const { deps } = fakeDeps();
    deps.log = (...m) => out.push(m.join(' '));
    code({ _: [d] }, deps);
    const text = out.join('\n');
    assert.match(text, /module-equipped/, 'summary banner');
    assert.match(text, /capture \+ guardrails gate/, 'wired status');
    assert.match(text, /launching OpenCode in/, 'launching line');
  });
});

test('enable failure → summary shows degraded, still launches', () => {
  withDir((d) => {
    const out = [];
    const { calls, deps } = fakeDeps({ enableThrows: true });
    deps.log = (...m) => out.push(m.join(' '));
    code({ _: [d] }, deps);
    assert.match(out.join('\n'), /degraded/, 'degraded note shown');
    assert.ok(calls.some((c) => c[0] === 'launch'), 'still launches');
  });
});

test('no such directory → exit 1', () => {
  const { calls, deps } = fakeDeps();
  const ex = code({ _: ['/no/such/dir/xyz-home-code'] }, deps);
  assert.equal(ex, 1);
  assert.ok(!calls.some((c) => c[0] === 'launch'));
});
