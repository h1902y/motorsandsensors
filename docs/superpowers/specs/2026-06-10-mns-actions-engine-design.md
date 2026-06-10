# Spec 2 — The Actions Engine: a script-powered tool collection

**Date:** 2026-06-10
**Status:** approved design → plan AFTER Spec 1 (Session Contract) ships
**Sequence:** Spec 2 of 2. Shares one seam with Spec 1: the digest's Actions index (Spec 1 §Component-1.3). Build Spec 1 first; this plugs its index into the already-shipped digest.

## Goal

Make the **Actions faculty** (procedural: named runbooks + executable tools) *extremely efficient* for an AI-assisted, filesystem-based local workspace — a superb scripts-powered tool collection. Borrows information architecture from two studied sources, **not** their runtimes:
- **pi** (badlogic/pi-mono) — progressive disclosure, registered-vs-active, throw-to-fail, result-as-patch, `prepareArguments` forward-compat, manifest-driven bundles.
- **zuzuu `_labs`** (`/Users/hkc/Documents/zuzuu/clients/_labs`) — JSON-Schema-as-single-truth, the strict `main(args) → dict` entry contract, three-layer preamble/postamble result extraction, OpenAI/Anthropic/MCP converters, depth-counter composition, secrets-injected-at-runtime.

## The canon reconciliation (the central decision)

Both sources **drive** execution (a sandbox runtime / arbitrary-TS extensions with full system access). mns is **observe-not-drive, zero-dep, files-as-truth, human-gated**. So we lift their *information architecture* but run scripts the canon-safe way:

**The host's own Bash runs the script; mns only dispatches + validates.** `mns act <slug>` is the same category of agent-invoked CLI as `mns recall`/`mns remember` — a tool the agent chooses to call, **not** a driver of the agent loop.

Consequences (all upside, all canon-aligned):
- Every action invocation is the host's Bash call ⇒ a **clean observable trace span** for free.
- It already passes through the **guardrails gate** (PreToolUse sees the bash command) — no new enforcement path.
- **Zero-dep:** scripts are `node:*` or bash; the validator is hand-rolled (matching the `node:test`/`node:sqlite` no-deps policy), not Ajv.
- mns never enters the hot agent loop — `mns act` is a CLI surface, exactly like the rest.

What we do **not** borrow: the sandbox runtime, arbitrary-TS-with-full-access extensions, encrypted secret stores, persistent-executor daemons. Actions are declarative files the host reads + a thin dispatcher mns runs on request.

---

## A1 — Two kinds, one home

`.mns/actions/<slug>/` holds either:

- **Runbook** — `SKILL.md` (the cross-host Agent Skills standard the June-2026 survey found in Claude Code, Gemini, Codex, and pi; Codex+pi even share `.agents/skills/`). Prose procedure, read on demand, **portable to every host for free**, no execution. A runbook may say "run `mns act deploy`" — so runbooks *wrap* scripts.
- **Script** — `action.json` (manifest) + `run.mjs` / `run.sh` (executable, implements the entry contract).

The Actions index (served into the digest) lists both kinds with one-liners.

## A2 — The manifest: JSON Schema as single truth (`_labs`)

`action.json`:
```json
{
  "slug": "kebab-case",
  "title": "Human readable",
  "description": "what it does",
  "promptSnippet": "one line the digest injects",
  "inputs":  { "type": "object", "properties": {...}, "required": [...] },
  "outputs": { "type": "object", "properties": {...} },
  "default_args": { "...": "..." },
  "requires": []
}
```
Schema is the contract, validated **both ways** (inputs before run, outputs after). Zero-dep: a small hand-rolled JSON-Schema subset validator (object/string/number/boolean/integer/array, required, enum, basic constraints) — not Ajv. Same "promise what `main` returns" discipline as `_labs`' `validateOutputs`.

## A3 — `mns act`: the dispatcher (the canon-safe "executor")

```
mns act <slug> [--args JSON | -k v ...]      # run an action
mns act list                                  # the index (feeds the digest)
mns act show <slug>                           # full manifest / runbook
mns act new <slug>                            # scaffold dir + manifest + run template
mns act schema <slug> [--mcp|--openai|--anthropic]   # convert manifest → tool format
```

`mns act <slug>` flow (the `_labs` sandwich, minus the sandbox):
1. Load manifest.
2. **Validate inputs** against `inputs` (merge `default_args` then caller args). Fail → structured `invalid_input` error, no run.
3. Run `run.mjs`'s **`main(args)`** (the `_labs` strict entry contract; async supported). Args injected as a JSON-safe object.
4. Capture result via a **result marker** (`_labs` postamble: `__MNS_ACT_RESULT__<json>` on stdout) — robust to the script also printing logs.
5. **Validate outputs** against `outputs`. Fail → `invalid_output`.
6. Print structured JSON (for the agent to parse) + a short human summary.

Contracts:
- **Throw-to-fail** (pi): a script that throws ⇒ error surfaced to caller; a script that returns ⇒ success. One rule, no return-shape sniffing.
- **Depth counter via env** (`_labs`): `mns act` callable from inside a script (composition); `MNS_ACT_DEPTH` capped (e.g. 8) to stop runaway chains.
- **`prepareArguments(args)` hook** (pi): optional in `run.mjs`, runs before validation to fold legacy params forward — the forward-compat seam for generation-pinned actions that evolve across generations.

## A4 — Progressive disclosure: the efficiency lever (pi)

Where the token-savings thesis lives. The **digest injects only the index** (`slug · promptSnippet`), never bodies. The agent opens a full `SKILL.md`/`action.json` on demand via its **own read tool**, or just runs `mns act`. pi's rule — *"no special loader tool; ride the host's read"* — maps exactly and keeps mns observe-only.

- **`promptGuidelines` discipline** (pi): every guideline line names its action explicitly (never "this action") so a multi-action index stays unambiguous to the model.
- **Registered ≠ active** (pi): v1 lists all available actions; a trace-driven *active subset* (surface only what's relevant this session) is a forward hook, not built in v1.

## A5 — The MCP bridge: schema → tool, zero rework (`_labs`)

`mns act schema <slug> --mcp|--openai|--anthropic` converts the manifest to each tool format (the `_labs` `tool-definition.ts` pure-converter pattern: `toMcpTool`/`toOpenAITool`/`toAnthropicTool`). This is the literal bridge to DESIGN §6's "Actions served over MCP" — Stage 2 / OpenCode gets MCP-native actions with **no re-authoring**. The manifest authored once for `mns act` becomes an MCP tool definition for free.

## A6 — Authoring + the crystallization seam

- **`mns act new <slug>`** scaffolds the dir, a manifest stub, and a `run.mjs` template (with `main(args)` + the optional `prepareArguments` hook).
- **Inbox path:** the harvest ritual (Spec 1, block v4) can propose a new action into `actions/inbox/`; a human approves via **`mns review`** (the same gate as knowledge proposals) before it becomes active. This *is* DESIGN's "Actions crystallization = the same governed pipeline as Knowledge promotion" — built and proven, not just asserted. Never write active actions directly; propose → gate → activate.

## A7 — Result/error & observability contract

- **Result-as-patch split** (pi): the model sees the action **outcome** (`content`); the trace/observability layer keeps the rich **`details`** — clean fit with mns's "pin definitions, observe data." Since the host runs `mns act` via Bash, the span already carries the call; `mns act` writes the structured `details` to the trace side-channel (consistent with the guardrails decision log).
- **Truncation** (pi convention): cap large action stdout (~50KB / 2000 lines, head-truncated) before returning to the agent.

## Testing

- **Validator:** golden cases for the hand-rolled JSON-Schema subset (types, required, enum, constraints); inputs merge `default_args` correctly; outputs reject non-object / schema-mismatch.
- **`mns act` dispatch:** happy path (validate → run → marker extract → validate → structured out); `invalid_input` / `invalid_output` / throw-to-fail error paths; depth-counter cap; `prepareArguments` fold-forward; result-marker survives interleaved script logging.
- **`mns act list/show/new`:** index shape stable; scaffold idempotent + no-clobber; runbook (SKILL.md) and script kinds both listed.
- **`mns act schema`:** converter goldens for MCP/OpenAI/Anthropic (pasted from real output, not hand-computed — golden-ids convention).
- **Inbox → review:** proposed action flows through `mns review` to active; never auto-activates.
- **Digest seam:** with Spec 1 shipped, `mns act list` output appears in the digest's Actions index (progressive disclosure: snippets only, no bodies).
- **Real-wire dogfood:** author one real action in this repo (e.g. `run-tests` or `distill-last`), invoke it from a real Claude Code session via Bash, confirm the span + structured result + that the guardrails gate saw the call.

## Explicitly NOT in scope (YAGNI)

- Encrypted secret storage / a secrets vault — actions inherit the host shell env in v1; secrets are a later rung.
- Sandboxing / isolation — the host runs the script in the user's own shell (same trust as the agent itself); no new sandbox.
- Persistent-executor daemon (`_labs`' latency optimization) — premature; `mns act` is a plain process per call.
- Model-authored ephemeral tools (the model minting a tool mid-session) — pi doesn't allow it either; out of scope.
- Active-subset (trace-driven) selection — forward hook from A4, not v1.

## Source references

- `_labs`: `lib/tool-definition.ts` (converters), `lib/schema-json.ts` (validate in/out), `lib/script-preamble.ts` + `sandbox-runner.py` (preamble/postamble + `main(args)` contract + result marker), `lib/script-wrap.ts` (auto-wrap), `lib/mcp-tool.ts` (MCP shape), depth-counter in `invoke_script`. (Liftable as *patterns*; the Supabase/Cloudflare/Composio coupling is not.)
- pi: `docs/sdk.md` (`defineTool`, `createAgentSession`, result patch, `onUpdate`), `docs/extensions.md` (`registerTool`, getAllTools/setActiveTools, `prepareArguments`, `promptGuidelines`, pi-package manifest), `docs/skills.md` (progressive disclosure, read-on-demand, no loader tool), `examples/extensions/tools.ts` (active/available toggle, branch-aware persistence).
