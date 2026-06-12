// `zuzuu web` — launch the visual workbench (@zuzuucodes/web) as a runtime peer.
// The workbench opens a browser-based UI and prints its own URL; zuzuu just starts it.
//
// Deliberate difference from code.mjs: NO init/enable here. The workbench home
// owns its own onboarding — this command's only job is: detect, install-on-demand,
// and launch. Keeping it simple and side-effect-free avoids touching the faculty
// home in contexts where the workbench UI is the entry point.
//
// Zero-dep: @zuzuucodes/web ships the `zuzuu-web` binary as a runtime PEER —
// detected, and installed on demand if missing — never an npm dependency.

import { readSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';

// --- default (real) deps; tests inject fakes for everything external ---
const realDetect = () => {
  try { return spawnSync('zuzuu-web', ['--version'], { stdio: 'ignore' }).status === 0; }
  catch { return false; }
};
const realInstall = () => {
  try { return spawnSync('npm', ['install', '-g', '@zuzuucodes/web'], { stdio: 'inherit' }).status === 0; }
  catch { return false; }
};
const realLaunch = (dir) => {
  spawn('zuzuu-web', [dir], { detached: true, stdio: 'ignore' }).unref();
};
// Synchronous y/n. Only reached when zuzuu-web is missing; the deps seam means
// tests never call this. Default to 'n' (safe — 'n' is the listed default [y/N]).
function realPrompt(q) {
  process.stdout.write(`${q} `);
  try {
    const b = Buffer.alloc(8);
    const n = readSync(0, b, 0, 8, null);
    return b.toString('utf8', 0, n).trim().toLowerCase().startsWith('y') ? 'y' : 'n';
  } catch { return 'n'; }
}

/**
 * `zuzuu web [dir]`
 * Launch the visual workbench for the given directory (default: cwd).
 * Installs @zuzuucodes/web on demand if absent.
 */
export function web(args = {}, deps = {}) {
  const d = {
    detect: realDetect,
    install: realInstall,
    launch: realLaunch,
    prompt: realPrompt,
    log: (...m) => console.log(...m),
    ...deps,
  };

  // 1. resolve the target directory
  const dir = args._?.[0] ? resolve(String(args._[0])) : process.cwd();

  // 2. ensure zuzuu-web (detect + install-on-demand)
  if (!d.detect()) {
    d.log("zuzuu-web isn't installed (@zuzuucodes/web).");
    const answer = d.prompt('install @zuzuucodes/web globally? [y/N]');
    if (answer !== 'y') {
      d.log('aborted — install with: npm i -g @zuzuucodes/web');
      return;
    }
    d.install();
  }

  // 3. launch — zuzuu-web opens the browser and prints its URL
  d.log(`zuzuu web → launching visual workbench in ${dir} …`);
  d.log('  zuzuu-web will open your browser and print its URL.');
  d.launch(dir);
}
