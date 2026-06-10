// mns/actions/dispatch.mjs
// runAction spawns the runner harness (a fresh node process — isolation + the
// _labs marker pattern), extracts the single result marker from stdout, and
// returns { ok, value|error, detail?, logs }. mns act is itself spawned by the
// host's Bash, so this is observe-not-drive: a CLI the agent calls, never a loop.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { loadManifest, actionsDir } from './manifest.mjs';
import { MARKER } from './marker.mjs';

const MAX_DEPTH = 8;
const MAX_BYTES = 50_000;
const MAX_LINES = 2000;
const ACTION_TIMEOUT_MS = 60_000;
const runnerPath = join(dirname(fileURLToPath(import.meta.url)), 'runner.mjs');

function truncate(s) {
  let out = s;
  if (out.length > MAX_BYTES) out = out.slice(0, MAX_BYTES) + '\n…[truncated]';
  const lines = out.split('\n');
  if (lines.length > MAX_LINES) out = lines.slice(0, MAX_LINES).join('\n') + '\n…[truncated]';
  return out;
}

function parseOutput(stdout) {
  const lines = stdout.split('\n');
  let parsed = null;
  const logLines = [];
  for (const line of lines) {
    if (line.startsWith(MARKER)) {
      try { parsed = JSON.parse(line.slice(MARKER.length)); } catch { /* keep last good */ }
    } else {
      logLines.push(line);
    }
  }
  return { parsed, logs: logLines.join('\n').trim() };
}

/**
 * Run an action by slug. Returns:
 *   { ok:true, value, logs } | { ok:false, error, detail?, logs }
 * error ∈ depth_exceeded | not_found | not_runnable | invalid_input |
 *         invalid_output | script_error | no_result | timeout | spawn_error | killed
 */
// Synchronous (spawnSync). Returns the result object directly.
export function runAction(mnsDir, slug, callerArgs = {}, { timeoutMs = ACTION_TIMEOUT_MS } = {}) {
  const depth = Number(process.env.MNS_ACT_DEPTH || 0);
  if (depth >= MAX_DEPTH) return { ok: false, error: 'depth_exceeded', detail: `depth ${depth} ≥ ${MAX_DEPTH}`, logs: '' };

  const manifest = loadManifest(mnsDir, slug);
  if (!manifest) return { ok: false, error: 'not_found', detail: `no action '${slug}' (missing action.json)`, logs: '' };

  const runPath = join(actionsDir(mnsDir), slug, 'run.mjs');
  if (!existsSync(runPath)) return { ok: false, error: 'not_runnable', detail: `'${slug}' has no run.mjs`, logs: '' };

  const payload = JSON.stringify({
    runPath,
    inputs: manifest.inputs ?? { type: 'object' },
    outputs: manifest.outputs ?? { type: 'object' },
    default_args: manifest.default_args ?? {},
    args: callerArgs ?? {},
  });

  const res = spawnSync(process.execPath, [runnerPath, payload], {
    cwd: mnsDir,
    encoding: 'utf8',
    env: { ...process.env, MNS_ACT_DEPTH: String(depth + 1) },
    maxBuffer: 64 * 1024 * 1024,
    timeout: timeoutMs,
    killSignal: 'SIGTERM',
  });

  if (res.error) {
    const timedOut = res.error.code === 'ETIMEDOUT';
    return { ok: false, error: timedOut ? 'timeout' : 'spawn_error', detail: timedOut ? `action exceeded ${timeoutMs}ms` : res.error.message, logs: '' };
  }
  if (res.signal) return { ok: false, error: 'killed', detail: `child killed by ${res.signal}`, logs: '' };

  const { parsed, logs: outLogs } = parseOutput(res.stdout || '');
  const errText = (res.stderr || '').trim();
  const logs = truncate([outLogs, errText].filter(Boolean).join('\n'));
  if (!parsed) return { ok: false, error: 'no_result', detail: 'action emitted no result marker', logs };
  return { ...parsed, logs };
}
