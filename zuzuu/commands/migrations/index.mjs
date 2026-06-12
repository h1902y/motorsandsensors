// zuzuu/commands/migrations/index.mjs — `zuzuu migrate` dispatch.
//
//   (default)  proposal schema: legacy {candidate, er} → spine {payload, analysis, faculty}
//   --home     faculty home: visible agent/ → hidden .zuzuu/
//   --items    Faculty Standard: legacy faculty shapes → the envelope standard
//
// Pure cores live beside this file (proposals/home/items.mjs); this is the CLI
// surface — resolves paths, runs a core, prints the summary.

import { paths, repoRoot } from '../../core/store.mjs';
import { BLOCK_VERSION } from '../../home/inject.mjs';
import { migrateProposals } from './proposals.mjs';
import { migrateHome, reinjectHostBlocks } from './home.mjs';
import { migrateItems, needsItemsMigration } from './items.mjs';

export { migrateProposals } from './proposals.mjs';
export { migrateHome } from './home.mjs';
export { migrateItems, needsItemsMigration } from './items.mjs';

export function migrate(args = {}) {
  if (args.items) {
    const agentDir = paths().dir;
    const r = migrateItems(agentDir);
    const total = r.knowledge + r.memory + r.guardrails + r.actions + r.instructions;
    console.log(`migrate --items: ${total} item(s) → the Faculty Standard envelope — knowledge ${r.knowledge} · memory ${r.memory} · guardrails ${r.guardrails} · actions ${r.actions} · instructions ${r.instructions} (${r.skipped} already standard)`);
    if (r.manifests) console.log(`  seeded ${r.manifests} faculty manifest(s) (faculty.json — the Faculty Module contract)`);
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
    console.log('  legacy candidate/er keys rewritten to payload/analysis.er + faculty:knowledge');
  } else {
    console.log('  nothing to migrate (all records already in new shape)');
  }
}
