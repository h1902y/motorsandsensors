// `mns code` — launch OpenCode as the bundled default host, pre-wired with the
// faculty home + the mns plugin (capture + gate + digest). We CONFIGURE + LAUNCH
// the real `opencode` binary; we never fork it and never drive it headlessly
// (the observe model; interactive-first). Stage 2 of the product sequence.
//
// Zero-dep: OpenCode is a runtime PEER — detected, and installed on demand if
// missing — never an npm dependency.

import { existsSync, readSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { init } from './init.mjs';
import { enable } from './enable.mjs';
import { repoRoot } from '../store.mjs';

// Run a command inside `dir` without permanently changing the process cwd —
// init/enable resolve their target from process.cwd(), so we chdir around them.
function inDir(dir, fn) {
  const prev = process.cwd();
  try { process.chdir(dir); return fn(); } finally { process.chdir(prev); }
}

// --- default (real) deps; tests inject fakes for everything external ---
const realDetect = () => { try { return spawnSync('opencode', ['--version'], { stdio: 'ignore' }).status === 0; } catch { return false; } };
const realInstall = () => { try { return spawnSync('npm', ['install', '-g', 'opencode-ai'], { stdio: 'inherit' }).status === 0; } catch { return false; } };
const realLaunch = ({ cwd, model, passthrough }) => {
  const a = [...(model ? ['-m', model] : []), ...(passthrough || [])];
  const r = spawnSync('opencode', a, { cwd, stdio: 'inherit' });
  return r.status ?? 0;
};
// Synchronous y/n. Only reached when opencode is missing AND not --yes; the deps
// seam means tests never call this. Default to 'y' if stdin can't be read.
function realPrompt(q) {
  process.stdout.write(`${q} `);
  try { const b = Buffer.alloc(8); const n = readSync(0, b, 0, 8, null); return b.toString('utf8', 0, n).trim().toLowerCase().startsWith('n') ? 'n' : 'y'; }
  catch { return 'y'; }
}

/**
 * `mns code [dir] [--model M] [--yes] [-- …opencode args]`
 * @returns process exit code (number) — bin calls process.exit(code(args)).
 */
export function code(args = {}, deps = {}) {
  const d = {
    detect: realDetect,
    install: realInstall,
    launch: realLaunch,
    prompt: realPrompt,
    runInit: (dir) => inDir(dir, () => init({ _: [] })),
    runEnable: (dir) => inDir(dir, () => enable({ host: 'opencode', quiet: true })),
    log: (...m) => console.log(...m),
    ...deps,
  };

  // 1. resolve the project dir
  const dir = args._?.[0] ? resolve(String(args._[0])) : process.cwd();
  if (!existsSync(dir)) { d.log(`mns code: no such directory: ${dir}`); return 1; }

  // 2. ensure the faculty home (only when absent — keeps output clean; init is idempotent)
  if (!existsSync(join(repoRoot(dir), '.mns'))) d.runInit(dir);

  // 3. ensure OpenCode (detect + install-on-demand)
  if (!d.detect()) {
    d.log("OpenCode isn't installed.");
    const consent = args.yes || args.y || d.prompt('Install it now? (npm i -g opencode-ai) [Y/n]') !== 'n';
    if (!consent || !d.install() || !d.detect()) {
      d.log('Install it with:  npm i -g opencode-ai');
      return 1;
    }
  }

  // 4. ensure the mns plugin (capture + gate + digest) — FAIL-OPEN: never block the launch
  let wired = true;
  try { d.runEnable(dir); } catch (e) { wired = false; d.log(`mns code: could not wire the mns plugin (${e?.message || e}) — launching unwired.`); }

  // a clean one-screen summary of what the newcomer just got (vs. the verbose enable output)
  d.log('mns code → OpenCode, faculty-equipped');
  d.log(`  ✓ faculty home (.mns/)   ${wired ? '✓ capture + guardrails gate   ✓ session grounding' : '⚠ plugin not wired (degraded)'}`);
  d.log(`  → launching OpenCode in ${dir} …`);

  // 5. launch the real OpenCode (configure + launch, never drive)
  return d.launch({ cwd: dir, model: args.model || null, passthrough: args['--'] || [] });
}
