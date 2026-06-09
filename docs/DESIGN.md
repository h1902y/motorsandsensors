# motorsandsensors — the design

> **What this is:** the **canonical design document** — what we're building, why, the architecture, the decisions, and the research it stands on. It consolidates the prior set of concept/design docs into one entry point. Depth lives in [`inspiration/`](../inspiration/) (the source-level audits and the 100-project field survey). For *what runs today* and how to use it, see the [repo README](../README.md).
>
> **Provenance:** until 2026-06-10 this file *was* the repo `README.md` — older experiment records, commit messages, and code comments that cite "README §N" mean **this document**. Converged 2026-06-01 → 2026-06-08; build began 2026-06-09.
>
> **Naming:** the project was previously called **zuzuagents** (product concept: *zuzu*). It is being renamed **motorsandsensors** ("mns" in the CLI). Sibling projects keep their own names (Zuzucodes Labs, Flow Engine, Notes). Where this doc says "we", it means motorsandsensors.
>
> **Status — read this honestly:** this is the **design**, ahead of the build by intent. What's *built* (and verified) so far: the observe layer — host-agnostic trace capture across 4 real hosts, the `mns` CLI, live capture, the faculty home (`mns init`). The evolution engine, the faculties' content pipelines, and everything else below remain **solved on paper only** until an experiment ships them.

---

## 1. What we're building (the one-paragraph version)

Your host coding-agent — **Claude Code / Codex / Gemini CLI** — gives an agent a **brain** (the reasoning loop + the model). **motorsandsensors gives that agent an evolving Memory, body of Knowledge, set of Actions (skills), and Guardrails — improved automatically from how you actually work.**

The differentiator versus static wrappers (OpenClaw, Hermes, entire.io): **our faculties *graduate*.** They level up across versioned **generations**, and you configure the graduation mechanism from observability insights. We don't run a competing agent loop and we don't sell inference — we **wrap, serve, observe, and evolve** the host you already pay for.

### The loop (the whole product in six steps)
1. **Wrap** the live *interactive* host session (never headless — see §7).
2. **Serve** faculties (via MCP / instruction-files / filesystem) **and observe** the session as a normalized **trace**.
3. **Evaluate** — score faculty operations from the trace.
4. **Propose** — a trace-miner suggests a graduation (memory promotion, tool crystallization, guardrail tightening, substrate tier-up).
5. **Approve** — a human disposes, async and out-of-band, in an inbox.
6. **Pin** — the approved change becomes a new **generation** (rollback = flip a pointer).

> **Backbone principle: _pin definitions, observe data._** Everything immutable/versioned is a *definition* (prompt, model, tool version, memory schema). Everything else is *runtime*, captured in traces and asserted by evals. This single rule dissolved the entire "snapshot/replay the run state" problem.

---

## 2. The core hypothesis — generational graduation

An agent's components (memory, knowledge, tools, prompt, guardrails) **improve over versioned generations**, and a **human sits in an async, out-of-band loop** to evaluate and promote them. The missing piece the field doesn't have: not just *configuring* faculties, but **growing** them from the trace of real use.

### The two axes (the crux — never fuse them)
Every faculty evolves on **two independent axes**:

| Axis | What evolves | How it changes |
|---|---|---|
| **Substrate** | *how* a faculty is implemented | **set** by an operator — a tier choice behind a stable interface |
| **Contents / capability** | *what* a faculty has accumulated + its promotion to richer forms | **earned** from trace data via a governed pipeline |

The true symmetry — and the core hypothesis — lives on the **contents axis**: Knowledge's episodic→semantic promotion and Actions' *crystallization* are **the same governed pipeline**. One trace feeds both; one human gate; one unit of versioning (the generation). Both substrate ladders expand *power over accumulated stuff* and **converge on the vector tier** (semantic recall / semantic tool-selection — same pgvector substrate). A substrate jump only counts as evolution if it *changes what the agent can do* — which is why code-organization (script→OOP→package) is **hygiene, not a rung**.

### The unified promotion engine
```
observe (trace spans)  →  eval (score the faculty's operations)  →
  trace-miner detects a promotion signal  →  files a Proposal  →
    human approves (async, out-of-band, in an inbox)  →  pin as new generation
```
- **Proposal** is a first-class entity: `{ faculty, kind, trigger_signal, evidence (trace refs + eval scores), suggested_diff, status: pending|approved|rejected }`. It is the bridge from observability to generation.
- **Async + human-gated, never auto in v1.** Auto-crystallization from traces is the same research-grade problem (reward-hacking / overfit) we deliberately cut. The async human loop *is* the safety boundary.

---

## 3. Architecture — *be / run / evolve*

The organizing principle: for any primitive, ask whether it is part of what the agent **is** (a faculty), what **runs & bounds** it (the runtime), or what **grows** it (the evolution engine).

> **One-line story:** an **agent** is a durable entity composed of **evolving faculties**, running on a **runtime**, grown by an **evolution engine** that *observes* the faculties running, *evaluates* what it sees, and *graduates* them into new generations — human-gated. The system **learns from the observability traces of previous runs**: that loop is the whole product.

### ① The Agent — what it *is* (the 5 + 3 anatomy)

> **Revised 2026-06-10** (was "7 faculties, 4 us / 3 host"). Two fixes: **Instructions** promoted to a faculty (the pinned `system_prompt`/steering artifact always behaved like one — us-owned, evolving, pinned — but had no name), and the host trio stopped being called "faculties" (a process, an engine, and an arena aren't faculties of the agent). Operational definition of a faculty: **us-owned · contents accumulate from traces · graduate via proposals · pinned in generations · served to the host.**

**Five faculties (ours):**

| Faculty | Cognitive analog | Role | Evolves by |
|---|---|---|---|
| **Knowledge** *(semantic)* | semantic memory | what's *true* — domain facts, entities | extraction + entity-resolution + reflection; substrate ladder `md → relational → graph → vector` |
| **Memory** *(episodic)* | episodic memory | what *happened* to me — past runs/conversations | distilling the trace into curated recollection; reflection |
| **Actions** *(procedural)* | procedural memory | how to *do* things — skills/toolkits (unit = a "tool") | the selection-burden ladder + a contents lifecycle |
| **Instructions** *(directive)* | self-schema / values | who I *am*, how I should behave — the pinned `system_prompt` + project steering | steering text mined/refined from trace insights; pinned per generation |
| **Guardrails** *(protective)* | inhibitory control | what I must *not* do — enforced gates on tool I/O, not advice | inspector rules in an ordered gate pipeline; pinned in the generation |

**Host anatomy (not faculties — what ours plug into):** **Cognition** (the reason→act→observe *process*; steerable only via Instructions injection), **Model** (the *engine*; the host's subscription/choice), **Workspace** (the *arena*; the real machine/repo).

**The deep structure:** the five map cleanly onto cognitive systems — semantic, episodic, and procedural memory plus the self-schema (Instructions) and executive inhibition (Guardrails). Cognition reasons over all of them; Model is the substrate; Workspace the arena.

> **Vocabulary note:** earlier docs called the *semantic* faculty "Memory", and pre-2026-06-10 docs say "4 faculties" with Instructions folded into serving mechanics. Canonical now: **Knowledge** = semantic, **Memory** = episodic, **five** us-owned faculties, host trio = anatomy.

### ② The Runtime — serve, observe, evolve (it does **not** run the agent loop)

Because the **host** owns the agent loop and inference, our runtime is *not* "run the agent." It **serves faculties to a host we don't run, captures the boundary trace, and durably runs the async evolution loop.**

| Primitive | Role (reframed for the wrap-the-host model) |
|---|---|
| **Activation** | *when we act* — scheduled **graduation reviews** + on-demand faculty calls. The user drives the agent loop from their terminal; our heartbeat is the evolution review. |
| **Durable execution** | runs **only the async evolution loop** (eval → propose → graduate) on Cloudflare Workflows + `waitForEvent` — **not** the hot agent loop. *This dissolves the CF-Workflows loop-length risk.* |
| **Budget** | tracks **our** faculty-execution cost (sandbox/embeddings) + **observes** host token spend (we don't enforce the host's inference). |
| **Identity & permissions** | user identity, per-user faculty scoping, secrets for *our* Action execution (proxy-side injection so the sandbox never holds a raw secret). |
| **Inference** | the **host's** for the agent loop (free to us); our *internal* LLM ops (extraction, eval-judge, proposals) run on **our own cheap model** — until **MCP Sampling** lets us run them on the user's model (north-star; not host-supported today). |

### ③ The Evolution engine — what *grows* it

```
Observability/traces  →  Evaluation  →  Generations  →  Governance (human async loop)
   (capture the run)      (judge it)     (pin/rollback)   (approve the promotion)
```
- **Observability** — the typed, append-only, tree-shaped trace of every run. The keystone artifact; also the raw episodic stream that feeds the Memory faculty. **Build it first.**
- **Evaluation** — scores the trace; swappable scorer (code assertion → LLM-judge → human). Distinct from observability: capture vs judge.
- **Generations** — the spine: an immutable pin of faculty definitions + an active pointer + `forkedFrom`; rollback = flip the pointer.
- **Governance** — the human, async and out-of-band: approves a proposal → it becomes a new generation. The trace-miner proposes; the human disposes.

---

## 4. The entity model — Agent / Generation / Run

Three levels, distinct lifetimes:

- **Agent (durable):** identity, role/title, reporting position, **active-generation pointer**, generation lineage, attached faculty refs (Memory/Knowledge/Actions, M:N), budget policy. It is an **employee, not a script** — it never "finishes."
- **Generation (immutable pin — the lockfile):** `{ system_prompt (+hash), model, tool refs+versions, memory/knowledge refs+schema-versions, input_guardrails, output_guardrails, budget envelope }`. Immutable version rows + `isActive` pointer + `forkedFrom`; **rollback = flip the pointer.**
- **Run / Episode (transient):** one invocation under a generation = a bounded goal-loop. Composable termination: `goal-reached` (typed end-turn tool) **OR** `budget-envelope-zero` **OR** `max-rounds/stall` **OR** `waiting-for-human`. Emits a **trace** (tree of typed spans). Runs are the substrate for evals + promotion mining — *not* a generation.

First-class entities **`Agent` / `Memory` / `Knowledge` / `Actions`**, joined **many-to-many** — an agent *composes* faculties, it does not own them. A generation pins **references to specific versions**; promoting a shared faculty is a versioned event each attached agent **opts into** by re-pinning. **Decision: model M:N + identity from day 1, run single-owner in v1** (sharing designed-in, not exercised) — avoids a retrofit without paying the concurrency cost early.

---

## 5. The faculties in depth

### Knowledge (semantic) — interface `remember` / `recall` / `relate`
- **Substrate ladder (earned):** `L0 markdown → L1 relational (Postgres) → L2 graph (Apache AGE, Cypher) → L3 pgvector (semantic recall)`. AGE/pgvector are **opt-in top rungs**, not a foundational commitment (this killed the "platform-wide unified graph" risk — the graph lives *inside* the faculty's top tier, per agent). **AGE is a "prove-it"** — benchmark vs relational + recursive CTEs + pgvector before betting the hot path on Cypher.
- **Contents lifecycle:** `working-state → mined candidate fact → proposal → approved fact/relation → schema/tier promotion → archive/forget`. Entity-resolution (dedup + linking on write) is a built-in sub-process; reflection promotes episodes→semantics.
- **Eval is operation-level, not state-reproduction:** assert over the memory *operations* in the trace (right query? read hit/miss? write ok? entity-resolution hit/miss?). No snapshots, no temporal querying.

### Actions (procedural / tools) — interface `describe` / `invoke(mode, args)`
- **Contents axis** (*what tools exist*): `ephemeral action → mined candidate → proposal → approved named tool (v1) → generalize → upgrade (v2…) → retire`. Versioned immutably; a generation pins specific tool versions, so a tool upgrade is a generation event the agent opts into. Self-authored tools are *proposals*, not live mutations.
- **Substrate axis** — a **selection-burden ladder** (the work of selecting & composing tools shifts off the agent onto structure as the set grows):
  ```
  R0  Single tool                  — no selection problem.
  R1  Many · AGENT-DECIDED         — flat catalog; LLM picks by name.            [Labs today]
  R2  Many · SCHEMA-ASSISTED       — typed I/O → a compatibility graph makes chains
                                     mechanical & typecheckable; tags/groups scope.
  R3  Many · SEMANTICALLY-RETRIEVED— catalog outgrows the prompt; embed intent+schema,
                                     retrieve top-k. (vector → sibling to Knowledge's pgvector)
  R4  Composed · CRYSTALLIZED      — a proven recurring chain → ONE named composite tool,
                                     versioned. (contents ⋂ substrate meet here)
  R5  Tools-as-SERVICES            — mature composite extracted to a shared, scaled service.
  ```
- **The agent always decides** — structure only *narrows & validates* its choice-space. **R2 is nearly free** on the existing Labs tool model (it just *uses* the stored `inputs_schema`/`outputs_schema` to build a typed compatibility graph) — the immediate next step.
- **Composition = a declarative typed DAG** (decided), not generated code: `{ nodes: tool-refs (pinned versions), edges: typed output→input wirings }` + its own outer schema. Typecheckable (an edge is legal iff types satisfy), inspectable, diff-able, versioned as a generation. *This reuses Flow Engine's node/graph data model* — a composite tool is a mini-flow, converging with the agent org-chart canvas (same graph primitive, different scale).

### Memory (episodic)
The agent's *curated* recollection distilled from the raw observability stream: seed (system prompt) → conversation scaffolding → historic-conversation analysis → steering. Likely a different substrate from Knowledge (append-heavy run/conversation log + summarization, vs relational/graph/vector facts) — confirm during build.

### Instructions (directive) — who the agent is
The pinned steering artifact: the generation's `system_prompt` (+hash) at platform level; per-project, `.mns/instructions/` served via instruction-file injection. Evolves like every faculty — steering text refined from trace insights ("the agent keeps doing X wrong" → a proposal to amend the instructions → human approves → new generation). Distinct from host-owned Cognition (the loop itself): Instructions is *our artifact that shapes* the loop. *(Promoted to a faculty 2026-06-10 — it always met the operational definition.)*

### Guardrails (protective) — the enforced membrane, pinned in the generation
Input (prompt-injection scan, PII scrub, schema validation) + output (schema validation, moderation, redaction-before-persist, policy) implemented as **inspectors in one ordered gate pipeline**; each returns `Allow / Deny / RequireApproval`; `RequireApproval` → `waitForEvent` pause → approval inbox. Each check is a **GUARDRAIL span** on the trace, so the safety trail *is* the execution trace.

> **Built (v1, 2026-06-10):** the first enforced gate — declarative rules (`.mns/guardrails/rules.json`: `{id, action: deny|ask|allow, tool, pattern, reason}`) evaluated per tool call by the mns `PreToolUse` hook on Claude Code; severity wins (deny > ask > allow); **fail-open** (engine errors/missing rules block nothing — a guardrail bug must never brick the agent); matched decisions logged per session (the GUARDRAIL-span precursor). `ask` maps to the host's permission prompt — the v1 form of `RequireApproval`. OpenCode enforcement (`tool.execute.before`) is the next rung; the full inspector pipeline (PII/injection/moderation) remains design.

**Tools are a first-class attack surface** (self-evolving/imported tools make this acute): treat all self-authored + MCP tools as **untrusted → sandbox by default**, require provenance, block secret/env enumeration, redact secrets before they hit the trace; **code-review-on-promotion** for crystallized/authored tools (staged validation: interface→signature→contract→golden-replay, *plus* a human review); **retrieval-poisoning defense at R3** (multi-signal ranking, not embedding-similarity alone); evals run on *unseen* traces with an **independent verifier** (proposer ≠ scorer).

---

## 6. The deployment model — we wrap a host you already run

motorsandsensors is **terminal-first** in *experience* and **MCP-core** in *mechanism*, in three rings:

1. **MCP core (host-agnostic backbone)** — faculties served over MCP: **Tools→Actions · Resources→Knowledge/Memory recall · Prompts→scaffolding · Roots→Workspace scoping · Elicitation→HITL/approval** (works on Claude Code today) **· Sampling→run our internal LLM ops on the user's model** (north-star; *not host-supported yet*). Every MCP call is a trace span.
2. **Per-host shim (progressive enhancement)** — instruction-file injection (CLAUDE.md / AGENTS.md / GEMINI.md, `--append-system-prompt`) everywhere; **rich hooks on Claude Code** (PreToolUse/PostToolUse/SessionStart/Stop → deeper trace + tool-gating), thinner on Codex/Gemini.
3. **Server control-plane** — stores configs + learnings + generations, runs the async evolution loop + CI/CD-style trace analysis. Plus a **local-native mode**: the whole harness = instruction files + a local MCP server — non-intrusive, secret-free, optional server sync.

### Three faculty-serving surfaces (pick per faculty/host)
- **MCP** — structured, fully observable (every call = a span). Default for Actions; needs host MCP support.
- **Instruction-file injection** — CLAUDE.md/AGENTS.md/GEMINI.md, with **delimiter-block + auto-cleanup** coexistence discipline. Universal; for scaffolding/hints.
- **Filesystem (mount / virtual-bash)** — serve Knowledge/Memory as files (the smfs model). **Most host-agnostic** (uses the agent's own `Read/Write/Grep/Bash`, zero MCP); "flagless grep = semantic / flagged = literal". *Tradeoff:* a raw `cat` isn't a clean span → use a **virtual-bash single-tool** (`run_bash` + shipped tool-description) when observability matters.

> **Honest trace tradeoff:** MCP-only sees calls *to us*, not the host's built-in tool calls. **Observability completeness ∝ how much the host routes through us.** Mitigate by pulling work through MCP + an instruction-shim + progressive hooks. Trace propagation: **W3C TraceContext via MCP `params._meta`** (host-agnostic, local-first).

### The host-adapter is an *observe* model (not a streaming bridge)
Because we **wrap & observe** a loop we don't drive, the HostAdapter follows entire.io's proven shape, **not** goose/hermes's `run()`/`stream()` (that is for *driving* a host — out of scope): a required **`Agent`** interface (detect presence, read/write session, resolve transcript, resume) + optional **`HookSupport`** (`installHooks` writes the host's *native* hook config → callbacks into one binary → `parseHookEvent(stdin) → Event`) + optional **capability interfaces** (`TranscriptAnalyzer`/`TokenCalculator`/`FileWatcher`-fallback) + a **registry** (`detect()` by presence). Every adapter normalizes its native hook into **one `Event`**; the dispatcher routes by `EventType`, **never by agent name** — so the eval lens stays agent-agnostic. **This `Event` is the basis of our trace-span schema** ("design the trace once"). Always graceful-degradation (never break the host if our binary is absent); `permissions.deny` on our own metadata dir (no feedback loop).

### Model & provider agnosticity — two distinct needs
- **Need 1 — host-agnosticity:** the observe-adapter above; host owns model selection; assume no shared host model-schema.
- **Need 2 — internal-inference agnosticity** (our own faculty ops; a **stopgap until MCP Sampling**, so don't over-build): a thin litellm-*style* surface (one canonical `complete()`/`stream()` + `drop_params`, provider from a `provider/model` string — aider's altitude, **not** vendoring litellm, **not** continue's ~70 subclasses). Config = two blocks: `host:` (adapters; model host-owned) + `inference:` (`default` + per-faculty overrides + custom providers + type-keyed fallbacks). Reusable pattern: separate **`api`** (wire protocol) from **`provider`** (id) → a new OpenAI-compatible vendor = zero code.

### OpenCode as a candidate default host (a strategy hypothesis — not yet committed)
The host adapters assume the user *already runs* a host. But a newcomer who runs none of Claude Code / Codex / Gemini needs an agent to wrap. **OpenCode (OSS, MIT) is the natural default to bundle** — and it makes us a richer integration, not just an observer:
- **MNS as an OpenCode plugin** (`@opencode-ai/plugin`) — **built + live-verified.** A project plugin (`.opencode/plugin/mns.js`, installed by `mns enable --host opencode`) fires the mns lifecycle hook on OpenCode's bus events. OpenCode's event surface is finer-grained than Claude's at the *tool/message* level (`tool.execute.before/after`, `message.part.updated`), but — verified by observing real runs — its **session lifecycle is the same shape as Claude's**: `session.created` = start, `session.idle` ≈ Claude's per-turn `Stop`, and **no clean end signal** (`session.deleted` is delete-only, not normal completion), so ended/killed sessions reconcile via staleness (`mns doctor`), exactly like Claude. So "be a plugin for OpenCode" maps cleanly onto the Phase-2 lifecycle model — it's a peer live-capture host, not a categorically better one. *(Both the SQLite read-adapter and the live plugin are real-data-verified against a live `opencode run`.)*
- **Default-host ≠ abandoning host-agnosticity.** We still observe any host; we'd merely *ship one default* so non-host users get started in one step. The four-adapter set (Claude/Gemini/Codex/OpenCode, all real-data-verified) is the agnosticity proof.
- **Credits via MNS → OpenCode (monetization hypothesis — two models, decide later, neither built):**
  - **(a) MNS-as-gateway** — MNS hosts an OpenAI-compatible endpoint; OpenCode points at it as a custom provider; users buy MNS credits (Razorpay) and MNS proxies upstream + keeps margin. *Controllable, no partnership needed — but real infra/payments/abuse work.*
  - **(b) Zen-reseller** — credits top up OpenCode's own Zen balance. *Simpler conceptually, but depends on an OpenCode partnership; no public reseller API found.*
  > Flagged, not decided. The point today: the *plugin + default-host* path is real and partly built; the *credit* path is a business decision parked behind it.

---

## 7. Why interactive-mode-first (a product pillar, not a detail)

We augment the developer's **live interactive** host session and **never drive the host headlessly.** Two Anthropic-structural reasons:

- **Pricing.** Verbatim from Anthropic's docs: *"Starting June 15, 2026, Agent SDK and `claude -p` usage on subscription plans will draw from a new monthly Agent SDK credit, separate from your interactive usage limits."* Headless wrappers (OpenClaw, Hermes via `claude -p`) sit in the **metered** pool (or are forced onto API keys via `--bare`); interactive use rides the **unchanged subscription** pool.
- **Surface.** Hooks / MCP / CLAUDE.md / skills **only fully work in interactive mode** (`--bare`/headless skips them). Interactive is the *only* mode where our wrapping surface exists — headless wrappers lose exactly what we use *and* get metered.

> *Watch-item:* Anthropic could later police interactive augmentation too. **No evidence today** — interactive use is explicitly permitted — but track it. (Detail + verified-vs-directional split: [`inspiration/claude-code-pricing-audit.md`](../inspiration/claude-code-pricing-audit.md).)

---

## 8. The product surface — design system & agent canvas

The first *visual* build target: a design system + the canvas on which **agent nodes** are arranged into architectures.

- **Design system — lifted from Zuzucodes Labs as-is** for brand cohesion: OKLCH token palette (pale-rose/lemon/peach + 6-hue pastel chips), fonts (Poiret One / Quicksand / Arvo / Major Mono Display), `lib/motion.ts`, `components/ui/*` primitives. Stack: Next.js 16 / React 19 / Tailwind v4 / CVA / Radix / Framer Motion.
- **The agent node — a rounded-corner flat-top hexagon** (signature component): role glyph + name + status dot at rest; one context line on hover (`model · 🧠 <tier> · N 🔧`); side panel on select. Variants: leaf / supervisor / root / **mirror**. States: `idle · selected · running · paused-for-human · completed · failed · eval-flagged` (mapped to Labs semantic tokens; `paused-for-human` ties to the engine's `waitForEvent` gates).
- **The canvas — a Zapier-elegant, auto-arranged 1:N tree.** Single-rooted; dependents fan onto the next row; no free-drag scatter. Uniform solid 1:N delegation edges with run-pulse animation. **Mirror nodes** (ghosted, dashed, "↪ mirror" badge) handle sharing without a DAG — a mirror is an *alias of the same agent entity* (same memory/tools/generation), so the tree stays clean and every edge stays 1:N.
- **Side panel** (Labs `Sheet`): tabs Identity / Memory / Tools / Generation & Eval.
- **Tech substrate (confirm at review):** React Flow (xyflow) + an auto-layout pass (elkjs or dagre, `direction: DOWN`). The strict 1:N tree makes layout trivial and stable.

> Strict super→sub is **1:N** (every node has exactly one parent) → the canvas is a clean tree; M:N is for faculty *sharing*, not delegation topology.

---

## 9. Lineage — three personal projects merged

The platform merges three projects, each strong where the others are silent:

| Project | Contributes | What to lift |
|---|---|---|
| **Notes** (knowledge vault) | the **memory model** — typed attribute/relation registry + flat data points + graph queries | the *model*, re-expressed as Postgres/AGE/pgvector (not the markdown) |
| **Zuzucodes Labs** | the **tool layer** — registry, schema validation, OpenAI/Anthropic/MCP tool-def converters, **sandboxed code execution** (CF Containers + Durable Objects), secrets, Composio | `lib/tool-definition.ts`, `lib/script-args.ts`, the sandbox runtime contract. *Not* liftable: Supabase-auth coupling, Labs' credits, the Next.js playground |
| **Flow Engine** | the **core engine** — save-time compiler, executor (LLM+tool loop), 4-tier budget cascade, durable execution via **Cloudflare Workflows**, node/graph data model, a rich but **dormant A2A spec** | the Workflows orchestrator, executor loop, budget cascade, compiler, node/graph model, the A2A spec |

**Substrate decisions:** engine = **Cloudflare Workflows only** (one substrate; `waitForEvent` for human/A2A gates; the Durable-Object "actor" is demoted to an optional streaming side-channel). Tool code runs in **Labs' sandbox**. Knowledge/Memory = **off-edge Postgres/Neon** (AGE/pgvector aren't CF primitives) — so the engine is **coordination-heavy, not compute-heavy**. **A2A = the execution contract applied recursively** (agent-to-agent = one agent holding a handle to another's run); the invocation contract carries **caller-identity + a shared decrementing budget envelope** from day 1 (which doubles as the cycle/runaway kill — a cycle dies when the envelope hits zero).

---

## 10. v1 scope & explicit cuts

**In v1:** the Agent/Generation/Run entities; the **Proposal** entity + a human **promotion inbox**; the trace-miner with the cheap, unambiguous signals first (*retire unused tool*, *high tool-failure*, *entity-resolution miss*); operation-level eval lens for Actions + Knowledge; guardrails-in-generation via the inspector pipeline; tool + memory versioning feeding the generation pin; memory L0→(L1); tools through L2 (Labs sandbox); multi-agent L1 (hierarchical + pipeline); M:N schema + identity + shared-budget *modeled*.

**Cut (named):** auto-implement / auto-crystallize (always human-gated in v1) · agent-self-proposal (trace-miner only first) · adversarial/security hardening (separate later ladder) · tool-version *branching* (linear immutable only) · public tool marketplace · semantic tool retrieval (hand-assign small sets first) · temporal/as-of memory querying + physical snapshots (fixtures + traces suffice; prefer Neon COW branching if true historical re-execution is ever needed) · multi-provider routing (Workers AI to start) · Notes' self-evolving schema · live token streaming · always-on multi-client agents · debate/consensus/blackboard.

---

## 11. Grounding & prior art

The design is grounded in a structured audit of **100 open-source agent harnesses/frameworks** plus five source-level audits of the closest prior art. The full material lives in [`inspiration/`](../inspiration/); the essentials:

### The field survey ([`inspiration/agent-harness-survey.md`](../inspiration/agent-harness-survey.md))
An exhaustive, educative reference organized by the **primitive entities of an agent** (Part I — the agent: model, instructions, loop, planning, working-state, goals, tools, tool-infra, memory types & substrate; Part II — orchestration/runtime: topologies, delegation, durable execution, scheduling, persistence, gateway, extensibility; Part III — observability, evals, generations, budget, governance, guardrails, tickets, UI). For each: *what it is*, *the design space*, *how the field does it* (citing specific projects), and *the recommendation for us*.

**Where our decisions override the field's dominant patterns:** "snapshot/fork the run state for generations" → **pin definitions, observe data** (snapshots are eval substrate, not the generation model); "model the org as an arbitrary DAG" → **strict 1:N tree + mirror aliases**; "add cron/Temporal/Inngest as the runtime" → **CF Workflows only**; "flat per-call cost caps" → **shared decrementing budget envelope** up the recursive tree.

**Top borrows (by leverage):** ① a typed append-only tree-shaped **trace**, one schema (the keystone — build first) → ② versioned-definition-row + `isActive` + `forkedFrom` generations → ③ a middleware/hook stack as the universal extensibility seam → then `reportsTo` self-FK org model, delegation-as-a-tool, durable `waitForEvent` HITL, shared budget envelope, tool-trace-as-eval-assertion, a unified Score table, per-faculty memory extractor + gatekeeper, schema-from-signature + effect-class, MCP as the tool protocol, spec-vs-instance sandbox, secret redaction, approval inbox, run-pulse visualization, proposal-first self-improvement, and **tickets (net-new — flagged, not assumed)**. Two near-twins to read cover-to-cover: **paperclip** (structural template — org DB model, ticket/dependency split, wakeup queue, locks) and **lobe-chat** (feature reference — tiered governed memory, supervisor enum, generation-tracing, approval-gated nightly self-review).

### The five source-level audits ([`inspiration/`](../inspiration/))
- **entire.io** ([`entire-io-host-adapter-audit.md`](../inspiration/entire-io-host-adapter-audit.md)) — the closest prior art to our host-adapter layer. The blueprint for the **observe path**: `Agent` + optional `HookSupport`/capability interfaces + registry; one normalized `Event` (the basis of our trace schema); per-agent native hook-writer + one callback binary + graceful degradation; `RedactedBytes` redact-at-write; git-branch-as-storage for local-native mode. *entire stops at system-of-record (capture + link to commits); it does not evaluate or evolve — that graduation engine is our wedge.*
- **Claude Code pricing** ([`claude-code-pricing-audit.md`](../inspiration/claude-code-pricing-audit.md)) — the verified basis for interactive-mode-first (§7). **Verified-vs-directional split is explicit**; don't quote the directional numbers externally without re-checking.
- **Model/provider agnosticity** ([`model-provider-agnosticity-audit.md`](../inspiration/model-provider-agnosticity-audit.md)) — the two-needs split and config schema (§6). Grounded in goose/hermes/aider/continue/litellm. **Caveats:** Claude Code is closed-source (its adapter must be reverse-engineered from CLI flags / stream-json); MCP-Sampling migration is unprecedented in all audited repos; the OpenClaw repo's metadata is implausible (~377k stars) → **lean on goose/hermes; treat OpenClaw as corroborating-only**.
- **supermemory/smfs** ([`supermemory-smfs-audit.md`](../inspiration/supermemory-smfs-audit.md)) — proves the **filesystem** serving surface; copy the serving interface + crash-safe SQLite push-queue + `dirty_since` versioning + delimiter-block instruction injection + tool-description-as-contract. **But its heavy lifting is cloud-dependent (Supermemory SaaS)** — we are local-first, so copy the interface/cache patterns, **not** the cloud extraction/index.
- **Terminal-first runtime** ([`terminal-first-runtime-research.md`](../inspiration/terminal-first-runtime-research.md)) — verification research. **OpenClaw VERIFIED** ("a harness that manages everything except the LLM's reasoning" — our exact shape); **Hermes VERIFIED** (self-improving, extracts skills after 5+ tool calls — validates evolving Actions); **Pi/pi-dev UNVERIFIABLE**. **Honesty flags:** MCP **Sampling is NOT host-supported today** (Claude Code issue #1785); **Elicitation IS** (Claude Code); ACP proxy chains are the emerging standard but barely adopted (Zed only).

> **Citation honesty (carried from the research):** the foundational works behind the tool-evolution arc — Voyager, LATM, CRAFT, ToolLibGen, DSPy/LLMCompiler, Gorilla/ToolGen, babyagi, claude-engineer, and the misevolution/eval-gaming literature — are real and load-bearing. A cluster of very-recent (late-2025/2026) preprints surfaced during research are **unverified leads** — verify each before citing as authority.

---

## 12. Build order & open questions

**Build order (incremental; each slice independently useful):**
1. **Trace capture** (Claude-Code-first, local) — the keystone ← *the thing to build first*
2. Faculty serving (MCP / filesystem / instruction-file)
3. The four faculties (Memory · Knowledge · Actions · Guardrails)
4. The evolution/graduation engine (the differentiator — deliberately last; it consumes 1–3)

**The first vertical slice that proves the whole loop end-to-end:** run an agent → emit a trace → run the Actions+Knowledge eval lens over it → the trace-miner files one *retire-unused-tool* or *high-failure-upgrade* proposal → it appears in the promotion inbox → a human approves → a new generation is pinned with the changed tool-set → the Evolution tab shows gen N→N+1 with the eval delta.

**Open questions (non-blocking):**
- Trace-miner: rules-based first (n-gram recurrence, failure thresholds) vs an LLM-judge pass — start rules-based.
- Proposal granularity: per-signal vs a batched per-agent "graduation review" — lean batched/scheduled.
- **AGE vs relational+CTE+pgvector** benchmark (the memory top-tier "prove-it").
- **Workflows prove-it:** can one CF Workflows instance host a multi-round agent loop within execution/duration limits? (`waitForEvent` solves *pause*, not *loop-length*.) — note: largely dissolved by running only the *evolution* loop on Workflows, not the agent loop.
- **Trace schema:** must capture per-tool input+output per call, tagged by tool+version, replayable — it powers both the eval lens and golden-replay.
- Episodic Memory vs semantic Knowledge substrates (likely different); whether Cognition evolves on a substrate ladder of its own; whether Actions/Memory/Knowledge share retrieval infra at the vector tier.

---

*This README consolidates the prior concept and design docs into one entry point. The source audits and the full 100-project survey remain under [`inspiration/`](../inspiration/) as the reference shelf.*
