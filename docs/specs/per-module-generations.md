# Spec — Per-module generations + checkpoints (W2.5 Phase 2)

Status: in-progress (deleted on ship per docs canon). Correctness-critical: mutates
generation history; rollback restores bytes.

## Model
- **Module generation = the atom.** Per module, under the home (`.zuzuu/`):
  - `<module>/generations/<gen_NNN>.json` — lockfile
    `{ id, module, agent, mintedAt, forkedFrom, mintedFrom:[proposalIds], items:[{id,hash}] }`
  - `<module>/generations/snapshots/<gen_id>/<item-files>` — exact item bytes (byte-for-byte)
  - `<module>/generations/active` — `{ active: gen_id }`
  - Sequence is **per module** (knowledge@gen_006 while guardrails@gen_002). Independence is law:
    minting/rolling one module never reads or writes another.
- **Checkpoint = composition for whole-brain coherence.**
  - `checkpoints/<id>.json` = `{ id, createdAt, label?, pins:{ <module>: gen_id } }`
  - Mint = snapshot the current per-module actives into pins.
  - Rollback = for each pinned module → `rollbackModule(module, gen_id)` (restores each module's bytes + active).

## Module item layout (live paths, from the W24 envelope standard)
- knowledge → `knowledge/items/<id>.md`
- memory → `memory/entries/<id>.md`
- guardrails → `guardrails/items/<id>.md`
- instructions → `instructions/items/<id>.md`
- actions → `actions/<slug>/` (ACTION.md + *.mjs)

## Core API (`zuzuu/module/generation/`)
- `read.mjs`: per-module paths, item enumerators (reuse existing), `moduleItemFiles(agentDir, module)`,
  `snapshotModuleItems`, `activeModuleGeneration`, `listModuleGenerations`, `readModuleGeneration`,
  `diffModuleGenerations`. Also keeps `sha256`, `agentId`, `ensureAgent` helpers.
- `write.mjs`: `mintModuleGeneration(agentDir, module, {mintedFrom})`, `rollbackModule(agentDir, module, genId)`.
  Rollback restores snapshot bytes to live, archives displaced live items under `<module>/_rolledback/`,
  reindexes knowledge, flips that module's `active`.
- `checkpoint.mjs`: `mintCheckpoint(agentDir, {label})`, `listCheckpoints`, `readCheckpoint`,
  `rollbackCheckpoint(agentDir, id)`, `diffCheckpoint(agentDir, id)`.

## Review ceremony
After approvals, group approved proposal ids by module → mint each affected module's generation →
report "Knowledge → gen_006 (2) · Guardrails → gen_003 (1)". The old single global mint is removed.

## CLI
- `zuzuu module <m> generations [--json]` — list + active for that module
- `zuzuu module <m> generation show <id> [--json]`
- `zuzuu module <m> generation rollback <id> [--json]`
- `zuzuu checkpoint list | mint [--label X] | rollback <id> | show <id>  [--json]`
- OLD `zuzuu generation …` is **removed** (clean break) — `checkpoint` carries the global-compose role,
  `module <m> generation …` carries per-module.
- status: per-module actives + per-module drift. digest: note. doctor: per-module drift.

## Migrator (`migrate --generations`, folded into init auto-migrate after --modules)
For an existing home with OLD global `generations/<id>.json` + snapshots:
1. For each module the **active** global gen pinned (its `modules.<m>.items`), create
   `<module>/generations/gen_001.json` from the SAME snapshot bytes; rewrite those bytes'
   `faculty:`→`module:` during the copy (parser-valid on a future rollback). Set that module's active=gen_001.
   - Legacy hash-only sections (no `items[]`, e.g. `rulesHash`/`projectHash`) → gen_001 with empty items
     (nothing was pinned as an item). Snapshot whatever item bytes the snapshot dir holds.
2. Create `checkpoints/cp_001.json` pinning each migrated module→gen_001 (label "migrated from gen_001").
3. Remove the old global `generations/` dir.
4. Idempotent, fail-soft, summary.

## Daemon/web (light — Phase 3 builds rich UI)
- `GET /api/zuzuu/module/:key/generations` (list+active)
- `GET /api/zuzuu/checkpoints`
- protocol types `ModuleGenerationList`, `CheckpointList`.

## Data-loss invariants (adversarial review targets)
- Rollback restores byte-exact; displaced live items are MOVED (never deleted) to `<module>/_rolledback/`.
- Minting never overwrites an existing snapshot (next-seq id is fresh).
- Migrator never deletes the old global dir until every per-module gen_001 + the checkpoint landed.
- Corrupt lockfile → skip, never crash (fail-soft).
- Module independence: a knowledge op leaves guardrails active + files byte-identical.
</content>
