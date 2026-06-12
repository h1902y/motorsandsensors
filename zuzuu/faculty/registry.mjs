// zuzuu/faculty/registry.mjs — the Faculty Module registry (2026-06-13 spec).
//
// Replaces the old scattered wiring (miners/registry self-registration,
// per-faculty adapter imports at every spine call site, digest's hardcoded
// sections): the five BUILT-IN modules are imported statically here; the spine
// (gate/review/proposals/eval/distill/digest/doctor) iterates THIS registry —
// no faculty names hardcoded outside built-in module files (ordering
// preferences excepted).
//
// Discovery beyond built-ins: any `<home>/<dir>/faculty.json` is parsed and
// listed as a DECLARATIVE faculty (manifest-only — items listing, card UI,
// schema validation, default digest line work today). Third-party CODE loading
// is explicitly deferred to W4.
//
// Host law: every hook invocation goes through invoke()/invokeTimeboxed() —
// try-wrapped (+ 5s time-box on miner-class hooks). A broken module degrades
// to items-only; failures are recorded and surfaced by `zuzuu doctor`.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FACULTIES } from './contract.mjs';
import { normalizeManifest, compatibleContract } from './module.mjs';
import * as knowledge from '../faculties/knowledge/index.mjs';
import * as memory from '../faculties/memory/index.mjs';
import * as actions from '../faculties/actions/index.mjs';
import * as instructions from '../faculties/instructions/index.mjs';
import * as guardrails from '../faculties/guardrails/index.mjs';

export const BUILTIN_MODULES = { knowledge, memory, actions, instructions, guardrails };

// Legacy adapter/miner walk order (the pre-module import order at every call
// site) — preserved so list/eval/distill outputs stay byte-identical.
const LEGACY_ORDER = ['knowledge', 'actions', 'guardrails', 'instructions', 'memory'];

// ---------------------------------------------------------------------------
// adapter surface (back-compat: gate/review/proposals/eval consume these)
// ---------------------------------------------------------------------------

/** Test/extension overrides layered over the built-ins. */
const overrides = new Map();

/**
 * Register an adapter override (keyed by adapter.name). Built-ins are always
 * present; this layers replacements/additions on top (tests, future plugins).
 */
export function register(adapter) {
  overrides.set(adapter.name, adapter);
}

/** Retrieve an adapter by faculty name (override > built-in). */
export function get(name) {
  return overrides.get(name) ?? BUILTIN_MODULES[name]?.adapter;
}

/** All adapters, built-ins first in the legacy order, then extra overrides. */
export function all() {
  const names = [...LEGACY_ORDER];
  for (const n of overrides.keys()) if (!names.includes(n)) names.push(n);
  return names.map(get).filter(Boolean);
}

// ---------------------------------------------------------------------------
// miner surface (replaces miners/registry.mjs)
// ---------------------------------------------------------------------------

/** All built-in miners in the legacy distill order. */
export function miners() {
  return LEGACY_ORDER.map((f) => BUILTIN_MODULES[f]?.miner).filter(Boolean);
}

/** The miner for a faculty, or undefined. */
export function minerOf(faculty) {
  return BUILTIN_MODULES[faculty]?.miner;
}

// ---------------------------------------------------------------------------
// faculty discovery — built-ins + declarative faculty.json folders
// ---------------------------------------------------------------------------

/** Read + normalize `<home>/<id>/faculty.json` → {manifest|null, error|null}. */
function readHomeManifest(agentDir, id) {
  const p = join(agentDir, id, 'faculty.json');
  if (!existsSync(p)) return { manifest: null, error: null };
  try {
    const manifest = normalizeManifest(JSON.parse(readFileSync(p, 'utf8')), id);
    if (!compatibleContract(manifest)) {
      return { manifest: null, error: `contract ${manifest.contract} unsupported by this host` };
    }
    return { manifest, error: null };
  } catch (e) {
    return { manifest: null, error: e.message ?? String(e) };
  }
}

// Home dirs that are never faculties.
const NON_FACULTY_DIRS = new Set(['generations']);

/**
 * Every faculty this home serves: the five built-ins (always — module code +
 * manifest, home faculty.json overriding the built-in manifest when present)
 * plus declarative manifest-only folders. Fail-soft: a broken faculty.json
 * lists the faculty with `manifestError` (degraded — doctor reports it).
 *
 * @param {string} agentDir
 * @returns {Array<{id, manifest, module, builtin, declarative, manifestSource, manifestError?}>}
 */
export function facultiesOf(agentDir) {
  const out = [];
  for (const id of FACULTIES) {
    const mod = BUILTIN_MODULES[id];
    const home = readHomeManifest(agentDir, id);
    out.push({
      id,
      builtin: true,
      declarative: false,
      module: mod,
      manifest: home.manifest ?? mod.manifest,
      manifestSource: home.manifest ? 'home' : 'builtin',
      ...(home.error ? { manifestError: home.error } : {}),
    });
  }
  try {
    for (const e of readdirSync(agentDir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name.startsWith('_')) continue;
      if (FACULTIES.includes(e.name) || NON_FACULTY_DIRS.has(e.name)) continue;
      const home = readHomeManifest(agentDir, e.name);
      if (!home.manifest && !home.error) continue; // no faculty.json → not a faculty
      out.push({
        id: e.name,
        builtin: false,
        declarative: true,
        module: null, // third-party CODE loading deferred to W4 — manifest-only today
        manifest: home.manifest ?? normalizeManifest({}, e.name),
        manifestSource: 'home',
        ...(home.error ? { manifestError: home.error } : {}),
      });
    }
  } catch { /* no home dir yet → built-ins only */ }
  return out;
}

/** One faculty entry by id (built-in or declarative), or null. */
export function facultyOf(agentDir, id) {
  return facultiesOf(agentDir).find((f) => f.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// fail-soft hook invocation (+ degradation record for doctor)
// ---------------------------------------------------------------------------

/** Miner-class hooks get a wall-clock budget (spec: 5s). */
export const MINER_HOOK_TIMEOUT_MS = 5000;

const failures = new Map(); // `${faculty}.${hook}` → { faculty, hook, error, at }

function recordFailure(faculty, hook, error) {
  failures.set(`${faculty}.${hook}`, { faculty, hook, error: String(error?.message ?? error), at: new Date().toISOString() });
}

/** Hook failures recorded this process — `zuzuu doctor` surfaces these. */
export function hookFailures() {
  return [...failures.values()];
}

/** Tests only: forget recorded failures. */
export function clearHookFailures() {
  failures.clear();
}

/**
 * Invoke a module hook fail-soft (synchronous spine paths: digest, gate,
 * signals). NEVER throws.
 * @param {{id:string, module:object|null}} entry  a facultiesOf() entry (or {id, module})
 * @returns {{ok:true, value:any} | {ok:false, missing?:true, error?:string}}
 */
export function invoke(entry, hook, ...args) {
  const fn = entry?.module?.[hook];
  if (typeof fn !== 'function') return { ok: false, missing: true };
  try {
    return { ok: true, value: fn(...args) };
  } catch (e) {
    recordFailure(entry.id ?? entry.module?.manifest?.id ?? '?', hook, e);
    return { ok: false, error: String(e?.message ?? e) };
  }
}

/**
 * Invoke a miner-class hook fail-soft WITH a time-box: synchronous throws are
 * caught; an async (Promise-returning) hook is raced against `timeoutMs`
 * (default 5s). NEVER rejects.
 * @returns {Promise<{ok:true, value:any} | {ok:false, missing?:true, timedOut?:true, error?:string}>}
 */
export async function invokeTimeboxed(entry, hook, args = [], { timeoutMs = MINER_HOOK_TIMEOUT_MS } = {}) {
  const fn = entry?.module?.[hook];
  if (typeof fn !== 'function') return { ok: false, missing: true };
  const faculty = entry.id ?? entry.module?.manifest?.id ?? '?';
  try {
    const r = fn(...args);
    if (!r || typeof r.then !== 'function') return { ok: true, value: r };
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ __zuzuuTimeout: true }), timeoutMs);
    });
    const settled = await Promise.race([Promise.resolve(r).catch((e) => ({ __zuzuuError: e })), timeout]);
    clearTimeout(timer);
    if (settled && settled.__zuzuuTimeout) {
      recordFailure(faculty, hook, `timed out after ${timeoutMs}ms`);
      return { ok: false, timedOut: true, error: `timed out after ${timeoutMs}ms` };
    }
    if (settled && settled.__zuzuuError !== undefined) {
      recordFailure(faculty, hook, settled.__zuzuuError);
      return { ok: false, error: String(settled.__zuzuuError?.message ?? settled.__zuzuuError) };
    }
    return { ok: true, value: settled };
  } catch (e) {
    recordFailure(faculty, hook, e);
    return { ok: false, error: String(e?.message ?? e) };
  }
}
