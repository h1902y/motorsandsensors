# WS3 — The Generation Model (Agent → Generation → Run) — Implementation Plan

> Part of the Faculty+Evolution Program. TDD; zero-dep; Node ≥22; commit per task; trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; explicit `git add`. Baseline: 247 tests on main.

**Goal:** Turn "evolve-in-place" into versioned generations. A **Generation** is an immutable lockfile pinning a per-faculty manifest of active item-ids + content hashes; `generations/active` is the pointer. Batch-approving proposals in `mns review` **mints** a generation; **rollback = flip the pointer + materialize files by hash**. A **Run** (= a Session in v1) pins the active generation at open, so every trace carries a `generation` foreign key.

**Key decisions (locked):** pin a manifest-of-ids+hashes (NOT a git commit); rollback restores file content by sha (from the proposal/content snapshot or `git cat-file`), never `git revert`; Session = Run in v1; `generations/active` is the single canonical pointer; mint snapshots item content so rollback works even on uncommitted blobs.

## On-disk
```
.mns/generations/            (tracked)
  active                      { "active": "gen_003" }     ← flip = rollback
  gen_001.json … gen_NNN.json (immutable lockfiles)
  snapshots/<gen>/<faculty>/<itemfile>   (content snapshot for hash-restore)
.mns/mns.json  v2:  + "agent": { "id": "agt_<repohash>", "createdAt", }   (activeGeneration mirrors generations/active, or omit — generations/active is canonical)
```

## Lockfile schema (`gen_NNN.json`, immutable)
```jsonc
{ "id":"gen_003", "agent":"agt_x", "mintedAt":"ISO", "forkedFrom":"gen_002",
  "mintedFrom":["prop-id-1","prop-id-2"],
  "faculties": {
    "knowledge":   { "registryHash":"sha256:…", "items":[{"id":"…","hash":"sha256:…"}] },
    "actions":     { "items":[{"id":"run-tests","hash":"sha256:…"}] },
    "guardrails":  { "rulesHash":"sha256:…" },
    "instructions":{ "projectHash":"sha256:…" },
    "memory":      { "items":[{"id":"…","hash":"sha256:…"}] } } }
```

---

## Task WS3-T1: the generation core + CLI
**Create** `mns/faculty/generation.mjs`, `mns/commands/generation.mjs`; **Modify** `mns/scaffold.mjs` (add `.mns/generations` + `generations/snapshots` to LAYOUT; bump `mns.json` to v2 with `agent.id`), `bin/mns.mjs`. **Test** `tests/unit/generation.test.mjs`.
- `generation.mjs`:
  - `snapshotFaculties(mnsDir)` → walk each faculty's active items (knowledge `items/*.md`, actions `<slug>/`, guardrails `rules.json`, instructions `project.md`, memory `entries/*.md`); compute sha256 (node:crypto) per item + the manifest object.
  - `mintGeneration(mnsDir, { forkedFrom, mintedFrom = [] })` → next `gen_NNN`, write lockfile + copy item content into `generations/snapshots/<gen>/`, set `active`. Returns the gen record.
  - `activeGeneration(mnsDir)` → read `generations/active` (null if none).
  - `listGenerations(mnsDir)`, `readGeneration(mnsDir, id)`.
  - `rollback(mnsDir, id)` → for each pinned item, restore its file from `snapshots/<id>/` (or `git cat-file -p <hash>` fallback); remove active items not in the target (move to archive, don't delete); `reindex` knowledge (import `index.mjs reindex`); flip `active` to `id`. Deterministic, git-native, zero `git revert`.
  - `agentId(mnsDir)` → stable `agt_<sha256(repoRoot)>` ; ensure in mns.json v2.
- `mns generation list|mint|rollback <id>` CLI (+ bin wiring + help).
- TDD: mint creates gen_001 + active points to it; a second mint → gen_002 forkedFrom gen_001; rollback to gen_001 restores an item that gen_002 changed + flips active; snapshot hashes are stable; `mns.json` becomes v2 with an agent id. **Existing tests green** (scaffold/init dir-count expectations updated for `generations/`).

## Task WS3-T2: batch-mint on review close
**Modify** `mns/commands/review.mjs`.
- Collect every approved proposal id during a review run (in-memory batch). On review close with a non-empty batch (including `q` quit with prior approvals), call `mintGeneration(mnsDir, { forkedFrom: activeGeneration(mnsDir), mintedFrom: batch })`. Print the minted gen id + a one-line summary.
- `gate.approve` still applies+archives per proposal (unchanged — files written immediately); the generation is the recorded snapshot of the resulting state.
- TDD: a piped review that approves 2 proposals mints exactly one generation whose `mintedFrom` lists both; a review with zero approvals mints nothing; `review-actions.test` stays green (assert no spurious mint on its flow OR update to expect a mint — pick the minimal honest change).

## Task WS3-T3: Run linkage + doctor drift
**Modify** `mns/session.mjs` (`makeSession` gains `generation = null`), `mns/store.mjs` (`upsertSession` persists `generation`), `mns/commands/hook.mjs` (OPEN pins `activeGeneration(cwd)` into the live/session record), `mns/commands/doctor.mjs` (verify no faculty hash drift vs the active generation; report drift, never auto-fix).
- TDD: `makeSession` defaults `generation:null` (existing `session.test`/`store.test` pass with the new field defaulted); a session opened under an active generation records that gen id; doctor flags a hand-edited item as drift.

## Verification
- `npm test` green each task (247 baseline + new; scaffold/session/store tests updated only for new fields/dirs). End-to-end: `mns review` (approve 2) → `mns generation list` shows gen_001(mintedFrom 2); edit an item → `mns doctor` reports drift; `mns generation rollback gen_001` restores + flips; a new session's index entry carries the generation id.

## Risks
- Rollback restoring by hash needs the content snapshot (mint copies it) — verify snapshot path resolves before trusting `git cat-file`. Mint-on-quit must mint for whatever was already applied (don't strand applied files outside any generation). Keep `generations/active` the single canonical pointer (mns.json mirror optional; if kept, update atomically).
