// `zuzuu doctor` — environment health + session sanity. Exits non-zero only on
// real problems (warnings don't fail). Phase 2 will also reconcile lost sessions.

import { mkdirSync, accessSync, constants } from 'node:fs';
import { detected } from '../capture/adapters/registry.mjs';
import { paths, gitInfo } from '../core/store.mjs';
import { listLive } from '../live/live-store.mjs';
import { reconcile } from '../live/reconcile.mjs';
import { planScaffold, homeExists } from '../home/scaffold.mjs';
import { modulesOf, hookFailures } from '../module/registry.mjs';
import { loadRegistry } from '../knowledge/registry.mjs';
import { allItems } from '../knowledge/items.mjs';
import { listProposals } from '../knowledge/proposals.mjs';
import { detectEmbedder } from '../knowledge/embed.mjs';
import {
  activeModuleGeneration, readModuleGeneration, snapshotModuleItems,
} from '../module/generation/read.mjs';
import { MODULES } from '../module/contract.mjs';
import { sessionStatus } from '../sessions/session-git.mjs';
import { leftoverLine } from './session.mjs';

/**
 * Pure PER-MODULE drift checker (W2.5 Phase 2). For each module with an active
 * generation, compares the current item hashes against that module's pinned
 * lockfile items. Module independence: each module is checked against its own
 * active generation. Fail-open: any error returns { error }, never throws.
 *
 * Returns:
 *   { noneActive: true }            — no module has a generation pinned yet
 *   { drifted: [] }                 — drifted items across modules (may be empty)
 *   { error }                       — unexpected failure (fail-open)
 *
 * Each drifted entry: { id, module, generation, reason:
 *   'hash_changed'|'added'|'removed', pinned?: string, current?: string }
 */
export function detectDrift(agentDir) {
  try {
    const drifted = [];
    let anyActive = false;

    for (const module of MODULES) {
      const genId = activeModuleGeneration(agentDir, module);
      if (!genId) continue;
      const lockfile = readModuleGeneration(agentDir, module, genId);
      if (!lockfile) continue;
      anyActive = true;

      const pinnedMap = new Map((lockfile.items ?? []).map((i) => [i.id, i.hash]));
      const currentMap = new Map(snapshotModuleItems(agentDir, module).map((i) => [i.id, i.hash]));

      for (const [id, hash] of pinnedMap) {
        if (!currentMap.has(id)) drifted.push({ id, module, generation: genId, reason: 'removed', pinned: hash });
        else if (currentMap.get(id) !== hash) drifted.push({ id, module, generation: genId, reason: 'hash_changed', pinned: hash, current: currentMap.get(id) });
      }
      for (const [id, hash] of currentMap) {
        if (!pinnedMap.has(id)) drifted.push({ id, module, generation: genId, reason: 'added', current: hash });
      }
    }

    if (!anyActive) return { noneActive: true };
    return { drifted };
  } catch (err) {
    return { error: String(err) };
  }
}

/**
 * Pure-ish: module-module health for doctor — broken manifests + recorded
 * hook failures become warnings (the module degraded to items-only);
 * declarative modules get an informational note. Fail-open: any error
 * returns empty lists rather than throwing into doctor.
 * @returns {{warnings: string[], notes: string[]}}
 */
export function moduleModuleHealth(agentDir) {
  try {
    const warnings = [];
    const notes = [];
    const entries = modulesOf(agentDir);
    for (const e of entries.filter((x) => x.manifestError)) {
      warnings.push(`module '${e.id}' module.json unreadable (${e.manifestError}) — module degraded to items-only`);
    }
    const declarative = entries.filter((x) => x.declarative && !x.manifestError);
    if (declarative.length) notes.push(`declarative modules: ${declarative.map((x) => x.id).join(', ')}`);
    for (const f of hookFailures()) {
      warnings.push(`module '${f.module}' hook ${f.hook} failed (${f.error}) — degraded, items-only`);
    }
    return { warnings, notes };
  } catch {
    return { warnings: [], notes: [] }; // module health must never break doctor
  }
}

/** The closing line: honest about warnings, never "all good" under them. */
export function summaryLine(problems, warnings) {
  if (problems) return `\n${problems} problem(s) found`;
  if (warnings) return `\n${warnings} warning(s) — see ⚠ above`;
  return '\nall good';
}

export async function doctor() {
  let problems = 0;
  let warnings = 0;
  const ok = (m) => console.log(`  ✓ ${m}`);
  const info = (m) => console.log(`  · ${m}`);
  const warn = (m) => {
    console.log(`  ⚠ ${m}`);
    warnings++;
  };
  const bad = (m) => {
    console.log(`  ✗ ${m}`);
    problems++;
  };

  console.log('zuzuu doctor\n');

  // Node
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 21) ok(`Node ${process.versions.node}`);
  else if (major >= 20) warn(`Node ${process.versions.node} — capture works; \`npm test\` glob needs ≥21`);
  else bad(`Node ${process.versions.node} — too old, please use ≥20 (22 LTS recommended)`);

  // git
  const { commit, branch } = gitInfo();
  if (commit) ok(`git repo on ${branch} @ ${commit.slice(0, 8)}`);
  else info("not a git repo — capture works; sessions just won’t link to a commit");

  // .zuzuu/ writable
  const { dir } = paths();
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
    ok(`.zuzuu/ writable (${dir})`);
  } catch {
    bad(`.zuzuu/ not writable (${dir})`);
  }

  // module home (served by `zuzuu init`)
  const root = paths().root;
  if (!homeExists(root)) {
    warn('no module home — run `zuzuu init` to scaffold knowledge/memory/actions/instructions');
  } else {
    const missing = planScaffold(root);
    const gaps = missing.dirs.length + missing.files.length + (missing.manifestMissing ? 1 : 0);
    if (gaps) warn(`module home incomplete (${gaps} piece(s) missing) — rerun \`zuzuu init\``);
    else ok('module home complete (knowledge/ memory/ actions/ instructions/ guardrails/)');
  }

  // modules (the Module contract): a broken manifest or a
  // failed hook degrades that module to items-only — surface it, never throw.
  if (homeExists(root)) {
    const health = moduleModuleHealth(dir);
    for (const w of health.warnings) warn(w);
    for (const n of health.notes) info(n);
  }

  // knowledge module
  if (homeExists(root)) {
    const reg = loadRegistry(dir);
    if (!reg.ok) bad('knowledge registry unparseable');
    else {
      const { items, errors } = allItems(dir);
      if (errors.length) warn(`${errors.length} knowledge item(s) unparseable`);
      const pending = listProposals(dir).length;
      ok(`knowledge: ${items.length} item(s), ${pending} pending proposal(s)${pending ? ' — run \`zuzuu review\`' : ''}`);
      const e = await detectEmbedder();
      if (!e.available) warn(`semantic search off — ${e.reason}`);
      else ok(`embeddings available (ollama/${e.model})`);
    }
  }

  // hosts
  const hosts = detected();
  if (hosts.length) ok(`hosts detected: ${hosts.map((h) => h.name).join(', ')}`);
  else warn('no supported agent data found — use Claude Code or Gemini CLI, then `zuzuu capture`');

  // per-module generation drift check (W2.5 Phase 2)
  try {
    const { dir: agentDir } = paths();
    const drift = detectDrift(agentDir);
    if (drift.noneActive) {
      info('generations: none pinned yet — approving in `zuzuu review` mints per-module generations');
    } else if (drift.error) {
      warn(`generation drift check failed: ${drift.error}`);
    } else if (drift.drifted.length === 0) {
      ok('generations: no module drift (every active generation matches its module)');
    } else {
      warn(`generation drift — ${drift.drifted.length} drifted item(s):`);
      for (const d of drift.drifted) {
        info(`  drift: ${d.module}/${d.id} vs ${d.generation} (${d.reason})`);
      }
    }
  } catch {
    /* drift check must never break doctor — fail-open */
  }

  // leftover session branch (a crashed session's zz/session-*) — surface the recovery path
  try {
    const ss = sessionStatus(process.cwd());
    const leftover = leftoverLine(ss);
    if (leftover) warn(leftover);
    else if (ss.active) info(`session branch ${ss.active.branch} checked out (${ss.active.checkpoints} checkpoint(s)) — squashes to ${ss.mainBranch ?? 'main'} at session end`);
  } catch { /* session-git check must never break doctor — fail-open */ }

  // live-session reconciliation: close out lost/killed sessions (no SessionEnd).
  const before = listLive().length;
  const reconciled = reconcile();
  if (reconciled.length) warn(`reconciled ${reconciled.length} lost session(s) → abandoned`);
  const live = listLive().length;
  if (live) ok(`${live} live session(s) active`);
  else if (!before) ok('no live sessions');

  console.log(summaryLine(problems, warnings));
  process.exit(problems ? 1 : 0);
}
