// zuzuu/commands/migrations/index.mjs — `zuzuu migrate` dispatch.
//
//   (default)  proposal schema: legacy {candidate, er} → spine {payload, analysis, module}
//   --home     module home: visible agent/ → hidden .zuzuu/
//   --items    Module Standard: legacy module shapes → the envelope standard
//   --modules  faculty→module noun rename: faculty: keys, faculty.json, the
//              proposal field + the generation lockfile section
//
// Pure cores live beside this file (proposals/home/items/modules.mjs); this is
// the CLI surface — resolves paths, runs a core, prints the summary.

import { paths, repoRoot } from '../../core/store.mjs';
import { BLOCK_VERSION } from '../../home/inject.mjs';
import { migrateProposals } from './proposals.mjs';
import { migrateHome, reinjectHostBlocks } from './home.mjs';
import { migrateItems, needsItemsMigration } from './items.mjs';
import { migrateModules, needsModulesMigration } from './modules.mjs';
import { migrateGenerations, needsGenerationsMigration } from './generations.mjs';

export { migrateProposals } from './proposals.mjs';
export { migrateHome } from './home.mjs';
export { migrateItems, needsItemsMigration } from './items.mjs';
export { migrateModules, needsModulesMigration } from './modules.mjs';
export { migrateGenerations, needsGenerationsMigration } from './generations.mjs';

export function migrate(args = {}) {
  if (args.generations) {
    const agentDir = paths().dir;
    const r = migrateGenerations(agentDir);
    if (!r.migrated && !r.errors.length) { console.log('migrate --generations: nothing to migrate (generations are already per-module)'); return; }
    const mods = r.modules.map((m) => `${m.module}→${m.generation} (${m.items} item${m.items === 1 ? '' : 's'})`).join(' · ');
    console.log(`migrate --generations: global → per-module — ${r.modules.length} module(s): ${mods || '(none)'}`);
    if (r.checkpoint) console.log(`  checkpoint ${r.checkpoint} pins every migrated module`);
    if (r.removedGlobal) console.log('  removed the old global .zuzuu/generations/');
    for (const e of r.errors) console.log(`  ✗ ${e.file}: ${e.error} — left in place; old generations/ kept, rerun \`zuzuu migrate --generations\``);
    return;
  }
  if (args.modules) {
    const agentDir = paths().dir;
    const r = migrateModules(agentDir);
    const total = r.items + r.manifests + r.proposals + r.generations + r.seeded;
    console.log(`migrate --modules: faculty → module — ${r.items} item(s) · ${r.manifests} manifest(s) (faculty.json → module.json) · ${r.proposals} proposal(s) · ${r.generations} generation lockfile(s) · ${r.seeded} seeded`);
    for (const e of r.errors) console.log(`  ✗ ${e.file}: ${e.error} — left in place; fix and rerun \`zuzuu migrate --modules\``);
    if (!total && !r.errors.length) console.log('  nothing to migrate (the home already speaks "module")');
    return;
  }
  if (args.items) {
    const agentDir = paths().dir;
    const r = migrateItems(agentDir);
    const total = r.knowledge + r.memory + r.guardrails + r.actions + r.instructions;
    console.log(`migrate --items: ${total} item(s) → the Module Standard envelope — knowledge ${r.knowledge} · memory ${r.memory} · guardrails ${r.guardrails} · actions ${r.actions} · instructions ${r.instructions} (${r.skipped} already standard)`);
    if (r.manifests) console.log(`  seeded ${r.manifests} module manifest(s) (module.json — the Module contract)`);
    for (const e of r.errors) console.log(`  ✗ ${e.file}: ${e.error}`);
    if (!total && !r.manifests && !r.errors.length) console.log('  nothing to migrate (the home already speaks the envelope)');
    return;
  }
  if (args.home) {
    const root = repoRoot(process.cwd());
    const { migrated } = migrateHome(root);
    if (!migrated) { console.log('migrate --home: nothing to do (already .zuzuu/, or no zuzuu home at agent/)'); return; }
    try { reinjectHostBlocks(root); } catch { /* fail-open */ }
    console.log(`migrate --home: agent/ → .zuzuu/ (hidden, like .git; block v${BLOCK_VERSION}, gitignore + deny rules rewritten)`);
    console.log('  transparency lives in porcelain now: zuzuu status · explain · digest');
    return;
  }
  const agentDir = paths().dir;
  const { scanned, migrated, skipped } = migrateProposals(agentDir);
  console.log(`migrate: scanned ${scanned} proposal(s) — migrated ${migrated}, skipped ${skipped}`);
  if (migrated > 0) {
    console.log('  legacy candidate/er keys rewritten to payload/analysis.er + module:knowledge');
  } else {
    console.log('  nothing to migrate (all records already in new shape)');
  }
}
