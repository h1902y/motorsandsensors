# Experiment 5 — Conclusions (scaffold half; serving half pending)

**Verdict so far: the git-init contract holds.** `mns init` is context-aware (greenfield / brownfield / reinit), idempotent (second run = byte-identical, regression-asserted via filesystem snapshot), and never destructive (user edits to seeded files and to instruction files survive every re-run). 65 tests pass; all three modes verified through the real binary in temp dirs.

## What worked

- **Plan/apply split** (`planScaffold` → `applyScaffold`) made no-clobber trivial and testable: apply only ever creates what plan says is missing.
- **Versioned delimiter blocks** for instruction files: re-inject replaces only our block (any older version), so upgrading the steering text later is one version bump — user prose is never touched.
- **Rooting init at the git toplevel** (same base the store uses) avoids the two-homes bug when run from a subdirectory.
- **The deny-rule catch.** Designing serve *after* observe surfaced a real conflict (blanket `.mns` deny would starve the faculties); narrowed + legacy-migrated, with tests.

## Honest limits / open

- **Serving is not yet proven end-to-end** — no live agent session has been observed reading `knowledge/` because the block pointed it there. That's the next dogfood check (run a real session in a scaffolded project; watch the trace for Reads of `.mns/knowledge/`). Until then this is verified scaffolding, asserted-not-proven serving.
- Greenfield "onboarding" is 3 lines of next-steps, not an interactive wizard — deliberately minimal until real usage says what's needed.
- `instructions/` merges guardrails (advisory) — enforcement is future; don't mistake the text for a gate.
- No `mns deinit` yet (block + home removal); hand-deletable meanwhile.

## Next

- **Entity resolution** (the day-2 headline): the pipeline that distills sessions/sources into `knowledge/` — the first *content* for the scaffolded home, and the quality gate for the whole memory stack.
- The live serving proof above; then MCP as the second serving surface for hosts where files are weak.
