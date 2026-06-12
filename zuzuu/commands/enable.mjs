// `mns enable` / `mns disable` — install/remove background lifecycle hooks in the
// project's Claude Code settings, entire.io-style: enable once, then capture is
// invisible. The hook command is wrapped so it ALWAYS exits 0 — if node or mns is
// missing it degrades silently and never breaks your agent.

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { repoRoot } from '../store.mjs';
import { addHooks, removeHooks, isInstalled, LIFECYCLE_EVENTS, GATE_EVENTS, addHookEntries, removeHookEntries } from '../live/install.mjs';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'zuzuu.mjs');

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
    note: 'INTERACTIVE only (codex exec fires no hooks); no clean end → `zuzuu doctor` reconciles',
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

// --- OpenCode: install a project plugin (.opencode/plugins/mns.js) that fires the
// mns hook on lifecycle events + gates tools. Spawns the real node (with node:sqlite), not bun.
// plural dir (.opencode/plugins/) is the documented default; singular (.opencode/plugin/) also loads
// but we migrate to plural on enable and clean both on disable.
const NODE = process.execPath;
const opencodePluginPath = (cwd) => join(repoRoot(cwd), '.opencode', 'plugins', 'mns.js');
const opencodeLegacyPluginPath = (cwd) => join(repoRoot(cwd), '.opencode', 'plugin', 'mns.js'); // pre-2026-06 singular
const opencodePlugin = () => `// installed by \`zuzuu enable --host opencode\` — live capture + guardrails gate (graceful: never breaks OpenCode).
import { spawn, spawnSync } from "node:child_process";
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
  // The guardrails gate: tool.execute.before fires for every tool (real-wire verified).
  // input = { tool, sessionID, callID }; output = { args }. Throw to block. Fail-open.
  "tool.execute.before": async (input, output) => {
    let deny = null;
    try {
      const payload = JSON.stringify({ tool_name: input?.tool, tool_input: output?.args, session_id: input?.sessionID });
      const res = spawnSync(NODE, [MNS, "hook", "PreToolUse", "--host", "opencode"], { input: payload, encoding: "utf8", timeout: 5000 });
      const out = (res && res.stdout) || "";
      let decision = null;
      for (const line of out.split("\\n")) { const t = line.trim(); if (t.startsWith("{")) { try { decision = JSON.parse(t); } catch {} } }
      if (decision && decision.decision === "deny") deny = decision.reason || "blocked by zuzuu guardrail";
    } catch { /* any gate/spawn error fails OPEN (deny stays null → tool proceeds) */ }
    // Throw OUTSIDE the try: only an intentional deny blocks; an engine error can never be mistaken for one.
    if (deny) throw new Error(deny);
  },
});
`;

const piExtPath = (cwd) => join(repoRoot(cwd), '.pi', 'extensions', 'mns.ts');
const piExtension = () => `// installed by \`zuzuu enable --host pi\` — live capture + guardrails gate (graceful: never breaks pi).
import { spawn, spawnSync } from "node:child_process";
const NODE = ${JSON.stringify(NODE)};
const MNS = ${JSON.stringify(BIN)};
export default function (pi) {
  const fire = (event, ctx) => {
    try {
      const file = ctx?.sessionManager?.getSessionFile?.();
      if (!file) return;
      spawn(NODE, [MNS, "hook", event, "--host", "pi", "--session", file], { stdio: "ignore", detached: true }).unref();
    } catch {}
  };
  pi.on("session_start", async (_e, ctx) => fire("session_start", ctx));
  pi.on("turn_end", async (_e, ctx) => fire("turn_end", ctx));
  pi.on("session_shutdown", async (_e, ctx) => fire("session_shutdown", ctx));
  // gate: tool_call → run the shared mns gate; block on deny. Fail-open.
  pi.on("tool_call", async (event, ctx) => {
    try {
      const file = ctx?.sessionManager?.getSessionFile?.();
      const payload = JSON.stringify({ tool_name: event?.toolName, tool_input: event?.input, session_id: file });
      const res = spawnSync(NODE, [MNS, "hook", "PreToolUse", "--host", "pi"], { input: payload, encoding: "utf8", timeout: 5000 });
      const out = (res && res.stdout) || "";
      let decision = null;
      for (const line of out.split("\\n")) { const t = line.trim(); if (t.startsWith("{")) { try { decision = JSON.parse(t); } catch {} } }
      if (decision && decision.decision === "deny") return { block: true, reason: decision.reason || "blocked by zuzuu guardrail" };
    } catch {}
    return undefined; // allow / no-match / any error → proceed (fail-open)
  });
}
`;

export function enable(args = {}) {
  if (args.host === 'gemini-cli' || args.host === 'codex') {
    const spec = HOST_HOOKS[args.host];
    const path = spec.file();
    writeSettings(path, addHookEntries(readSettings(path), hostCommandFor(args.host), spec.events));
    console.log(`zuzuu enabled — live capture + gate installed (${args.host})`);
    console.log(`  config : ${path}`);
    console.log(`  hooks  : ${spec.events.join(', ')}`);
    console.log(`  note   : ${spec.note}`);
    console.log(`  disable: zuzuu disable --host ${args.host}`);
    return;
  }
  if ((args.host || 'claude-code') === 'opencode') {
    const say = args.quiet ? () => {} : console.log; // `mns code` wires quietly + prints its own summary
    const path = opencodePluginPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, opencodePlugin());
    const legacy = opencodeLegacyPluginPath();
    if (existsSync(legacy)) rmSync(legacy, { force: true }); // migrate singular → plural
    say('zuzuu enabled for OpenCode — live capture + guardrails gate installed');
    say(`  plugin : ${path}`);
    say('  events : session.created/idle/deleted (capture) · tool.execute.before (gate)');
    say('  note   : no clean end signal — ended/killed sessions reconcile via `zuzuu doctor`');
    say('  scope  : new OpenCode sessions in this repo; disable: zuzuu disable --host opencode');
    return;
  }
  if (args.host === 'pi') {
    const path = piExtPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, piExtension());
    console.log('zuzuu enabled for pi — live capture + guardrails gate installed');
    console.log(`  extension : ${path}`);
    console.log('  events    : session_start/turn_end/session_shutdown (capture) · tool_call (gate)');
    console.log('  note      : headless `pi -p` needs `--approve` to load project extensions; no clean end → `zuzuu doctor` reconciles');
    console.log('  disable   : zuzuu disable --host pi');
    return;
  }
  const path = settingsPath();
  writeSettings(path, addHooks(readSettings(path), commandFor));
  console.log('zuzuu enabled — live capture installed (Claude Code)');
  console.log(`  settings : ${path}`);
  console.log(`  hooks    : ${[...LIFECYCLE_EVENTS, ...GATE_EVENTS].join(", ")}  (lifecycle + guardrails gate; exit 0 if zuzuu absent)`);
  console.log('  scope    : new sessions in this repo (restart your agent to pick them up)');
  console.log('  disable  : zuzuu disable');
}

export function disable(args = {}) {
  if (args.host === 'gemini-cli' || args.host === 'codex') {
    const path = HOST_HOOKS[args.host].file();
    if (!existsSync(path)) { console.log(`nothing to disable (no ${path})`); return; }
    writeSettings(path, removeHookEntries(readSettings(path)));
    console.log(`zuzuu disabled — hooks removed from ${path}`);
    return;
  }
  if ((args.host || 'claude-code') === 'opencode') {
    let removed = false;
    for (const p of [opencodePluginPath(), opencodeLegacyPluginPath()]) {
      if (existsSync(p)) { rmSync(p, { force: true }); removed = true; }
    }
    console.log(removed ? 'zuzuu disabled for OpenCode — plugin removed' : 'nothing to disable (no OpenCode plugin)');
    return;
  }
  if (args.host === 'pi') {
    const path = piExtPath();
    if (existsSync(path)) { rmSync(path, { force: true }); console.log(`zuzuu disabled for pi — extension removed (${path})`); }
    else console.log('nothing to disable (no pi extension)');
    return;
  }
  const path = settingsPath();
  if (!existsSync(path)) {
    console.log('nothing to disable (no .claude/settings.json)');
    return;
  }
  writeSettings(path, removeHooks(readSettings(path)));
  console.log(`zuzuu disabled — lifecycle hooks removed from ${path}`);
}

export { isInstalled };
