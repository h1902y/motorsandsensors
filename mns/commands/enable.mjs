// `mns enable` / `mns disable` — install/remove background lifecycle hooks in the
// project's Claude Code settings, entire.io-style: enable once, then capture is
// invisible. The hook command is wrapped so it ALWAYS exits 0 — if node or mns is
// missing it degrades silently and never breaks your agent.

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { repoRoot } from '../store.mjs';
import { addHooks, removeHooks, isInstalled, LIFECYCLE_EVENTS } from '../live/install.mjs';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'mns.mjs');

// `|| true` → exit 0 even if node/mns is absent (graceful degradation).
const commandFor = (event) => `node "${BIN}" hook ${event} || true`;

function settingsPath(cwd) {
  return join(repoRoot(cwd), '.claude', 'settings.json');
}

function readSettings(path) {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

function writeSettings(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n');
}

export function enable() {
  const path = settingsPath();
  const next = addHooks(readSettings(path), commandFor);
  writeSettings(path, next);
  console.log('mns enabled — live capture installed');
  console.log(`  settings : ${path}`);
  console.log(`  hooks    : ${LIFECYCLE_EVENTS.join(', ')}  (graceful: exit 0 if mns absent)`);
  console.log('  scope    : new sessions in this repo (restart your agent to pick them up)');
  console.log('  disable  : mns disable');
}

export function disable() {
  const path = settingsPath();
  if (!existsSync(path)) {
    console.log('nothing to disable (no .claude/settings.json)');
    return;
  }
  writeSettings(path, removeHooks(readSettings(path)));
  console.log(`mns disabled — lifecycle hooks removed from ${path}`);
}

export { isInstalled };
