# The Faculty Module — what a faculty IS (design)

**Date:** 2026-06-13 · **Status:** approved (autonomous run) · Companion: `2026-06-13-overhaul-design.md`

## Context

User's engineering problem statement: "If we modularize faculties — templatized, independently authored (workflow faculty, todo faculty, marketplace) — what is the structure of a faculty? It's tied to sessions, mining, eval, the generation engine. What does the faculty template look like?" This spec answers it, grounded in plugin-architecture research (VS Code contribution points, Obsidian manifest+onload, ESLint plugin exports, Backstage lifecycle, Vite hooks — synthesis: **manifest-first discovery + code-export hooks, miner-class hooks fail-soft, contract versioned**) and in zuzuu's existing spine (envelope, adapters, miners registry, eval lens, digest sections, gate).

## The contract

A faculty = **a manifest + an items collection + a set of named hook exports**, all riding the Faculty Standard envelope.

### 1. Manifest — `<faculty>/faculty.json` (machine contract → JSON, per the Standard's split)
```json
{
  "id": "knowledge",
  "title": "Knowledge",
  "tagline": "what's TRUE — facts about this project",
  "version": "1.0.0",
  "contract": 1,
  "kinds": ["fact", "entity", "command"],
  "itemsDir": "items",
  "schema": "schema.json",
  "hooks": { "miner": true, "digest": true, "eval": false, "gate": false },
  "ui": { "icon": "book", "accent": "info", "teaching": "Facts zuzuu learns from your sessions land here after your approval." }
}
```
- `contract` = the module-API version (host skips incompatible; bump minor on new optional hooks, major on breaking).
- `ui` block = the card descriptor the workbench renders from (no per-faculty frontend code needed for a new faculty).
- Seeded by scaffold for the five built-ins; the daemon/CLI surface it via `zuzuu faculty manifest <f> --json` and a combined `zuzuu faculty overview --json`.

### 2. Items — the Faculty Standard (already shipped)
Envelope items under `itemsDir`; payload typed by `schema.json`; proposals/inbox/archive dirs per the spine contract (unchanged).

### 3. Hooks — code exports (built-ins: `zuzuu/faculties/<id>/index.mjs`; third-party later: same shape from a package)
```js
export const manifest = {...};                       // or read from faculty.json — single source: the JSON file; index.mjs re-exports it
export function miner(sessions, opts) → {aggregate, propose}   // REQUIRED — a faculty grows from traces or it's just a folder
export function digestSection(agentDir, budget) → {title, lines}  // optional; default = "N item(s)" line
export function evalSignals(proposal) → partial signals          // optional; default mechanical scorer applies
export function gate(toolCall) → verdict|null                    // optional; ONLY guardrails uses it today; same fail-open law
export function applyProposal(agentDir, proposal) → result       // the adapter's apply (existing adapter.mjs becomes this)
export function validate(agentDir, payload) → {ok, errors}       // existing adapter validate
```
**Host law (fail-soft everywhere):** every hook call is try-wrapped + time-boxed by the registry; a broken faculty module degrades to items-only (visible in doctor), never crashes the CLI, the gate, or a hook.

### 4. Registry — `zuzuu/faculty/registry.mjs`
Replaces today's scattered wiring (miners/registry self-registration, per-faculty adapter imports in gate.mjs, hardcoded FACULTIES array, digest's hardcoded sections, FACULTY_META duplicated in the web kit):
- `facultiesOf(agentDir)` → built-ins (always) — discovery of `.zuzuu/<dir>/faculty.json` beyond built-ins is parsed and listed but **third-party code loading is explicitly deferred to W4** (manifest-only modules still get: items listing, card UI, schema validation, default digest line — a *declarative faculty* works TODAY with zero code).
- The spine (proposal/gate/generation/eval/review/distill/digest) iterates the registry — no faculty names hardcoded outside built-in module files.
- `FACULTIES` const remains as the built-in list; everything else derives.

### 5. What this buys (acceptance)
- **A new declarative faculty in one folder**: drop `todo/faculty.json` + `todo/schema.json` into a home → it appears in `faculty overview`, gets cards in the workbench, items validate, digest mentions it. (Integration test does exactly this.)
- The five built-ins are *implemented as modules* — proof the contract is real, not aspirational.
- W4 marketplace = distributing these folders (+ later, code hooks). The template IS the deliverable.

## Migration of built-ins (mechanical, test-locked)
`zuzuu/{knowledge,memory,actions,instructions,guardrails}/adapter.mjs + miners/<f>.mjs + digest sections + kit FACULTY_META` consolidate into `zuzuu/faculties/<id>/index.mjs` (+ faculty.json seeds). Existing tests keep passing (imports re-pointed); new tests: registry iteration, fail-soft (a throwing hook never propagates), declarative-faculty integration, manifest --json shapes. Web kit reads `ui` descriptors from the overview payload instead of its local FACULTY_META (fallback retained).

## Out of scope
Third-party CODE loading + sandboxing (W4; manifest-only declarative faculties work now) · workflow/todo faculties themselves (validation fixtures only) · marketplace distribution.

## Verification
Full suite green; the declarative-faculty integration test; doctor reports a broken module degraded; live E2E: a scratch `todo` declarative faculty appears in the workbench cards.
