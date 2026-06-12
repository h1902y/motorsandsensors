import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAction } from '../../zuzuu/actions/dispatch.mjs';

function withAction(slug, manifest, runBody, fn) {
  const root = mkdtempSync(join(tmpdir(), 'zuzuu-disp-'));
  const dir = join(root, '.zuzuu', 'actions', slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'action.json'), JSON.stringify({ slug, ...manifest }));
  writeFileSync(join(dir, 'run.mjs'), runBody);
  try {
    return fn(join(root, '.zuzuu'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('happy path: validates, runs main, returns structured value', async () => {
  await withAction(
    'greet',
    { inputs: { type: 'object', properties: { who: { type: 'string' } }, required: ['who'] },
      outputs: { type: 'object', properties: { msg: { type: 'string' } } } },
    `export async function main(args) { console.log('side log'); return { msg: 'hi ' + args.who }; }`,
    async (home) => {
      const r = await runAction(home, 'greet', { who: 'sam' });
      assert.equal(r.ok, true);
      assert.deepEqual(r.value, { msg: 'hi sam' });
      assert.match(r.logs, /side log/);
    },
  );
});

test('default_args fill in when caller omits them', async () => {
  await withAction(
    'greet2',
    { default_args: { who: 'world' },
      inputs: { type: 'object', properties: { who: { type: 'string' } }, required: ['who'] },
      outputs: { type: 'object' } },
    `export async function main(args) { return { who: args.who }; }`,
    async (home) => {
      const r = await runAction(home, 'greet2', {});
      assert.equal(r.ok, true);
      assert.deepEqual(r.value, { who: 'world' });
    },
  );
});

test('a marker-looking line on stderr does not spoof the result', async () => {
  await withAction('spoof',
    { inputs: { type: 'object' }, outputs: { type: 'object', properties: { real: { type: 'boolean' } } } },
    `export async function main(){ console.error('__ZUZUU_ACT_RESULT__' + JSON.stringify({ ok:true, value:{ real:false } })); return { real: true }; }`,
    async (home) => {
      const r = await runAction(home, 'spoof', {});
      assert.equal(r.ok, true);
      assert.deepEqual(r.value, { real: true }); // the real stdout marker, not the stderr fake
    });
});

test('a marker substring mid-log-line is ignored (anchored at line start)', async () => {
  await withAction('embed',
    { inputs: { type: 'object' }, outputs: { type: 'object', properties: { done: { type: 'boolean' } } } },
    `export async function main(){ console.log('note: __ZUZUU_ACT_RESULT__ appears here'); return { done: true }; }`,
    async (home) => {
      const r = await runAction(home, 'embed', {});
      assert.equal(r.ok, true);
      assert.deepEqual(r.value, { done: true });
    });
});

test('a hung action times out cleanly (never hangs home)', async () => {
  await withAction('hang',
    { inputs: { type: 'object' }, outputs: { type: 'object' } },
    `export async function main(){ await new Promise(r => setInterval(r, 1e9)); }`,
    async (home) => {
      const r = await runAction(home, 'hang', {}, { timeoutMs: 500 });
      assert.equal(r.ok, false);
      assert.equal(r.error, 'timeout');
    });
});

test('invalid_input: missing required arg, action never runs', async () => {
  await withAction(
    'needs',
    { inputs: { type: 'object', properties: { x: { type: 'integer' } }, required: ['x'] }, outputs: { type: 'object' } },
    `export async function main() { return { ran: true }; }`,
    async (home) => {
      const r = await runAction(home, 'needs', {});
      assert.equal(r.ok, false);
      assert.equal(r.error, 'invalid_input');
    },
  );
});

test('invalid_output: main returns a non-object / schema mismatch', async () => {
  await withAction(
    'badout',
    { inputs: { type: 'object' }, outputs: { type: 'object', properties: { n: { type: 'integer' } } } },
    `export async function main() { return { n: 'not-an-int' }; }`,
    async (home) => {
      const r = await runAction(home, 'badout', {});
      assert.equal(r.ok, false);
      assert.equal(r.error, 'invalid_output');
    },
  );
});

test('throw-to-fail: a throwing action becomes script_error', async () => {
  await withAction(
    'boom',
    { inputs: { type: 'object' }, outputs: { type: 'object' } },
    `export async function main() { throw new Error('kaboom'); }`,
    async (home) => {
      const r = await runAction(home, 'boom', {});
      assert.equal(r.ok, false);
      assert.equal(r.error, 'script_error');
      assert.match(r.detail, /kaboom/);
    },
  );
});

test('not_found for a slug with no action.json', async () => {
  await withAction('x', { inputs: { type: 'object' }, outputs: { type: 'object' } },
    `export async function main(){ return {}; }`,
    async (home) => {
      assert.equal((await runAction(home, 'nope', {})).error, 'not_found');
    });
});

test('prepareArguments folds legacy args before validation', async () => {
  await withAction(
    'legacy',
    { inputs: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }, outputs: { type: 'object' } },
    `export function prepareArguments(a){ return a.fullName ? { name: a.fullName } : a; }
     export async function main(args){ return { name: args.name }; }`,
    async (home) => {
      const r = await runAction(home, 'legacy', { fullName: 'Ada' });
      assert.equal(r.ok, true);
      assert.deepEqual(r.value, { name: 'Ada' });
    },
  );
});

test('depth cap: ZUZUU_ACT_DEPTH at the limit refuses', async () => {
  await withAction('deep', { inputs: { type: 'object' }, outputs: { type: 'object' } },
    `export async function main(){ return {}; }`,
    async (home) => {
      const prev = process.env.ZUZUU_ACT_DEPTH;
      process.env.ZUZUU_ACT_DEPTH = '8';
      try {
        const r = runAction(home, 'deep', {});
        assert.equal(r.ok, false);
        assert.equal(r.error, 'depth_exceeded');
      } finally {
        if (prev === undefined) delete process.env.ZUZUU_ACT_DEPTH; else process.env.ZUZUU_ACT_DEPTH = prev;
      }
    });
});
