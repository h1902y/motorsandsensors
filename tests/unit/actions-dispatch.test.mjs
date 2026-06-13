import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAction } from '../../zuzuu/actions/dispatch.mjs';
import { serializeEnvelope } from '../../zuzuu/module/envelope.mjs';

// payload = ACTION.md envelope payload ({exec?, args?}); runBody = run.mjs source.
// NOTE: awaits fn — an async fn body must finish before the temp tree is removed.
async function withAction(slug, payload, runBody, fn) {
  const root = mkdtempSync(join(tmpdir(), 'zuzuu-disp-'));
  const dir = join(root, '.zuzuu', 'actions', slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'ACTION.md'), serializeEnvelope({
    id: slug, module: 'actions', kind: 'script', title: slug, status: 'active',
    created_at: '2026-06-12T00:00:00Z', payload, body: `runs ${slug}`,
  }));
  writeFileSync(join(dir, 'run.mjs'), runBody);
  try {
    return await fn(join(root, '.zuzuu'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('happy path: runs main, returns structured value + logs', async () => {
  await withAction(
    'greet',
    { exec: 'run.mjs' },
    `export async function main(args) { console.log('side log'); return { msg: 'hi ' + args.who }; }`,
    async (home) => {
      const r = await runAction(home, 'greet', { who: 'sam' });
      assert.equal(r.ok, true);
      assert.deepEqual(r.value, { msg: 'hi sam' });
      assert.match(r.logs, /side log/);
    },
  );
});

test('payload.args fill in when caller omits them (caller wins on conflict)', async () => {
  await withAction(
    'greet2',
    { exec: 'run.mjs', args: { who: 'world', tone: 'warm' } },
    `export async function main(args) { return { who: args.who, tone: args.tone }; }`,
    async (home) => {
      const r = await runAction(home, 'greet2', {});
      assert.equal(r.ok, true);
      assert.deepEqual(r.value, { who: 'world', tone: 'warm' });
      const r2 = await runAction(home, 'greet2', { who: 'sam' });
      assert.deepEqual(r2.value, { who: 'sam', tone: 'warm' });
    },
  );
});

test('a marker-looking line on stderr does not spoof the result', async () => {
  await withAction('spoof',
    {},
    `export async function main(){ console.error('__ZUZUU_ACT_RESULT__' + JSON.stringify({ ok:true, value:{ real:false } })); return { real: true }; }`,
    async (home) => {
      const r = await runAction(home, 'spoof', {});
      assert.equal(r.ok, true);
      assert.deepEqual(r.value, { real: true }); // the real stdout marker, not the stderr fake
    });
});

test('a marker substring mid-log-line is ignored (anchored at line start)', async () => {
  await withAction('embed',
    {},
    `export async function main(){ console.log('note: __ZUZUU_ACT_RESULT__ appears here'); return { done: true }; }`,
    async (home) => {
      const r = await runAction(home, 'embed', {});
      assert.equal(r.ok, true);
      assert.deepEqual(r.value, { done: true });
    });
});

test('a hung action times out cleanly (never hangs home)', async () => {
  await withAction('hang',
    {},
    `export async function main(){ await new Promise(r => setInterval(r, 1e9)); }`,
    async (home) => {
      const r = await runAction(home, 'hang', {}, { timeoutMs: 500 });
      assert.equal(r.ok, false);
      assert.equal(r.error, 'timeout');
    });
});

test('invalid_output: main returning a non-object still fails the contract', async () => {
  await withAction(
    'badout',
    {},
    `export async function main() { return 'just a string'; }`,
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
    {},
    `export async function main() { throw new Error('kaboom'); }`,
    async (home) => {
      const r = await runAction(home, 'boom', {});
      assert.equal(r.ok, false);
      assert.equal(r.error, 'script_error');
      assert.match(r.detail, /kaboom/);
    },
  );
});

test('not_found for a slug with no ACTION.md', async () => {
  await withAction('x', {},
    `export async function main(){ return {}; }`,
    async (home) => {
      assert.equal((await runAction(home, 'nope', {})).error, 'not_found');
    });
});

test('not_runnable: a path-escaping exec is refused; a missing exec file too', async () => {
  await withAction('sneaky', { exec: '../outside.mjs' },
    `export async function main(){ return {}; }`,
    async (home) => {
      const r = await runAction(home, 'sneaky', {});
      assert.equal(r.ok, false);
      assert.equal(r.error, 'not_runnable');
    });
  await withAction('gone', { exec: 'other.mjs' },
    `export async function main(){ return {}; }`,
    async (home) => {
      const r = await runAction(home, 'gone', {});
      assert.equal(r.ok, false);
      assert.equal(r.error, 'not_runnable');
    });
});

test('prepareArguments folds legacy args before main', async () => {
  await withAction(
    'legacy',
    {},
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
  await withAction('deep', {},
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
