import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAction } from '../../zuzuu/actions/dispatch.mjs';

function withAction(slug, manifest, runBody, fn) {
  const root = mkdtempSync(join(tmpdir(), 'mns-disp-'));
  const dir = join(root, '.mns', 'actions', slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'action.json'), JSON.stringify({ slug, ...manifest }));
  writeFileSync(join(dir, 'run.mjs'), runBody);
  try {
    return fn(join(root, '.mns'));
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
    async (mns) => {
      const r = await runAction(mns, 'greet', { who: 'sam' });
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
    async (mns) => {
      const r = await runAction(mns, 'greet2', {});
      assert.equal(r.ok, true);
      assert.deepEqual(r.value, { who: 'world' });
    },
  );
});

test('a marker-looking line on stderr does not spoof the result', async () => {
  await withAction('spoof',
    { inputs: { type: 'object' }, outputs: { type: 'object', properties: { real: { type: 'boolean' } } } },
    `export async function main(){ console.error('__MNS_ACT_RESULT__' + JSON.stringify({ ok:true, value:{ real:false } })); return { real: true }; }`,
    async (mns) => {
      const r = await runAction(mns, 'spoof', {});
      assert.equal(r.ok, true);
      assert.deepEqual(r.value, { real: true }); // the real stdout marker, not the stderr fake
    });
});

test('a marker substring mid-log-line is ignored (anchored at line start)', async () => {
  await withAction('embed',
    { inputs: { type: 'object' }, outputs: { type: 'object', properties: { done: { type: 'boolean' } } } },
    `export async function main(){ console.log('note: __MNS_ACT_RESULT__ appears here'); return { done: true }; }`,
    async (mns) => {
      const r = await runAction(mns, 'embed', {});
      assert.equal(r.ok, true);
      assert.deepEqual(r.value, { done: true });
    });
});

test('a hung action times out cleanly (never hangs mns)', async () => {
  await withAction('hang',
    { inputs: { type: 'object' }, outputs: { type: 'object' } },
    `export async function main(){ await new Promise(r => setInterval(r, 1e9)); }`,
    async (mns) => {
      const r = await runAction(mns, 'hang', {}, { timeoutMs: 500 });
      assert.equal(r.ok, false);
      assert.equal(r.error, 'timeout');
    });
});

test('invalid_input: missing required arg, action never runs', async () => {
  await withAction(
    'needs',
    { inputs: { type: 'object', properties: { x: { type: 'integer' } }, required: ['x'] }, outputs: { type: 'object' } },
    `export async function main() { return { ran: true }; }`,
    async (mns) => {
      const r = await runAction(mns, 'needs', {});
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
    async (mns) => {
      const r = await runAction(mns, 'badout', {});
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
    async (mns) => {
      const r = await runAction(mns, 'boom', {});
      assert.equal(r.ok, false);
      assert.equal(r.error, 'script_error');
      assert.match(r.detail, /kaboom/);
    },
  );
});

test('not_found for a slug with no action.json', async () => {
  await withAction('x', { inputs: { type: 'object' }, outputs: { type: 'object' } },
    `export async function main(){ return {}; }`,
    async (mns) => {
      assert.equal((await runAction(mns, 'nope', {})).error, 'not_found');
    });
});

test('prepareArguments folds legacy args before validation', async () => {
  await withAction(
    'legacy',
    { inputs: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }, outputs: { type: 'object' } },
    `export function prepareArguments(a){ return a.fullName ? { name: a.fullName } : a; }
     export async function main(args){ return { name: args.name }; }`,
    async (mns) => {
      const r = await runAction(mns, 'legacy', { fullName: 'Ada' });
      assert.equal(r.ok, true);
      assert.deepEqual(r.value, { name: 'Ada' });
    },
  );
});

test('depth cap: MNS_ACT_DEPTH at the limit refuses', async () => {
  await withAction('deep', { inputs: { type: 'object' }, outputs: { type: 'object' } },
    `export async function main(){ return {}; }`,
    async (mns) => {
      const prev = process.env.MNS_ACT_DEPTH;
      process.env.MNS_ACT_DEPTH = '8';
      try {
        const r = runAction(mns, 'deep', {});
        assert.equal(r.ok, false);
        assert.equal(r.error, 'depth_exceeded');
      } finally {
        if (prev === undefined) delete process.env.MNS_ACT_DEPTH; else process.env.MNS_ACT_DEPTH = prev;
      }
    });
});
