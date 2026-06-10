// `mns enable` / `mns disable` — install/remove background lifecycle hooks in the
// project's Claude Code settings, entire.io-style: enable once, then capture is
// invisible. The hook command is wrapped so it ALWAYS exits 0 — if node or mns is
// missing it degrades silently and never breaks your agent.

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { repoRoot } from '../store.mjs';
import { addHooks, removeHooks, isInstalled, LIFECYCLE_EVENTS, GATE_EVENTS, addHookEntries, removeHookEntries } from '../live/install.mjs';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'mns.mjs');

// `|| true` → exit 0 even if node/mns is absent (graceful degradation).
const commandFor = (event) => `node "${BIN}" hook ${event} || true`;

// Gemini settings.json + Codex hooks.json share Claude's hook shape; only the
// path + event names differ. Events from the Phase-0 real-wire captures.
const HOST_HOOKS = {
  'gemini-cli': {
    file: (cwd) => join(repoRoot(cwd), '.gemini', 'settings.json'),
    events: ['SessionStart', 'AfterAgent', 'SessionEnd', 'BeforeTool'],
    note: 'fires headless + interactive; project-level honored',
  },
  codex: {
    file: (cwd) => join(repoRoot(cwd), '.codex', 'hooks.json'),
    events: ['SessionStart', 'Stop', 'PreToolUse'],
    note: 'INTERACTIVE only (codex exec fires no hooks); no clean end → `mns doctor` reconciles',
  },
};
const hostCommandFor = (host) => (event) => `node "${BIN}" hook ${event} --host ${host} || true`;

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

// --- OpenCode: install a project plugin (.opencode/plugin/mns.js) that fires the
// mns hook on lifecycle events. Spawns the real node (with node:sqlite), not bun.
const NODE = process.execPath;
const opencodePluginPath = (cwd) => join(repoRoot(cwd), '.opencode', 'plugin', 'mns.js');
const opencodePlugin = () => `// installed by \`mns enable --host opencode\` — live capture shim (graceful: never throws into OpenCode).
import { spawn } from "node:child_process";
const NODE = ${JSON.stringify(NODE)};
const MNS = ${JSON.stringify(BIN)};
const fire = (event, id) => { try { spawn(NODE, [MNS, "hook", event, "--host", "opencode", "--session", id], { stdio: "ignore", detached: true }).unref(); } catch {} };
export const Mns = async () => ({
  event: async ({ event }) => {
    try {
      const id = event?.properties?.sessionID;
      if (!id) return;
      if (event.type === "session.created") fire("session.created", id);
      else if (event.type === "session.idle") fire("session.idle", id);
      else if (event.type === "session.deleted") fire("session.deleted", id);
    } catch {}
  },
});
`;

export function enable(args = {}) {
  if (args.host === 'gemini-cli' || args.host === 'codex') {
    const spec = HOST_HOOKS[args.host];
    const path = spec.file();
    writeSettings(path, addHookEntries(readSettings(path), hostCommandFor(args.host), spec.events));
    console.log(`mns enabled — live capture + gate installed (${args.host})`);
    console.log(`  config : ${path}`);
    console.log(`  hooks  : ${spec.events.join(', ')}`);
    console.log(`  note   : ${spec.note}`);
    console.log(`  disable: mns disable --host ${args.host}`);
    return;
  }
  if ((args.host || 'claude-code') === 'opencode') {
    const path = opencodePluginPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, opencodePlugin());
    console.log('mns enabled for OpenCode — live capture plugin installed');
    console.log(`  plugin : ${path}`);
    console.log('  events : session.created → active · session.idle → re-capture (per turn)');
    console.log('  note   : no clean end signal — ended/killed sessions reconcile via `mns doctor`');
    console.log('  scope  : new OpenCode sessions in this repo; disable: mns disable --host opencode');
    return;
  }
  const path = settingsPath();
  writeSettings(path, addHooks(readSettings(path), commandFor));
  console.log('mns enabled — live capture installed (Claude Code)');
  console.log(`  settings : ${path}`);
  console.log(`  hooks    : ${[...LIFECYCLE_EVENTS, ...GATE_EVENTS].join(", ")}  (lifecycle + guardrails gate; exit 0 if mns absent)`);
  console.log('  scope    : new sessions in this repo (restart your agent to pick them up)');
  console.log('  disable  : mns disable');
}

export function disable(args = {}) {
  if (args.host === 'gemini-cli' || args.host === 'codex') {
    const path = HOST_HOOKS[args.host].file();
    if (!existsSync(path)) { console.log(`nothing to disable (no ${path})`); return; }
    writeSettings(path, removeHookEntries(readSettings(path)));
    console.log(`mns disabled — hooks removed from ${path}`);
    return;
  }
  if ((args.host || 'claude-code') === 'opencode') {
    const path = opencodePluginPath();
    if (existsSync(path)) rmSync(path, { force: true });
    console.log(`mns disabled for OpenCode — plugin removed (${path})`);
    return;
  }
  const path = settingsPath();
  if (!existsSync(path)) {
    console.log('nothing to disable (no .claude/settings.json)');
    return;
  }
  writeSettings(path, removeHooks(readSettings(path)));
  console.log(`mns disabled — lifecycle hooks removed from ${path}`);
}

export { isInstalled };
