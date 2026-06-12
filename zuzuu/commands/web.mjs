// `zuzuu web` — launch the visual workbench (@zuzuucodes/web).
// The workbench opens a browser-based UI and prints its own URL; zuzuu just starts it.
//
// Deliberate difference from code.mjs: NO init/enable here. The workbench home
// owns its own onboarding — this command's only job is: resolve, install-on-demand,
// and launch. Keeping it simple and side-effect-free avoids touching the faculty
// home in contexts where the workbench UI is the entry point.
//
// Packaging (decided 2026-06-12, ADK-style default-full): @zuzuucodes/web ships as
// an OPTIONAL dependency of this package — `npm i -g @zuzuucodes/cli` bundles the
// workbench; `--omit=optional` gives the light install. The CLI core never imports
// it and `dependencies` stays empty, so the zero-dep resilience guarantee holds:
// a failed native build (node-pty) can never break the CLI itself.
//
// Resolution order — npm does NOT put a dependency's bins on the global PATH, so:
//   1. the bundled optional dep (require.resolve from THIS package) → run its bin via node
//   2. a standalone `zuzuu-web` on PATH (separate global install)
//   3. neither → offer `npm i -g @zuzuucodes/web` (the light-install path)

import { readSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';

// --- default (real) deps; tests inject fakes for everything external ---

/** The bundled optional dep's bin script, or null when not installed/omitted. */
const realResolveBundled = () => {
  try {
    const req = createRequire(import.meta.url);
    const pkgPath = req.resolve('@zuzuucodes/web/package.json');
    const pkg = req('@zuzuucodes/web/package.json');
    const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.['zuzuu-web'];
    return bin ? join(dirname(pkgPath), bin) : null;
  } catch { return null; }
};
const realDetect = () => {
  try { return spawnSync('zuzuu-web', ['--version'], { stdio: 'ignore' }).status === 0; }
  catch { return false; }
};
const realInstall = () => {
  try { return spawnSync('npm', ['install', '-g', '@zuzuucodes/web'], { stdio: 'inherit' }).status === 0; }
  catch { return false; }
};
const realLaunch = ({ cwd, binScript }) => {
  // bundled bin script → run through node (it isn't on PATH); PATH binary → run directly
  if (binScript) spawn(process.execPath, [binScript, cwd], { detached: true, stdio: 'ignore' }).unref();
  else spawn('zuzuu-web', [cwd], { detached: true, stdio: 'ignore' }).unref();
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
 * Bundled-first: the optional dep wins; PATH install second; offer install last.
 */
export function web(args = {}, deps = {}) {
  const d = {
    resolveBundled: realResolveBundled,
    detect: realDetect,
    install: realInstall,
    launch: realLaunch,
    prompt: realPrompt,
    log: (...m) => console.log(...m),
    ...deps,
  };

  // 1. resolve the target directory
  const dir = args._?.[0] ? resolve(String(args._[0])) : process.cwd();

  // 2. find the workbench: bundled → PATH → install-on-demand
  let binScript = d.resolveBundled();
  if (!binScript && !d.detect()) {
    d.log("the workbench isn't installed (light install — @zuzuucodes/web was omitted).");
    const answer = d.prompt('install @zuzuucodes/web globally? [y/N]');
    if (answer !== 'y') {
      d.log('aborted — install with: npm i -g @zuzuucodes/web  (or reinstall the CLI without --omit=optional)');
      return;
    }
    if (!d.install()) {
      d.log('install failed — try: npm i -g @zuzuucodes/web');
      return;
    }
  }

  // 3. launch — zuzuu-web opens the browser and prints its URL
  d.log(`zuzuu web → launching visual workbench in ${dir} …`);
  d.log('  zuzuu-web will open your browser and print its URL.');
  d.launch({ cwd: dir, binScript });
}
