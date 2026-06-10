#!/usr/bin/env node
// Playground runner. Discovers playground-N-*/play.mjs, runs each in its own
// process, and tallies pass / skip / fail by exit code (0 / 2 / other).
//
//   node tests/playground/run.mjs        # run all
//   node tests/playground/run.mjs 2      # run only playground-2-*

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { SKIP_CODE } from './_harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const only = process.argv[2]; // optional playground number

const dirs = readdirSync(HERE, { withFileTypes: true })
  .filter((d) => d.isDirectory() && /^playground-\d+-/.test(d.name))
  .map((d) => d.name)
  .filter((name) => !only || name.startsWith(`playground-${only}-`))
  .sort((a, b) => Number(a.match(/^playground-(\d+)/)[1]) - Number(b.match(/^playground-(\d+)/)[1]));

if (!dirs.length) {
  console.error(only ? `no playground matches number ${only}` : 'no playgrounds found');
  process.exit(1);
}

const results = [];
for (const name of dirs) {
  const play = join(HERE, name, 'play.mjs');
  if (!existsSync(play)) {
    results.push({ name, state: 'fail', reason: 'no play.mjs' });
    continue;
  }
  console.log(`\n${'═'.repeat(64)}\n${name}`);
  const { status } = spawnSync(process.execPath, [play], { stdio: 'inherit' });
  const state = status === 0 ? 'pass' : status === SKIP_CODE ? 'skip' : 'fail';
  results.push({ name, state });
}

const icon = { pass: '✅', skip: '⏭️ ', fail: '❌' };
console.log(`\n${'═'.repeat(64)}\nplayground summary`);
for (const r of results) console.log(`  ${icon[r.state]} ${r.name}${r.reason ? ' — ' + r.reason : ''}`);

const failed = results.filter((r) => r.state === 'fail').length;
const skipped = results.filter((r) => r.state === 'skip').length;
const passed = results.filter((r) => r.state === 'pass').length;
console.log(`\n${passed} passed, ${skipped} skipped, ${failed} failed`);
process.exit(failed ? 1 : 0);
