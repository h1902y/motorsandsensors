// `mns doctor` — environment health + session sanity. Exits non-zero only on
// real problems (warnings don't fail). Phase 2 will also reconcile lost sessions.

import { mkdirSync, accessSync, constants } from 'node:fs';
import { join } from 'node:path';
import { detected } from '../../experiments/experiment-1-trace-capture/adapters/registry.mjs';
import { paths, gitInfo } from '../store.mjs';
import { listLive } from '../live/live-store.mjs';
import { reconcile } from '../live/reconcile.mjs';
import { planScaffold, homeExists } from '../scaffold.mjs';
import { loadRegistry } from '../knowledge/registry.mjs';
import { allItems } from '../knowledge/items.mjs';
import { listProposals } from '../knowledge/proposals.mjs';
import { detectEmbedder } from '../knowledge/embed.mjs';
import { activeGeneration, readGeneration, snapshotFaculties } from '../faculty/generation.mjs';

/**
 * Pure drift checker (WS3-T3). Compares the current faculty hashes against the
 * active generation's pinned `faculties` manifest. Fail-open: any error returns
 * { error } rather than throwing.
 *
 * Returns:
 *   { noneActive: true }            — no generation pinned yet
 *   { generationId, drifted: [] }   — active gen, drifted items (may be empty)
 *   { error }                       — unexpected failure (fail-open)
 *
 * Each drifted entry: { id, faculty, reason: 'hash_changed'|'added'|'removed',
 *                        pinned?: string, current?: string }
 */
export function detectDrift(mnsDir) {
  try {
    const genId = activeGeneration(mnsDir);
    if (!genId) return { noneActive: true };

    const lockfile = readGeneration(mnsDir, genId);
    if (!lockfile) return { noneActive: true };

    const current = snapshotFaculties(mnsDir);
    const pinned = lockfile.faculties || {};
    const drifted = [];

    // Compare per-faculty item arrays (knowledge, actions, memory).
    for (const faculty of ['knowledge', 'actions', 'memory']) {
      const pinnedItems = (pinned[faculty]?.items ?? []);
      const currentItems = (current[faculty]?.items ?? []);

      const pinnedMap = new Map(pinnedItems.map((i) => [i.id, i.hash]));
      const currentMap = new Map(currentItems.map((i) => [i.id, i.hash]));

      // Check for changed or removed items
      for (const [id, hash] of pinnedMap) {
        if (!currentMap.has(id)) {
          drifted.push({ id, faculty, reason: 'removed', pinned: hash });
        } else if (currentMap.get(id) !== hash) {
          drifted.push({ id, faculty, reason: 'hash_changed', pinned: hash, current: currentMap.get(id) });
        }
      }

      // Check for added items
      for (const [id, hash] of currentMap) {
        if (!pinnedMap.has(id)) {
          drifted.push({ id, faculty, reason: 'added', current: hash });
        }
      }
    }

    // Compare single-file faculties (guardrails.rulesHash, instructions.projectHash)
    const singleFile = [
      { faculty: 'guardrails', field: 'rulesHash' },
      { faculty: 'instructions', field: 'projectHash' },
    ];
    for (const { faculty, field } of singleFile) {
      const pinnedHash = pinned[faculty]?.[field] ?? null;
      const currentHash = current[faculty]?.[field] ?? null;
      if (pinnedHash !== currentHash) {
        drifted.push({ id: field, faculty, reason: 'hash_changed', pinned: pinnedHash, current: currentHash });
      }
    }

    // Compare knowledge.registryHash
    const pinnedReg = pinned.knowledge?.registryHash ?? null;
    const currentReg = current.knowledge?.registryHash ?? null;
    if (pinnedReg !== currentReg) {
      drifted.push({ id: 'registryHash', faculty: 'knowledge', reason: 'hash_changed', pinned: pinnedReg, current: currentReg });
    }

    return { generationId: genId, drifted };
  } catch (err) {
    return { error: String(err) };
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

  console.log('mns doctor\n');

  // Node
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 21) ok(`Node ${process.versions.node}`);
  else if (major >= 20) warn(`Node ${process.versions.node} — capture works; \`npm test\` glob needs ≥21`);
  else bad(`Node ${process.versions.node} — too old, please use ≥20 (22 LTS recommended)`);

  // git
  const { commit, branch } = gitInfo();
  if (commit) ok(`git repo on ${branch} @ ${commit.slice(0, 8)}`);
  else info("not a git repo — capture works; sessions just won’t link to a commit");

  // .mns writable
  const { dir } = paths();
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
    ok(`.mns/ writable (${dir})`);
  } catch {
    bad(`.mns/ not writable (${dir})`);
  }

  // faculty home (served by `mns init`)
  const root = paths().root;
  if (!homeExists(root)) {
    warn('no faculty home — run `mns init` to scaffold knowledge/memory/actions/instructions');
  } else {
    const missing = planScaffold(root);
    const gaps = missing.dirs.length + missing.files.length + (missing.manifestMissing ? 1 : 0);
    if (gaps) warn(`faculty home incomplete (${gaps} piece(s) missing) — rerun \`mns init\``);
    else ok('faculty home complete (knowledge/ memory/ actions/ instructions/ guardrails/)');
  }

  // knowledge faculty
  if (homeExists(root)) {
    const reg = loadRegistry(join(root, '.mns'));
    if (!reg.ok) bad('knowledge registry unparseable');
    else {
      const { items, errors } = allItems(join(root, '.mns'));
      if (errors.length) warn(`${errors.length} knowledge item(s) unparseable`);
      const pending = listProposals(join(root, '.mns')).length;
      ok(`knowledge: ${items.length} item(s), ${pending} pending proposal(s)${pending ? ' — run \`mns review\`' : ''}`);
      const e = await detectEmbedder();
      if (!e.available) warn(`semantic search off — ${e.reason}`);
      else ok(`embeddings available (ollama/${e.model})`);
    }
  }

  // hosts
  const hosts = detected();
  if (hosts.length) ok(`hosts detected: ${hosts.map((h) => h.name).join(', ')}`);
  else warn('no supported agent data found — use Claude Code or Gemini CLI, then `mns capture`');

  // generation drift check (WS3-T3)
  try {
    const { dir: mnsDir } = paths();
    const drift = detectDrift(mnsDir);
    if (drift.noneActive) {
      info('generation: no generation pinned yet — run `mns generation mint`');
    } else if (drift.error) {
      warn(`generation drift check failed: ${drift.error}`);
    } else if (drift.drifted.length === 0) {
      ok(`generation ${drift.generationId} — no faculty drift`);
    } else {
      warn(`generation ${drift.generationId} — ${drift.drifted.length} drifted item(s):`);
      for (const d of drift.drifted) {
        info(`  drift: ${d.faculty}/${d.id} (${d.reason})`);
      }
    }
  } catch {
    /* drift check must never break doctor — fail-open */
  }

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
