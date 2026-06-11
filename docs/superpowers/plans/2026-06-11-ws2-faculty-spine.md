# WS2 — The Shared Faculty Spine — Implementation Plan

> Part of the Faculty+Evolution Remediation Program (`~/.claude/plans/tidy-sniffing-castle.md`). TDD; zero-dep (node:* only); Node ≥22; commit per task; trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; explicit `git add` (never -A).

**Goal:** Lift Knowledge's mature pipeline (inbox → proposal+provenance → review → active+archive, with a decision trail) into a shared `mns/faculty/` core that all five faculties use via a thin **Faculty Adapter**, so every faculty evolves consistently. Knowledge's specialists (registry/ER/SQLite), Actions' runner, and Guardrails' regex engine stay private behind adapters and keep working unchanged (186 tests stay green).

**Architecture:** A spine owns the unified **Proposal** record + lifecycle, **provenance**, a **trail**, and a generalized **`mns review`**. Each faculty exports `adapter.mjs` implementing `{ name, ingest, validate, apply, render }`. The spine never imports a faculty specialist; the arrow is adapter → spine and adapter → its own specialists.

## Unified Proposal record (`.mns/<faculty>/proposals/<id>.json`)
```jsonc
{ "id":"<slug>-<hash>", "faculty":"knowledge", "kind":"item|registry|action|rule|block|episode",
  "status":"pending|approved|rejected", "created_at":"ISO", "source":"agent|distill",
  "payload":{...}, "analysis":{...}, "evidence":{...}, "provenance":[{session,trace,ref}],
  "resolved_at":"ISO?", "applied":"str?", "reason":"str?" }
```
Knowledge's current record is a strict subset (`candidate`→`payload`, `er`→`analysis.er`); **dual-read** both old and new so existing `.mns/knowledge/proposals/archive/*.json` stay readable.

## Faculty Adapter interface
`{ name, ingest(mnsDir,raw)->{payload,analysis,dedupeKey}, validate(mnsDir,payload)->{ok,errors,warnings}, apply(mnsDir,proposal)->{ok,action,itemIds,warnings}, render(proposal)->{line,card} }`

---

## Task WS2-T1: spine skeleton (no behavior change)
**Create** `mns/faculty/{contract,proposal,provenance,trail,registry}.mjs`; **Test** `tests/unit/faculty-spine.test.mjs`.
- `contract.mjs` — canonical per-faculty paths: `inboxDir/proposalsDir/archiveDir(mnsDir,faculty)`.
- `proposal.mjs` — `makeProposal`, `readProposal` (**dual-read** `payload??candidate`, `analysis.er??er`), `listProposals(mnsDir,faculty)`, `writeProposal`, `archiveProposal(mnsDir,faculty,id,{status,reason,applied})`. Id scheme = existing `<slug>-<shortHash(slug+source)>`.
- `provenance.mjs` — `{session,trace,ref}` helpers (merge/dedupe).
- `trail.mjs` — `recordTrail(mnsDir,faculty,{kind,...})` → append `.mns/live/<faculty>.jsonl` (fail-soft, never throws); generalizes `mns/actions/trail.mjs`.
- `registry.mjs` — adapter registry: `register(adapter)`, `get(name)`, `all()`.
- TDD: round-trip a proposal (write→list→read→archive); dual-read a legacy `{candidate,er}` JSON; trail append is fail-soft on a bad dir.
- Pure addition; **`npm test` unchanged + new tests pass**. Commit.

## Task WS2-T2: Knowledge adapter (wrap existing; signatures preserved)
**Create** `mns/knowledge/adapter.mjs`; **Modify** `mns/knowledge/proposals.mjs` (extract apply body), register in faculty registry.
- Adapter `apply` = the body of today's `approveProposal` (registry branch + ER merge + `writeItem` + `upsertItem`). `ingest` runs ER (`er.mjs`). `validate` = `registry.validateItem`. `render` = the knowledge card.
- Keep `createProposal`/`approveProposal`/`rejectProposal` exports as thin shims delegating to the spine (so `tests/regression/knowledge-pipeline.test.mjs` + `tests/unit/knowledge-substrate.test.mjs` pass unchanged).
- TDD: the existing knowledge pipeline test still passes through the adapter; a new test exercises `registry.get('knowledge').apply(...)`. Commit.

## Task WS2-T3: generalize the gate + review; Actions adapter (archive-on-reject)
**Create** `mns/faculty/gate.mjs`, `mns/actions/adapter.mjs`; **Modify** `mns/commands/review.mjs`, `mns/actions/inbox.mjs`.
- `gate.mjs` — `approve(mnsDir,faculty,id)` → adapter.validate → adapter.apply → archive(approved) → trail; `reject(mnsDir,faculty,id,reason)` → **archive(rejected)** → trail. (Fixes Actions' destructive `rmSync` reject — reject now archives.)
- Actions `adapter.apply` = today's `activateAction` rename **plus** writing the proposal/archive record; `reject` archives the inbox dir under `actions/proposals/archive/` instead of deleting. Preserve `activateAction`/`rejectAction`/`listProposedActions` signatures (delegate).
- `review.mjs` — replace the two hardcoded blocks (knowledge JSON + actions dir) with one loop over `registry.all()` faculties; **preserve the readline line-queue (pipe-race fix) verbatim**; keep `[y/n/e/s/q]`. `mns proposals` gains optional `--faculty`.
- TDD: `tests/unit/review-actions.test.mjs` still activates via the loop (golden prompts preserved); new test: rejecting an action **archives** it (not deletes). Commit.

## Task WS2-T4: Guardrails / Instructions / Memory adapters
**Create** `mns/guardrails/adapter.mjs`, `mns/instructions/adapter.mjs`, `mns/memory/adapter.mjs`; **Modify** `mns/scaffold.mjs` (add `inbox/`+`proposals/` dirs for guardrails/instructions/memory).
- Guardrails `apply(rule payload)` → append/replace in `rules.json` (validate shape: `{id,action,tool,pattern,reason}`; regex compiles). `render` shows the rule.
- Instructions `apply(block payload)` → append a steering line to `.mns/instructions/project.md` (or the managed section). `render` shows the proposed line.
- Memory `apply(episode payload)` → write `.mns/memory/entries/<id>.md` (the WS1 schema). `render` shows the entry title.
- These are net-new (no existing tests to break). TDD each adapter's apply + validate; scaffold creates the new dirs. Now `mns review` walks all five. Commit.

## Task WS2-T5: data migrator
**Create** `mns/commands/migrate.mjs` (+ wire `mns migrate` in `bin/mns.mjs`); **Test** `tests/unit/migrate.test.mjs`.
- Idempotent: rewrite existing `knowledge/proposals/**/*.json` `candidate→payload`, `er→analysis.er`, add `faculty:"knowledge"`. (Generation minting of `gen_001` is WS3 — not here.)
- TDD: a legacy proposal JSON migrates once; re-running is a no-op; archived proposals still readable by `readProposal` (dual-read makes migration optional but tidy). Commit.

## Verification
- `npm test` green at every task (186 baseline + new). Knowledge/Actions regressions pass through the adapters unchanged. `mns review` end-to-end (piped y/n) still activates knowledge + actions; rejecting now archives.
- Smoke: `mns init` scaffolds inbox/proposals for all five faculties; `mns review` shows an empty queue across five faculties without error.

## Risks (from design)
- **Actions inbox dirs → proposal records** is the biggest on-disk change. Mitigation: keep `renameSync` activation semantics identical; only ADD the record + archive. Fallback: Actions keep dir-shaped proposals but emit a spine-shaped record alongside (review reads records uniformly).
- Preserve verbatim: `items.mjs` grammar, `registry.mjs`, `er.mjs`, `index.mjs` SQLite, `runner.mjs`, `schema.mjs`, the guardrails regex engine, the review readline pipe-race fix.
