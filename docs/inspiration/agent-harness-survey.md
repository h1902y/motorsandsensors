# Agent Harness & Framework Survey — by Primitive

> **Status:** survey + synthesis, rev. 2026-06-02. Source: structured audits of 100 open-source AI agent harness/framework projects (per-repo notes in `~/Documents/agent-harness-audit/notes/`).
> **Purpose:** an *educative, exhaustive* reference for zuzuagents — a build-your-team multi-agent platform. It is organized around the **primitive entities of an agent** and the **components of agentic infrastructure**: for each primitive you get *what it is* (taught from first principles), *the design space* (the axes real systems vary on), *how the field does it* (exhaustively, citing specific projects), and *for zuzuagents* (a recommendation mapped to a concrete surface).
> **Grounding:** [`agentic-platform-concept.md`](../agentic-platform-concept.md) (four faculty ladders, generations-as-pinned-definitions, CF-Workflows runtime, M:N entities) and [`design-system-and-canvas.md`](../design-system-and-canvas.md) (hexagon agent node, 1:N tree canvas, mirror aliases, side-panel tabs).
> **Surfaces referenced in recommendations:** `org chart · agent detail · memory · tools · generations/evals · tickets · budgets · dashboard · runtime`.

---

## Glossary — the primitives at a glance

**Part I — the agent** (what composes a single agent):

| Primitive | One line |
|---|---|
| Model & inference | The LLM call + the layer that picks the model, forces output shape, retries/reroutes. |
| Instructions / persona / role | The system prompt: who the agent is, its remit, the live context spliced in. |
| The agent loop | think → act (tool) → observe → repeat, until a terminal signal; plus the rails that stop it. |
| Planning & decomposition | Breaking a goal into ordered subtasks; separating planner from executor. |
| Working state & session | Managing the in-flight transcript (compaction) and persisting a run for resume/replay. |
| Goals & objectives | The objective + its checkable "done" criteria; the mission→task cascade. |
| Tools & function calling | Showing tool schemas, parsing tool-calls, running them (sometimes in parallel). |
| Tool infrastructure | The catalog plumbing: registry, MCP, sandbox/code-exec, effect classes, approval. |
| Memory types | Durable memory tiers — working / episodic / semantic / procedural; reflection. |
| Memory substrate | Where memory lives (vector / graph / relational) + extraction, resolution, retrieval, scoping. |

**Part II — orchestration & runtime infrastructure** (the platform that runs agents):

| Primitive | One line |
|---|---|
| Multi-agent topologies | The wiring: single / supervisor / swarm / graph / message-bus / control-plane. |
| Delegation, reporting & org | Who may hand work to whom; the persisted reporting graph; delegation-as-a-tool. |
| Runtime & durable execution | The loop runner + crash-survival: ownership locks, recovery, liveness. |
| Scheduling, triggers & heartbeats | When agents wake: cron / webhook / event / heartbeat; wake queues + policies. |
| Persistence & data model | The DB behind it: runs, locks, transitions, reporting edges; OLTP vs telemetry. |
| Model gateway & routing | One interface over many providers: fallback, caching, cost metering. |
| Extensibility | BYO-agent adapters, plugin SDKs, capability gating — new capability without forking. |

**Part III — observability, governance & product surfaces**:

| Primitive | One line |
|---|---|
| Trace & observability | The typed, append-only, tree-shaped record of every run (the keystone artifact). |
| Evaluation & scoring | Assertion / LLM-judge / human / rubric scoring; datasets; regression. |
| Versioning & generations | Versioning an agent's *definition*; rollback; prompt-drift guards. |
| Budget & cost control | Token/cost accounting; per-scope budgets; hard-stop; quotas. |
| Governance, approvals & HITL | Approval gates; pause/resume/override/terminate; the human stays in charge. |
| Guardrails, safety & secrets | Input/output guardrails; redaction; secret injection; isolation. |
| Work items / tickets / queues | Issues, dependencies, assignment, queues (net-new for zuzuagents — see §). |
| UI/UX surfaces | Org-chart canvas, run-pulse, trace inspectors, approval inbox, dashboards. |

---

## 0. Where zuzuagents' decisions OVERRIDE the field (read this first)

Each of the 100 projects pushes its own model. Four collide with decisions already made in the concept doc. **When the field says X and zuzuagents decided Y, Y wins** — the survey routes the field's pattern to where it *does* fit:

| Field's dominant pattern | zuzuagents' decided position | Reconciliation |
|---|---|---|
| **"Snapshot/checkpoint/fork the run state for generations + rollback"** (langgraph checkpointer, letta `BlockHistory`, burr fork-to-new-id, strands `Snapshot`, autogen `save/load_state`) | **A generation is an immutable pin of *definitions*** (prompt + model + tool versions + memory-schema version + attached refs); runtime data is observed via traces. *"Pin definitions, observe data."* | These snapshot patterns are **trace-store / eval substrate** (runtime data), **not** the generation model. The correct generation cluster is the **versioned-definition-row + active-pointer + `forkedFrom`** lockfile model. |
| **"Model the org as an arbitrary DAG / directional graph"** (agency-swarm `A>B`, autogen `DiGraph`, langgraph `Command(goto)`) | **Strict 1:N delegation tree + mirror aliases.** M:N is for faculty *sharing*, not delegation topology. | DAG patterns map onto **1:N + mirror nodes**; blackboard/shared-state maps onto **one Memory entity attached to N agents**. |
| **"Add cron/Temporal/Inngest/APScheduler/Celery as the runtime"** (goose `tokio-cron`, dify Celery beat, khoj APScheduler, agent-kit Inngest, julep Temporal) | **CF Workflows only**, `step.waitForEvent()` for durable human/A2A pause. | **Conceptual analogs**, not adoptions. Closest human-gate analogs: paperclip's DB-backed wakeup queue + agent-kit's durable-wait HITL — borrow the *shape*, implement on Workflows. |
| **"Flat per-call token/cost caps"** (most frameworks) | **Shared decrementing budget envelope** carried in the recursive invocation contract; doubles as cycle/runaway kill. | Borrow the *propagation-up-the-tree* variants: litellm budget-as-shared-object, pydantic-ai/openai-agents `usage` propagation, camel/upsonic rollup. |

## Part I — The agent: core, tools & memory

### Model & inference

**What it is.** Every agent bottoms out in calls to a large language model: a prompt goes in, a token stream comes out. The "inference core" is the thin layer that turns that raw completion endpoint into something an agent can rely on — choosing *which* model answers, forcing the answer into a *shape* the surrounding code can parse (structured output), and retrying or rerouting when a provider fails. It is the least glamorous primitive and the one every other primitive sits on top of.

**Design space.**
- **Provider abstraction.** A single interface over many vendors (OpenAI/Anthropic/Gemini/Bedrock/Ollama/local) vs. hard-coding one. The axis that matters is *where capability differences live* — pushed into the base class (capability flags) or leaked into callers.
- **Structured output strategy.** Three rungs: (1) prompt-and-pray + JSON parse with retry; (2) provider-native JSON/function-calling mode (`response_format`, tool schemas); (3) constrained decoding — mask illegal tokens at generation time so malformed output is *impossible*. Rung 3 only works on models whose logits you control (local), so libraries split "steerable" from "black-box" providers.
- **Routing.** Static (one model per agent) · capability/cost routing (cheapest model that can do the job) · fallback chains (primary→secondary on error/timeout) · per-role model selection (planner gets a strong model, executor a cheap one).
- **Reliability wrapping.** Retries with backoff, timeouts, response caching, token/usage accounting threaded out of every call.

**In the field.**
- **Gateways / routers:** `litellm` is the canonical one-line proxy over 100+ models with fallbacks, per-model caps, and request logging; `agency-swarm` and `cognee` both route through it. `big-AGI` covers 20+ vendors with a custom `LLMManager` + registry; `bolt-diy` wraps ~20 via the Vercel AI SDK with per-provider adapters; `anything-llm` has ~35 provider adapters behind one `ai-provider` interface; `agentscope` lists openai/anthropic/dashscope/gemini/ollama/xai/deepseek/moonshot as pluggable.
- **Per-role / per-agent model selection:** `nanobrowser` takes distinct `navigatorLLM`/`plannerLLM`/`extractorLLM` (planner defaults to navigator's model when unset); `aider`'s architect/editor split runs a strong planning model then a cheaper editor model; `LaVague`'s router picks the *cheapest capable engine*; `khoj` stores the chat-model as an FK on the agent config row.
- **Structured output (validate-after):** `instructor` patches any provider client to return a validated Pydantic `response_model`, with DSL types `Maybe[T]`/`Iterable[T]`/`Partial[T]`/`Parallel`; `atomic-agents` builds on Instructor with a hook bus (`parse:error`, `completion:*`); `cognee` uses litellm + Instructor; `haystack` uses `json-schema-to-pydantic`; `auto-code-rover` runs a dedicated cheap "proxy agent" LLM call just to coerce free text into structure.
- **Structured output (constrained decoding):** `guidance` guarantees structure at the token level via the `llguidance` Rust engine (`gen(regex=…)`, `select([...])`, Lark/EBNF subgrammars, JSON-schema with `extra="forbid"`); `outlines` masks disallowed tokens via an FSM/`Guide`, declares output as `Literal`/`int`/Pydantic/regex/grammar, and splits providers into `SteerableModel` (logit control) vs `BlackBoxModel` (API-native) with per-provider `TypeAdapter`s.
- **Reliability:** `tenacity`-based retries recur across `haystack`/`instructor`/`zep`; `outlines` adds persistent FSM-compilation cache (diskcache + cloudpickle); `agno` deliberately uses dataclasses (not Pydantic) with non-raising `from_dict()` on the hot path so a malformed field can't crash a live run.

**For zuzuagents.**
- Treat the model as a **pinned field of a generation**, not a runtime choice: model id + version live in the immutable generation pin alongside the prompt and tool versions, surfaced on the **generations/evals** surface. Route all calls through a litellm-style gateway so per-agent model swaps are config, and so usage flows into the shared budget envelope.
- Adopt the **steerable-vs-black-box split** (outlines) in the model adapter so reviewer/eval verdicts and tool-call args can be schema-forced where the provider allows and validate-then-retry (instructor) where it doesn't — both feed the same typed **trace**.
- Expose **per-role model selection** on the **agent detail** surface (a manager node may run a strong model, its reports cheaper ones), defaulting an unset child to its parent's model the way nanobrowser does.

---

### Instructions / persona / role

**What it is.** The system prompt is the agent's job description: who it is, what it's allowed to do, how it should behave, and what context it currently has. In a multi-agent system this fragments into a *role* (its place and remit in the team) and a *persona* (voice/style), plus dynamically injected state (memory tiers, reporting line, current task). The central design question is how much of this is hand-written prose vs. assembled programmatically at runtime.

**Design space.**
- **Prompt as code vs. prompt as data.** Hardcoded f-strings · editable template files (Jinja/Markdown) · DB rows · generated-from-config. Externalizing prompts is what lets you version them per generation.
- **Static vs. composed.** A single fixed block vs. a prompt *assembled* per turn from named fragments (role + persona + memory views + tool docs + injected live state).
- **Role granularity.** Free-form persona text · a fixed SOP/role taxonomy (PM/Architect/Engineer) · capability-typed roles (a role is an allow-list of tools/outputs).
- **Dynamic context injection.** A seam where memory tiers, env state, or org context get spliced into the system prompt at runtime, by name.

**In the field.**
- **Prompt-as-editable-file:** `gpt-engineer` keeps system prompts as editable "preprompts" files, not code; `devika` has one Jinja2 template per agent (clean prompt/code separation); `continue`'s agents *are* Markdown files committed to the repo (`.continue/checks/*.md`); `goose` "recipes" are portable YAML/JSON specs (`title/description/instructions/prompt`, parameters, sub-recipes, response schema); `aider`/`crewAI`/`autogpt` use Jinja2 prompt templates; `agentverse` stores prompts as named YAML anchors so non-devs re-skin behavior.
- **Prompt-as-DB-row / config:** `khoj` models the agent as a row with `personality` (system prompt), chat-model FK, `input_tools`/`output_modes` allow-lists, and `privacy_level`; `memary` keeps `system_persona.txt`/`user_persona.txt` as first-class editable artifacts.
- **Composed / generated personas:** `big-AGI` generates a persona "FromText"/"FromYouTube" and uses a `pmix` prompt-template mixer (`replacePromptVariables`) to inject custom fields; `gpt-researcher`'s `choose_agent` uses an LLM to *pick* the agent persona + role prompt per query (dynamic role assignment).
- **Dynamic-context injection seams:** `atomic-agents` `BaseDynamicContextProvider.get_info()` injects into the system prompt at runtime, registered/unregistered by name (one provider per memory tier); `swe-agent` YAML tool bundles carry a `state_command` that injects live env state into the prompt; `LaVague`'s `WorldModel.add_knowledge(file)` appends few-shot examples (a lightweight "skills/playbook").
- **Role taxonomies:** `MetaGPT` encodes a software-company SOP (PM/Architect/PM/Engineer/QA) where `Code = SOP(Team)`; `gpt-researcher` hardcodes 8 named role agents (Chief Editor/Editor/Researcher/Reviewer/Reviser/Writer/Publisher); `agency-swarm` defines roles (CEO/Developer/VA) with `shared_instructions` (an "agency manifesto") broadcast to all agents.
- **Behavioral governance via prompt:** `codel`'s `agent.tmpl` encodes guardrails as instructions ("always emit a plan first", "never repeat a command >3×", "make non-repetitive progress").

**For zuzuagents.**
- Make the system prompt a **versioned field of the generation pin** and edit it on the **agent detail** surface; store it as data (Markdown/template) the way continue/gpt-engineer/khoj do, so a prompt edit creates a new generation with a clean diff (lobe-chat's `promptHash` drift guard is worth copying to catch un-bumped edits).
- Assemble the live prompt from **named fragments** via an atomic-agents-style context-provider seam: one fragment per attached **Memory** faculty + one for org context (reporting line, role) + one per attached **Tool**. This keeps each faculty ladder bolt-on and makes the rendered prompt itself inspectable in the **trace**.
- A node's **role = its tool/memory allow-list + reporting position**, not just prose — mirror khoj's capability-typed agent row so the org chart and the prompt stay consistent.

---

### The agent loop

**What it is.** An agent doesn't answer in one shot; it *iterates*: think → call a tool → observe the result → think again, until the task is done. This is the ReAct loop (Reason+Act). The loop's job is to keep feeding the model its own action history until it emits a terminal signal — and, crucially, to *stop* it from spinning forever. Everything interesting about an agent's autonomy and its failure modes lives in this loop and its termination conditions.

**Design space.**
- **Loop shape.** Pure tool-loop (model calls tools until it stops) · ReAct (explicit thought before each act) · plan-then-act (a plan is fixed, then executed) · stepped/interval (re-plan every N steps).
- **Termination.** Model emits a "done" tool/signal · max-rounds/steps cap · token/time budget exhausted · external (human flips a switch) · loop-detection (output too similar to recent output) · no-progress / stall.
- **Termination as data.** Hardcoded vs. composable `TerminationCondition` objects combined with boolean operators vs. typed end-turn *tools* the model must call.
- **Safety rails.** Max consecutive failures, max actions per step, per-step timeout, repeat-call dedupe.

**In the field.**
- **Tool-loop / ReAct cores:** `openai-swarm` (~290-line loop), `aider`, `open-interpreter`, `smolagents`, `browser-use`, `vercel-ai` `ToolLoopAgent`, `agentscope`'s built-in ReAct, `babyagi`'s `react_agent` (bounded `max_iterations=5` with a `function_call_history` dedupe guard), `big-AGI`'s `react.ts` micro-function.
- **Stepped / interval loops:** `nanobrowser`'s executor runs `while nSteps < maxSteps`, calling the planner every `planningInterval` steps then the navigator once; `LaVague`'s `for _ in range(n_steps)` (observe → instruction → dispatch → update state), terminating on `COMPLETE`/`SUCCESS`.
- **Mode-switchable loops:** `MetaGPT` `RoleReactMode` = REACT (capped by `max_react_loop`) | BY_ORDER (fixed SOP) | PLAN_AND_ACT.
- **Termination as composable objects:** `autogen`'s `TerminationCondition`s combine with `&`/`|` — `MaxMessageTermination`, `TokenUsageTermination`, `TimeoutTermination`, `ExternalTermination` (human switch), `HandoffTermination`, `FunctionCallTermination`.
- **Termination as typed tools:** `marvin` agents never "return" — they call `MarkTaskSuccessful/Failed/Skipped` end-turn tools; `langroid`'s `DoneTool`/`FinalResultTool`; `controlflow`/`autogen` dynamic groups terminate on a `termination_token` like `"DONE!"`.
- **Max-rounds caps:** `Agent-E` (`planner_max_chat_round=50`, `browser_nav_max_chat_round=10`); `anything-llm` (`maxRounds=100`, `maxToolCalls=10`); `agentverse` (`max_tool_call_times=10`, forces `submit_task` on the final turn); `bolt-diy` (`maxLLMSteps=5`); `letta`'s heartbeat loop bounded by `max_chaining_steps`.
- **Loop / stall detection:** `Agent-E` `is_agent_stuck_in_loop()`; `browser-use` `ActionLoopDetector` (rolling-similarity window + nudge) plus `max_failures`, `step_timeout`, `final_response_after_failure`; `cline`'s `loop-detection.ts` + `mistake-tracker.ts`; `plandex`'s `MaxPreviousMessages` guard + should-continue checker; `nanobrowser`'s typed `MaxStepsReachedError`/`MaxFailuresReachedError`.

**For zuzuagents.**
- The per-node loop is the **L0 single-agent rung**; run it inside a Cloudflare Workflow step. Make termination **composable** (autogen-style) so the shared decrementing **budget envelope** hitting zero is just one more termination condition alongside max-rounds and stall-detection — the field's loop-guard generalized to the cycle/runaway kill already in the backbone.
- Prefer **typed end-turn tools** (marvin) over string parsing so the loop's exit reason (`success`/`failed`/`blocked`/`waiting-for-human`) lands as a structured node in the **trace** and drives the **runtime** run-pulse.
- Ship loop-detection + max-failures + per-step timeout as default rails on every node (browser-use/cline), surfaced as runtime knobs on the **agent detail** surface.

---

### Planning & task decomposition

**What it is.** For anything beyond a single step, an agent benefits from breaking a goal into ordered subtasks before (or while) executing — and often from separating the *planner* (figures out what to do) from the *executor* (does it). This primitive is about how one agent structures its own work: producing a plan, decomposing it into a subtask tree, and re-planning when reality diverges. (Handing subtasks to *other* agents is delegation — a separate concern; here we stay inside one agent's head.)

**Design space.**
- **Plan timing.** Plan-once-upfront · interleaved (re-plan every step) · re-plan-on-stall only.
- **Planner/executor coupling.** One model does both · a dedicated planner model emits a plan a cheaper executor follows · a "world model" reasoner picks the next action each turn.
- **Plan representation.** Free-text scratchpad · a typed todo list held in state and exposed as a tool · a subtask *tree* (parent task → children) · a task ledger (facts + plan, updated each round).
- **Decomposition trigger.** Always · agent-decides (a `PlanSubtasks` tool) · on-failure re-decompose.

**In the field.**
- **Planner/executor split (intra-agent):** `LaVague`'s `WorldModel` emits `thoughts/next_engine/instruction` and an `ActionEngine` router dispatches to the cheapest capable sub-engine; `aider`'s architect model produces a plan then spawns a cheaper editor; `Agent-E`'s `PlannerAgent` emits JSON `{plan, next_step, terminate}` while the nav agent executes.
- **Todo-list-as-tool:** `langchain` v1's `todo` middleware holds a `Todo` list (`pending|in_progress|completed`) in agent state and exposes it to the model as a tool; `langchain` Deep Agents adds planning + a virtual filesystem on top of langgraph.
- **Subtask trees / dynamic decomposition:** `marvin` exposes a `PlanSubtasks` end-turn tool for dynamic subtask creation, looped by `while incomplete_tasks and turns < max_turns` picking ready tasks; `camel`'s task-planner node decomposes the main task into a tree and can re-decompose/reassign on failure analysis; `XAgent`/`MetaGPT` (PLAN_AND_ACT) generate a task plan then execute.
- **Task ledgers:** `magentic`/`semantic-kernel` maintain a task-ledger (facts + plan) plus a per-round progress ledger; `autogen`'s MagenticOne orchestrator carries the same.
- **Re-plan-on-stall:** `browser-use`'s planner with `planning_replan_on_stall` / `planning_exploration_limit`; `nanobrowser` re-plans every `planningInterval` steps; `devika`'s plan→research→code flow with an intent classifier.
- **Plan-as-typed-workflow:** `AgentGPT`'s `workLog` queue of typed `AgentWork` objects (StartGoal → AnalyzeTask → ExecuteTask → CreateTask → Summarize); `agentverse`'s four-stage `role_assigner → decision_maker → executor → evaluator` re-run until a score threshold.

**For zuzuagents.**
- Keep this as **intra-node** decomposition. A planner-heavy node can run langchain's **todo-list-as-tool** so its subtask list is observable as typed entries in the **trace** and renderable on the **runtime** surface — without inventing a second control structure. (Cross-agent fan-out is the 1:N delegation tree, covered elsewhere; do not re-derive a DAG here.)
- Borrow LaVague/aider's **cheapest-capable** discipline: a node's planner may be a strong model while the subtask executions reuse a cheaper model, charged against the same shared **budget** envelope.
- Treat a subtask list as ephemeral **working state observed via the trace**, *not* a generation — re-planning mid-run is runtime data, not a new pin.

---

### Working state & session

**What it is.** While an agent runs, it accumulates a conversation/transcript that quickly outgrows the model's context window. Working state is the management of that hot, in-flight buffer — what stays verbatim, what gets summarized, what gets dropped — plus *session persistence*: saving the run so it survives a crash or can be resumed/replayed later. This is short-lived runtime data, distinct from durable Memory (the next primitives) and distinct from a generation (a pin of definitions).

**Design space.**
- **Context management strategy.** No-op (let it overflow) · sliding window (drop oldest) · token-budget eviction (drop until under cap, preserving turn boundaries) · summarize-old (fold history into a running summary via a cheap model) · offload-to-store (page out tool results to disk/cache, retrieve on demand).
- **Compaction trigger.** Fixed threshold ratio · token count · explicit knob (`preserveRecentTokens`, `reserveTokens`).
- **Session persistence.** In-memory only · serialize/restore (dump/load) · checkpoint-per-step (durable, resumable) · event-buffer replay (late joiners replay the run).
- **Granularity.** Per-message · per-turn (turn-id grouped) · per-step snapshot.

**In the field.**
- **Summarize-old (hot vs. summarized tiers):** `aider`'s `ChatSummary` (hot turns verbatim, older turns summarized by a weak model over a token threshold); `bee-agent-framework`'s `SummarizeMemory`; `langchain`'s summarization middleware; `cline`'s `CoreCompactionConfig` (`strategy: basic|agentic`, `thresholdRatio`, `reserveTokens`, `preserveRecentTokens`, dedicated summarizer model); `continue`'s auto-compaction at 0.8 ratio.
- **Sliding / token-budget eviction:** `bee-agent-framework`'s `SlidingMemory` (windowed eviction via `removalSelector`) and `TokenMemory` (token-budget aware, lazy per-message counts in a `WeakMap`); `strands`/`bee` swappable `ConversationManager`; `memary`'s eviction knobs (`CONTEXT_LENGTH`, `EVICTION_RATE=0.7`, `NONEVICTION_LENGTH=5` — always keep system + last N); `atomic-agents`' `_trim_context()` (evicts oldest *complete turns*, emits a warning per eviction); `codel`'s truncate-tail + total-prompt cap.
- **Offload-to-store:** `agentscope`'s workspace `offload_context`/`offload_tool_result` (the sandbox doubles as the page-out store, retrieved on demand); `aider`'s PageRank repo-map as ranked, token-budgeted project working memory.
- **History-processor pipeline:** `swe-agent`'s ordered `HistoryProcessor` chain (the cleanest "context management as a transform pipeline").
- **Session persistence / serialize-restore:** `atomic-agents`' `ChatHistory.dump()/load()` with `turn_id` grouping and `reset_history()`; `bee`'s `Serializable`; `autogen`'s `save/load_state`; `pydantic-ai`'s `BaseStatePersistence`; `langgraph`'s checkpointer (state checkpointed every super-step); `strands`' `Snapshot`.
- **Crash-safe / replayable sessions:** `agentscope`'s `_session_manager` replays persisted + in-flight buffered events to clients joining mid-run; `browser-use`'s `AgentHistoryList` captures every step (thoughts/actions/results/screenshots) with rerun helpers; `agent-kit`/Inngest checkpoint every step so runs survive restart; `zep`'s eval harness uses atomic `checkpoint.py` (write-tmp-then-rename) for `--resume`.

**For zuzuagents.**
- Context compaction is a **transform inside the loop**, not the Memory faculty — model it as a swappable strategy (bee's `BaseMemory`: sliding / token-budget / summarize) configured per node, and log "tokens after eviction" to the **trace** for budget observability.
- Session persistence rides on **Cloudflare Workflows**' durable step checkpointing + `waitForEvent`; the per-step event buffer is the **trace** substrate that powers the **runtime** run-pulse and lets a reviewer open a run mid-flight (agentscope-style replay).
- **Do not treat a session snapshot as a generation.** Per the backbone: pin *definitions*, observe *data*. dump/load and checkpoints are runtime-state substrate for resume/replay/audit — the generation is the immutable definition pin, not the saved transcript.

---

### Goals & objectives

**What it is.** Above the moment-to-moment loop sits the question of *what success looks like*. A goal is the objective the agent is trying to satisfy; in a team it cascades — a mission becomes tasks, tasks become subtasks, each carrying its own completion criteria. The useful design move is making "done-ness" *data*: explicit, checkable success conditions and typed outcomes, rather than leaving it to the model's judgment alone. (Decomposition *mechanism* is Planning; loop *plumbing* is the agent loop; here it's the objective representation and its completion criteria.)

**Design space.**
- **Goal representation.** A free-text goal string · a typed Task object with status · a mission→task→subtask cascade · an objective + explicit success criteria.
- **Completion criteria.** Model self-declares done · success-check predicates (string/URL/content match, test passes) · score threshold · human sign-off.
- **Outcome typing.** Untyped result blob · typed outcome (`success/failed/skipped/blocked`) carrying the result payload + reason · outcome with required sections / reviewer provenance.
- **Goal→task cascade.** Flat goal · leader decomposes into a shared task list and loops until done · per-agent mission log of goal-relevant events.

**In the field.**
- **Goal-string driven:** `AgentGPT` (name an agent, give it a goal; loop StartGoal→Analyze→Execute→Create→Summarize); `LaVague`/`Agent-E`/`browser-use` take a natural-language objective and terminate on `COMPLETE`/`SUCCESS`.
- **Typed outcomes / end-turn results:** `marvin`'s `MarkTaskSuccessful/Failed/Skipped` carry the typed result; `langroid`'s `DoneTool`/`FinalResultTool`; `cline`'s `MissionLogEntry` with `kind ∈ progress/handoff/blocked/decision/done/error` plus `evidence[]` and `nextAction`, and `TeamOutcome`/`TeamOutcomeFragment` (reviewer provenance + required sections).
- **Goal→shared-task-list cascade:** `agno`'s `tasks` `TeamMode` (leader decomposes goals into a shared task list and loops until done); `camel`'s coordinator + task-planner producing a task tree; `autogen`'s `tasks`/MagenticOne ledger.
- **Explicit success criteria as data:** `goose` recipes carry `RetryConfig { max_retries, checks: Vec<SuccessCheck>, on_failure }` — success is *checked*, failure triggers a remediation command then retry; `Agent-E`'s `evaluator_router` picks a String/URL/HTMLContent/Manual evaluator per JSON task config; `agentverse`'s loop re-runs feeding the evaluator's `advice` back until score ≥ 8.
- **Bounded objective revision:** `gpt-researcher`'s `HumanAgent.review_plan` pauses for feedback and `plan_review.py` enforces `max_plan_revisions` (raises `MaxPlanRevisionsExceededError`).
- **Failure as first-class goal signal:** `LaVague` prefixes failed steps `[FAILED]` so the planner reflects on them next turn.

**For zuzuagents.**
- Model a **ticket** as the goal object: an objective + typed outcome (`success/failed/blocked/waiting-for-human`) carrying its result and reason, in the spirit of marvin's end-turn tools and cline's `MissionLogEntry` kinds. This gives the **tickets** surface its schema and makes goal completion a queryable trace node, not a vibe.
- Attach **success criteria as data** to a ticket (goose `SuccessCheck`s / Agent-E's routered evaluators) so the same predicate that decides "done" is reusable as an L1 eval assertion on the **generations/evals** surface — completion criteria and evals are one artifact.
- A manager node's mission→task cascade = decompose-into-a-shared-task-list (agno `tasks` mode) flowing **down the 1:N reporting lines** as child tickets; each child carries its own outcome that rolls up to the parent's.

---

### Tools & function calling

**What it is.** Tools are how an agent affects the world beyond emitting text: search the web, run code, query a DB, call an API. Mechanically, the model is shown a set of *tool schemas* (name + description + typed parameters), it emits a structured tool-call, the harness parses it, runs the matching function, and feeds the result back into the loop. The design centers on keeping the schema, the validation, and the actual function in sync — and on how calls are parsed and (optionally) run in parallel.

**Design space.**
- **Schema source of truth.** Hand-written JSON schema · *derived* from a typed signature/struct (one source of truth) · derived from an OpenAPI spec.
- **Tool-call parsing.** Provider-native function-calling · structured-output coercion · a strict edit/format parser with reflective retry on malformed calls.
- **Parallelism.** One call per turn · parallel tool calls in a single turn (futures) · sequential-with-dedupe.
- **Tool exposure.** All tools always · per-agent allow-list · top-k retrieval (only the most relevant tools shown, to keep the prompt small) · reranked.
- **Authoring DX.** Decorator on a plain function · subclass a `BaseTool` · few-shot `examples` per tool.

**In the field.**
- **Schema-from-signature:** `codel` (`jsonschema.Reflect` from a Go struct); `guidance`/`smolagents`/`pydantic-ai`/`outlines` (callable introspection → Pydantic → JSON schema, `extra="forbid"`); `autogen`'s `@skill` decorator (Annotated type hints double as the schema); `browser-use`'s decorator registry auto-generating per-action Pydantic models + a context-filtered action union; `babyagi`'s Python-type→JSON-schema mapper.
- **Schema-from-OpenAPI:** `agency-swarm`'s `ToolFactory.from_openapi_schema()` (instant tools from any spec, via `datamodel-code-generator`).
- **Uniform plugin/tool contract:** `anything-llm`'s `aibitat.function({name, description, parameters, examples, handler})` — the same shape for built-ins, MCP tools, and user skills, *with a few-shot `examples` field* that measurably improves call accuracy.
- **Parsing + reflective retry:** `aider`'s strict edit-format (search/replace blocks, udiff) validated by a parser — malformed edits trigger reflection/retry; `instructor`/`outlines`/`guidance` make malformed tool-call args impossible (constrained) or auto-reasked.
- **Parallel tool calls:** `griptape`'s `ActionsSubtask` parses tool calls and runs them in parallel (futures), capturing per-action output/errors + Start/Finish events; `instructor`'s `Parallel` DSL type.
- **CoT-in-the-call + budget:** `agentverse` injects a synthetic `thought` arg into every tool's schema (forces chain-of-thought), caps calls at 10, and forces a `submit_task` tool on the final turn.
- **Top-k / reranked tool exposure:** `agentverse` retrieves top-5 relevant tools per agent; `MetaGPT` uses BM25 tool recall; `anything-llm`'s `toolReranker` trims the tool list; `babyagi` does embedding-based tool selection.
- **Tool-call as a trace record:** `AgentGPT`'s `Analysis{reasoning, action, arg}`; `griptape`'s first-class `ToolAction` objects.

**For zuzuagents.**
- Keep tools defined as **typed signatures → schema** (the existing `lib/tool-definition.ts` converters), one source of truth, and adopt anything-llm's per-tool **few-shot `examples`** field — cheap accuracy win on the **tools** surface.
- Make every tool-call a **typed trace node** (`reasoning + tool + args + effect-class + result`) the way AgentGPT/griptape do; this is the unit the **generations/evals** surface asserts over ("expected vs actual tool calls").
- Expose tools to a node via a **per-agent allow-list** (the role's tool set), with top-k reranking only if prompts get large — and constrain tool-call args via the model layer's schema-forcing so malformed calls never reach the executor.

---

### Tool infrastructure

**What it is.** Behind individual tools sits the plumbing that makes a *catalog* of capabilities safe and extensible: a registry to discover and mount tools, a protocol (increasingly **MCP**) to import third-party tool servers, a **sandbox** for executing untrusted code, a way to classify tools by *effect* (read-only vs. write/destructive) so risky ones can be gated, and **approval** machinery for human-in-the-loop confirmation. This is where governance meets capability.

**Design space.**
- **Registry / discovery.** Static list · decorator-registered global registry · auto-discovery (pkgutil/manifest) · DB-stored tool rows · two-tier (built-in core + bundle/code plugins).
- **Protocol.** Bespoke · OpenAPI import · **MCP** (the emerging universal protocol: Tools/Resources/Prompts/Roots).
- **Sandbox.** In-process (no isolation) · out-of-process HTTP service · container (Docker) · cloud sandbox (E2B/Daytona/Modal) · WASM. Often spec-vs-instance split behind one swappable interface, addressed by ID, with pause/resume snapshots.
- **Effect classification.** None · read-only/write/destructive hints (machine-readable) · LLM auto-classifier.
- **Approval.** None · per-tool `requires_approval` flag · a composable inspector pipeline (Allow/Deny/RequireApproval) · argument-aware escalation (out-of-workspace ⇒ require permission).

**In the field.**
- **Registries & plugins:** `autogen`'s `@skill` global registry; `anything-llm`'s MCP "hypervisor" (boots/stops/reloads servers from a JSON manifest, normalizes to the internal contract) + hot-reloadable imported "agent skills" (validated `plugin.json`+`handler.js`, path-traversal guarded); `dify`/`anything-llm` `pkgutil` auto-discovery; `babyagi` (tools are versioned DB rows); `cognee`'s two-tier registry (in-memory built-ins vs. graph-stored `Tool` DataPoints, dotted-path handler resolution + `path_safety`); `openclaw`'s lean-core + bundle/code plugins; `lobe-chat`'s tool-package convention (`manifest.ts`+`executor.ts`+`systemRole.ts`+`client/`+`types.ts`) — and it exposes `agent-management` *as a tool* so agents build agents; `claude-engineer`'s hot-reloadable self-authored `BaseTool`s.
- **MCP as universal protocol:** `goose` (70+ extensions), `composio` (Tool Router Sessions — per-principal isolated MCP surface scoped to toolkits + file mounts), `mcp-servers` (Tools/Resources/Prompts/Roots), `agno`, `letta`, `cognee`, `graphiti`/`zep` (MCP servers), `anything-llm`, `agent-kit`, `bee` — near-universal across TS frameworks.
- **Sandbox (spec-vs-instance, swappable):** `openhands`' workspace interface with Local/Docker/E2B backends (the workspace also owns offloaded context); `swe-agent`'s SWE-ReX (one interface, many deployments); `e2b` (sandbox as a server-side object addressed by ID, create/connect/kill, pause/resume snapshots, per-sandbox egress allow/deny); `phoenix`'s `SandboxBackend` ABC over Daytona/E2B/Modal/WASM; `strands`' WIT+WASM Component Model; `codel`'s per-task Docker (LLM picks the image); `bee`/`agentverse`/`dify` out-of-process code-interpreter-as-a-service; `onyx`'s mitmproxy egress proxy with *proxy-side credential injection* (the sandbox never holds secrets); `letta`'s E2B/Modal/local tool sandboxes.
- **Effect classification:** `mcp-servers`' `readOnlyHint`/`idempotentHint`/`destructiveHint` annotations; `goose`'s LLM `permission_judge` (auto-classify read-only vs. write); `openhands`' spec-vs-instance split.
- **Approval / inspector pipelines:** `goose`'s `ToolInspectionManager` (ordered `ToolInspector`s returning `Allow/Deny/RequireApproval` — permissions/security/repetition all plug in as inspectors); `continue`'s three-level policy (`allowedWithoutPermission`/`allowedWithPermission`/`disabled`, with layered precedence and *argument-aware* escalation when a path is outside the workspace); `agno`'s `@approval` decorator (`required` blocking vs. `audit` non-blocking) + an approvals router; `letta`'s `default_requires_approval` + `approval_request/response` message types; `openhands`' deny→ask→allow permission engine; `cua`'s async pending-approval queue; `langfuse`'s `AnnotationQueue` (per-item locking + assignment); `autogen`'s split proposer/executor agents as a structural sandbox boundary.

**For zuzuagents.**
- Adopt **MCP as the plugin surface** (free ecosystem) and wrap Labs' Containers+DO sandbox behind a single **swappable interface addressed by ID** (e2b/swe-rex shape), tagged with metadata (agent id, node, ticket) so runs reconnect — this is the **tools** + **runtime** seam. Borrow onyx's **proxy-side credential injection** so the sandbox never holds secrets.
- Make **effect class a required field per tool** (mcp-servers hints / goose `permission_judge`): read-only tools run free, write/destructive ones route through the approval gate — this is the backbone's net-new `mode`/effect requirement and it directly feeds the **dashboard** approval inbox.
- Implement governance as a **goose-style ordered inspector chain** (Allow/Deny/RequireApproval) where budget, effect-class, and human-approval are each an inspector; the `RequireApproval` verdict becomes a `waitForEvent` pause on the **runtime** surface, destined for an agno/langfuse-style **approval inbox** on the **dashboard**. Expose `agent-management` itself as a tool (lobe-chat) so the build-your-team flow is agent-operable from the **org chart**.

---

### Memory types

**What it is.** Beyond the in-flight transcript, agents benefit from *durable* memory that persists across sessions. The field has converged on a rough taxonomy borrowed from cognitive science: **working/short-term** (the current context), **episodic** (what happened — events, conversations), **semantic** (facts/knowledge distilled from episodes), and **procedural** (how-to skills). **Reflection** is the process that promotes raw episodes into higher-level insights. The design question is which tiers an agent has, how items move between them, and how that movement is governed (it costs LLM calls).

**Design space.**
- **Tier set.** One flat store · working+long-term · the full episodic/semantic/procedural split · a richer faculty taxonomy (identity/persona/preference/experience/…).
- **Tiers as substrate vs. as views.** Distinct stores per tier · *views/derivations over one substrate* (a raw stream + ranked aggregations).
- **Self-edit vs. background extraction.** Agent mutates memory via tools (`core_memory_append`) · a background job extracts/promotes (episodic→semantic) · scheduled "sleeptime" maintenance.
- **Reflection.** None · importance/recency scoring + insight synthesis · garbage-collection agents.
- **Extraction governance.** Always-extract · agent-decides · propose-then-human-confirms · a *gatekeeper* that decides per-tier whether extraction is worth the cost.

**In the field.**
- **Self-editing tiered blocks:** `letta` (core in-context labeled blocks per persona/human with token `limit`, archival vector passages, recall history; mutated via `core_memory_append/replace`; `BlockHistory` for undo; "sleeptime" background agent reorganizes memory while idle).
- **Scope-ID tiers:** `mem0` (every memory carries exactly one of `user_id`/`agent_id`/`run_id`; **procedural memory a first-class type** distinct from factual; extract-then-consolidate `add()`); `crewAI`'s path-scoped `/org/team/user` with importance+recency rerank; `khoj`'s `(user, agent)`-scoped `UserMemory`.
- **Rich faculty taxonomies:** `agno`'s `learn/` LearningMachine (`UserProfile`/`UserMemory`/`SessionContext`/`LearnedKnowledge`/`EntityMemory`/`DecisionLog`/`Feedback`/`SelfImprovement`, each with its own config + a `Curator` hygiene job); `lobe-chat`'s typed extractors (`identity`/`persona`/`preference`/`experience`/`context`/`activity`).
- **Tiers as views over one substrate:** `memary`'s Memory Stream (raw entity+timestamp) + Entity Knowledge Store (frequency/recency rank), both derived from one KG, with explicit eviction knobs.
- **Episodic→semantic extraction pipelines:** `anything-llm`'s two-phase Observer (proposes facts) → Reflector (classifies user vs. workspace scope, dedupes, persists), gated by idle threshold + min-chats + a `memoryProcessed` flag; `mem0`'s extract-then-consolidate; `cognee`'s ECL pipeline.
- **Reflection / importance scoring:** `AgentVerse`'s generative-agents `reflection.py` (scores each memory for importance + immediacy 1–10, synthesizes higher-level insights, retrieves by recency×importance); `RA.Aid`'s per-tier LLM garbage-collector agents that protect items tied to the active request.
- **Extraction governance knobs:** `lobe-chat`'s `UserMemoryGateKeeper` (returns per-tier `{shouldExtract, reasoning}` to gate cost); `agno`'s `LearningMode` enum (`ALWAYS`/`AGENTIC`/`PROPOSE`/`HITL`, defaulting differently per tier — LearnedKnowledge=AGENTIC, SelfImprovement=HITL); `openhands`/`continue`'s confirmation-gate (list exact items, save only approved).

**For zuzuagents.**
- Compose memory as **per-agent faculties** (mem0 scope-IDs + agno's taxonomy), but realize tiers as **views over one substrate** where possible (memary) to avoid divergent sources of truth — this maps to the decided `L0 markdown → L1 relational → L2 graph → L3 pgvector` ladder. Keep **procedural memory** a distinct tier (mem0) for reusable skills.
- Put a **gatekeeper in front of extraction** (lobe-chat) + a per-tier **LearningMode** (agno: always/agentic/propose/HITL) so promotion cost is governed and surfaced on the **memory** surface; run episodic→semantic promotion as a background job (anything-llm Observer→Reflector + `memoryProcessed` flag) rather than inline.
- Make every memory mutation a **typed trace node** so entity-resolution hit/miss and extraction decisions are free L1 evals; reflection/maintenance runs as a scheduled faculty (letta sleeptime) on the **runtime** surface.

---

### Memory substrate

**What it is.** Underneath the memory *types* sits the storage and retrieval engine: where facts physically live (vector store, graph, relational), how they're extracted and resolved against existing knowledge, how they're scoped to the right owner, how retrieval works (RAG: embed the query, fetch nearest, rerank), and how access is gated. The two dominant substrates are **vector stores** (similarity over embeddings) and **knowledge graphs** (entities + typed relations, often temporal); the high end blends both.

**Design space.**
- **Store type.** Vector (Qdrant/pgvector/Pinecone/Weaviate/Chroma) · graph (Neo4j/FalkorDB/Kuzu/Neptune/AGE) · relational · hybrid (graph + vector + keyword).
- **Temporality.** Snapshot (overwrite on update) · bi-temporal (facts carry `valid_at`/`invalid_at`; never delete, only invalidate — gives as-of queries + audit).
- **Extraction & resolution.** Raw store · LLM extract → entity-resolution/dedup against existing nodes → consolidate.
- **Retrieval.** Pure vector top-k · hybrid (semantic + BM25 + graph BFS) with swappable rerankers (RRF/MMR/cross-encoder) · frequency+recency ranking (no embeddings).
- **Scoping / gatekeeping.** Namespace/`group_id` per owner · scope-ID metadata filters · ACL rows + permission gate (permission-denied returns empty, not error).

**In the field.**
- **Vector / scope-ID:** `mem0` (Qdrant default, multi-signal fused retrieval = semantic + BM25 + entity-linking, pluggable rerankers cohere/HF/llm/sentence-transformer; scope per user/agent/run); `AgentGPT`'s `MemoryWithFallback` (Pinecone→Weaviate on exception); `khoj` (pgvector `VectorField`); `AgentVerse`'s sklearn cosine over OpenAI embeddings (no external DB); `quivr`/`anything-llm` RAG-over-docs.
- **Temporal knowledge graphs:** `graphiti` (bi-temporal: facts carry `valid_at`/`invalid_at`/`expired_at`, never deleted — superseded edges marked invalid; entities + facts + immutable provenance "Episodes"; pluggable Neo4j/FalkorDB/Kuzu/Neptune drivers; `search_config_recipes` combining full-text + semantic + graph-BFS with swappable rerankers RRF/MMR/cross-encoder/node_distance; `group_id` multi-tenancy; Leiden community summaries); `zep` (Graphiti-backed; typed Pydantic ontology whose docstrings *are* the extraction instructions with priority rules; `min_fact_rating` filter + `center_node_uuid` distance reranking + named context templates); `memary` (FalkorDB/Neo4j, multi-graph = one graph per agent, multi-hop subgraph retrieval depth ≤ 2).
- **Memory control planes / ECL:** `cognee` (ECL pipeline → KG + vector index; unified `search()` blending graph + vector + LLM; pluggable graph/vector/relational adapters — Ladybug/Neo4j/Neptune, LanceDB/pgvector/Chroma/Qdrant/Weaviate/Milvus; `memify()` enrichment pass); `mcp-servers`' cheap KG (entities + observations + relations as JSONL).
- **Extraction + resolution:** `mem0`'s extract-then-consolidate `add()`; `graphiti`'s `add_episode` (extract → dedup/resolve against existing nodes → temporal edge invalidation); `cognee`'s Extract→Cognify→Load.
- **Retrieval without embeddings:** `memary`'s frequency+recency ranking (`_select_top_entities`) — dirt-cheap, explainable.
- **Scoping / gatekeeping:** `graphiti`/`zep` `group_id` namespacing; `mem0`'s scope-ID filters + generic `AccessControl` rows + `check_memory_access_permissions()` (checks state + app-active + accessible-id set) + `MemoryStatusHistory`/`MemoryAccessLog` audit tables + lifecycle state machine (active/paused/archived/deleted) + `ArchivePolicy`; `cognee`'s User→Dataset→Data ACLs with **permission-denied → empty result** (no info leakage), per-tenant isolated DBs.

**For zuzuagents.**
- The decided ladder maps cleanly: **L1 relational** + scope-ID metadata (mem0) for the common case, **L2 AGE graph** for entity/relation memory (graphiti/zep shape), **L3 pgvector** for similarity — exposed as **retrieval-as-a-tunable-knob per faculty** on the **memory** surface (graphiti's `search_config_recipes`: RRF for breadth, cross-encoder for precision, `min_fact_rating` for high-trust tiers).
- Build **extraction + entity-resolution as a built-in sub-process** (mem0/graphiti/cognee) and adopt **bi-temporal facts** (graphiti) for the graph tier so "what did this agent know at generation N?" is an as-of query and provenance back to the originating episode feeds memory-operation evals on **generations/evals**.
- Copy mem0's **governance table shapes** (`MemoryStatusHistory` + `MemoryAccessLog` + lifecycle state machine + `ArchivePolicy`) for the **memory** surface's audit view, and cognee's **permission-denied-returns-empty** scoping so the shared-vs-private fact separation (already in the backbone) leaks nothing across the org tree.

## Part II — Orchestration & runtime infrastructure

### Multi-agent topologies

**What it is.** A topology is the wiring diagram for how multiple agents discover, address, and hand work to one another. The choice determines who can talk to whom, where shared state lives, and what the *unit of execution* is — a single loop, a manager's plan, a graph node, or a message landing in a mailbox. The same set of agents can be arranged as a star, a tree, a graph, or a bus, and that arrangement (not the agents themselves) decides how the system scales, fails, and is debugged.

**Design space.**
- *Single-agent tool loop* — one `model + tools + loop-until-done` engine. The irreducible baseline; every other topology is built from these.
- *Supervisor / orchestrator* — a manager agent plans, fans work out to workers, evaluates results, and re-plans. Centralized control; easy to reason about and bound.
- *Swarm / handoff* — peers pass control to one another via handoff messages; whoever holds the "active" token runs. Decentralized, emergent, harder to bound.
- *Graph / state-machine* — execution is an explicit graph of nodes over typed shared state; edges (often LLM-chosen) decide the next node. Deterministic, replayable, visualizable.
- *Message-bus / actor* — agents are addressable mailboxes that exchange typed messages; no one is wired to anyone in particular. Maximally loose coupling.
- *Hierarchical control-plane* — a server runs a "company" of heterogeneous BYO agents with an org chart, tickets, budgets, and governance; the topology is a data model, not a call graph.

*When each is used:* single-loop for a bounded task with a clear done condition; supervisor when work decomposes cleanly and you want auditability; swarm when routing is genuinely dynamic and you accept emergence; graph when you need determinism/replay; bus when agents are independently deployed and lifecycle-decoupled; control-plane when agents are long-lived, heterogeneous, and governed like employees.

**In the field.**
- *Single-agent loop* is the confirmed shippable baseline: `aider`, `open-interpreter`, `browser-use`, `smolagents`, `openai-swarm` (~290 lines), `bolt-diy` (only loop control is `maxLLMSteps: 5`), `superagi` (one ReAct agent run as a step-DAG). Even "multi-agent" `superagi` is really *many independent single agents*, not a team.
- *Supervisor / orchestrator* is the most common multi-agent shape. `agno` `team/mode.py` enumerates four explicit `TeamMode`s — `coordinate` (supervisor picks members + synthesizes), `route` (router to a specialist that returns directly), `broadcast` (same task to all), `tasks` (leader decomposes into a shared task list and loops). `swarms` `HierarchicalSwarm` runs a director→worker loop where the director emits a structured `SwarmSpec` (`plan` + `orders: [{agent_name, task}]`). `camel` Workforce pairs a coordinator + task-planner + worker tree, delegating through a `TaskChannel` (the manager *posts to a queue and never calls workers directly* — the cleanest decoupling). `Agent-E` runs a two-tier `PlannerAgent` → `browser_nav_agent`/`executor` nested chat (planner never touches the browser). `semantic-kernel` and `magentic` use a manager that maintains a **task ledger** (facts + plan) plus a per-round **progress ledger** that re-evaluates. `lobe-chat`'s `GroupOrchestrationSupervisor` exposes a *typed instruction enum* (`call_agent` / `parallel_call_agents` / `delegate` / `finish`) bounded by `maxRounds` — the most testable supervisor in the set. `aider`'s architect→editor split (planning model spawns a cheaper editor model) is the minimal two-agent supervisor.
- *Swarm / handoff*: `openai-swarm` (a handoff *returns* the next Agent), `autogen` `SwarmGroupChat` (routing by explicit `HandoffMessage`), `agency-swarm` (`send_message` bound per sender→recipient edge), `crewai`/`llama_index` (`handoff(to_agent, reason)` gated by a `can_handoff_to` allow-list). `marvin` notably **deprecated** its emergent-collaboration `Team` because "emergent collaboration under-delivered" — a field warning against relying on self-organization.
- *Graph / state-machine*: `langgraph` (Pregel super-steps + checkpointers), `burr` (state machine, `@action(reads/writes)`), `controlflow` (Tasks over Prefect), `autogen` `_graph` `DiGraph` (declarative who-talks-to-whom), `dify`/`langflow`/`autogpt`/`ChatDev 2.0` (visual node graphs; ChatDev nodes can be agents/models/humans/python/subgraphs with conditional edges), `agentverse` (a swappable rule pipeline `role_assigner → decision_maker → executor → evaluator` re-run to a score threshold). `agentverse`'s `decision_maker` topologies are explicitly named — `vertical` (manager + reviewing reports), `horizontal`, `central`, `dynamic` — i.e. the org shape is a *selectable strategy*. `semantic-kernel` generalizes this with `OrchestrationBase` subclasses (`sequential` / `concurrent` / `group_chat` / `handoffs` / `magentic`) over one actor runtime.
- *Message-bus / actor*: `metagpt` (`Environment` routes by `member_addrs`; roles `_watch(actions)` and react to messages, with a "carry all context to the delegate" guardrail), `langroid` (Actor-model `Task` tree — `task.add_sub_task()`, children run their own loops and return to the parent), `uagents` (decorator handlers + manifest digests for addressing), `autogen` `SingleThreadedAgentRuntime` (pub/sub topics + subscriptions), `codel` (per-flow goroutine + buffered channel + explicit stop channel — a per-tenant actor). `Agent-E` adds a `NotificationManager` pub/sub *for observability* (typed PLAN/STEP/ACTION/ANSWER messages to the UI) layered over a supervisor core.
- *Hierarchical control-plane* (zuzuagents' own category): `paperclip` (Node + Postgres; `agents.reportsTo` recursive FK; "if it can receive a heartbeat, it's hired"), `lobe-chat` ("hire, schedule, and report on a team of agents 7×24"), `agno` AgentOS (50+ REST endpoints, RBAC), `superagi`, `autogpt`. These are *not* agent frameworks — they run BYO heterogeneous agents.
- *Map-reduce / scatter-gather* as a sub-topology: `langgraph` `Send`, `burr` `MapActions` (hashed child IDs), `gpt-researcher` (Editor compiles a child subgraph per outline section, `asyncio.gather`, merge), `big-agi` Beam (scatter N models → human-in-the-loop fuse).

**For zuzuagents.** The spine is **hierarchical control-plane** (paperclip/lobe-chat shape) over a **graph/durable runtime** core (CF Workflows), with the **single-agent loop as the L0 rung inside each node**. The supervisor topology is the canonical execution shape — adopt lobe-chat's *typed instruction enum bounded by `maxRounds`* and camel's *post-to-a-channel-never-call-directly* decoupling for the **org chart + runtime** surfaces. Arbitrary-graph and swarm patterns map onto the decided **strict 1:N tree + mirror aliases**: a converging edge (two managers → one worker) becomes a **mirror** (alias of the same agent entity under a second parent), and the DAG frameworks (autogen `DiGraph`, langgraph `goto`) collapse to "same agent appears under two parents." Heed `marvin`: pair the org chart with *explicit* routing/governance — never rely on emergent self-organization. Offer agentverse-style named topologies (`vertical`/`horizontal`/`central`) as selectable team structures on the **org chart** surface rather than hard-coding one.

### Delegation, reporting & org structure

**What it is.** Delegation is how a parent hands a unit of work to a child and (usually) gets a result back; reporting structure is the persisted graph of *who may delegate to whom*. In agent systems the mechanism is almost always a **tool** the parent calls, and the structure is almost always a **recursive self-FK** in a database. Keeping the *structural* edge (who reports to whom) separate from the *dependency* edge (what blocks what) is the single most important modeling decision here.

**Design space.**
- *Delegation-as-a-tool* — the manager holds a `delegate`/`handoff`/`send_message` tool scoped to its direct reports; calling it is the delegation. Dominant and recommended.
- *Supervisor state machine* — the manager doesn't call workers directly; it posts orders to a channel/ledger and a runtime dispatches them.
- *Handoff allow-lists* — an explicit `can_handoff_to` set per agent constrains the reachable graph (vs. letting any agent address any other).
- *Reporting model* — design-time `parentId` (the org chart) vs. runtime `parent-run` (the per-execution call tree); whether structure and dependency are one edge or two; single-assignee vs. shared ownership.

**In the field.**
- *Delegation-as-a-tool* is near-universal: `openai-swarm` (handoff returns an Agent), `agency-swarm` (per-edge `send_message` `FunctionTool`, with `send_message_tool_class` overridable *per reporting edge* — sync reply vs fire-and-forget vs handoff), `swarms` (`SwarmSpec`/`HierarchicalOrder` — machine-checkable, auto-logged, with an `agent_roles.py` enum of ~30 named roles: supervisor/director/reviewer/auditor/qa), `crewai`/`semantic-kernel`/`llama_index` (`handoff(to_agent, reason)` gated by `can_handoff_to`), `smolagents`/`openai-agents` (two-axis: `Agent.as_tool()` for bounded subtask-return vs Handoffs for control transfer), `bee` (`HandoffTool` instances — a manager holds handoff-tools for its reports), `cline` (`spawn_agent` tool creating a delegated child session).
- *Supervisor state machine / channel*: `camel` `TaskChannel` (manager posts, never calls), `metagpt` `TeamLeader.publish_team_message(send_to=member)`, `lobe-chat` typed `SupervisorInstructions` enum, `agentverse` `vertical` decision-maker. `babyagi` uses *triggers* — a function registers to fire when another completes (reactive, heartbeat-free delegation).
- *Org-chart data model*: `paperclip` is the template — `agents.reportsTo` recursive self-FK carrying role/title/capabilities/permissions/`budgetMonthlyCents`/status; a **single-assignee invariant** on issues (`assigneeAgentId` XOR `assigneeUserId`); and the deliberate **split of structure (`parentId` = work breakdown + rollup) from dependency (`blockedByIssueIds` = can't continue until X changes)**, with goal ancestry travelling on every issue so agents see the "why." `cline`'s `shared/team/types.ts` is a near-turnkey schema (`TeamTask` with `dependsOn` chains, `TeamMailboxMessage` for `fromAgentId→toAgentId` routing) but ships only a 2-level lead/teammate structure via a `parentAgentId` pointer — arbitrary depth must be built on top. `langroid`'s `Task` tree *is* a reporting hierarchy in code. `agno`/`agentops` have flat RBAC roles (`OrgRoles`, `resource:<id>:action` scopes) but *no reporting lines* — a differentiator gap.
- *Design-time vs runtime trees*: `autogpt` `parentGraphExecutionId` self-relation (a per-run execution tree, distinct from the org chart), `lobe-chat` `parentOperationId`, `cline` derived child IDs encoding lineage (`root__teamtask__agent__nanoid`), `babyagi`'s dual self-FK Log (`parent_log_id` for nesting + `triggered_by_log_id` for causality) — one table yielding both the call trace *and* the delegation graph. `helicone` derives the tree at read time from a flat log + a `path` header (`/parent/child`).
- *Notable gaps*: `agency-swarm` has strong delegation but no memory tiers/budget enforcement; `superagi`/`khoj` run many agents but have *no reporting lines at all*.

**For zuzuagents.** The decided **strict 1:N tree** *is* `paperclip`'s `reportsTo` recursive self-FK — adopt it for the **org chart** surface, and adopt the *structure-vs-dependency split* and *single-assignee invariant* wholesale (this lives in the persistence model). Reporting lines = **which agents' handles a node holds**; implement delegation as a tool scoped to direct reports, with a `can_handoff_to`-style allow-list and a *logged reason* (swarms' `SwarmSpec` reasoning field) so every delegation is an audit-trail entry feeding **tickets**. Keep design-time `parentId` distinct from a runtime `parent-run` edge. Converging edges → mirror aliases. Borrow agency-swarm's *per-edge tool-class override* to let a reporting edge be sync-reply vs fire-and-forget.

### Runtime & durable execution

**What it is.** The runtime is the loop that actually advances an agent — pop work, call the model, run tools, decide whether to continue — and *durable* execution means that loop survives a process crash, redeploy, or a multi-hour human pause and resumes exactly where it left off. The hard problems are not the loop itself but the surrounding guarantees: who *owns* a run (so two workers don't double-spend), how a half-finished run is reconciled after a crash, and how the loop detects it has stalled.

> Scope note: this section is the *execution mechanics*. Crash-recovery *data* (run records, locks) is detailed under Persistence; the *generation* model (pinned definitions) and *eval/trace* tables are owned by other sections and are not "checkpoints of the run."

**Design space.**
- *The loop runner* — in-process loop vs persisted **step-DAG advanced one task at a time** (pausable/resumable by construction) vs per-entity goroutine/queue.
- *Durability substrate* — hand-rolled checkpointing vs an external durable engine (Temporal/Inngest) vs an append-only transition log replayed deterministically.
- *Lock model* — a single "is-running" flag vs the **checkout (ownership) lock distinct from the execution (live-run) lock** — the split that prevents double-work and runaway spend.
- *Crash recovery* — startup reconciliation (reap orphans, resume queued, re-claim stranded work) and *liveness contracts* (every non-terminal item must have a typed next-action or be visibly "stalled").
- *Loop safety* — step/turn caps, loop-detection, budget-zero kill.

**In the field.**
- *Durable engines as the substrate*: `agent-kit`/Inngest (steps are checkpointed; HITL = `step.waitForEvent("approval", {timeout, match: ticketId})` *inside a tool handler* — survives restarts, free timeout/escalation), `julep` on **Temporal** (every run is an `Execution` with an append-only **transition log**: `queued→starting→running→{awaiting_input}→succeeded/failed/cancelled`; transition types `init/start/step/wait/resume/finish/error/cancel`; resumability and retries come from Temporal, not hand-rolled; HITL is a first-class `awaiting_input` *state* resumed by a `resume` transition), `controlflow` on Prefect 3.0. `superagi` models a run as a **persisted step-DAG advanced one Celery task at a time**, so pause/resume is free and `WAIT_STEP` is just a graph node.
- *The reference durable control-plane*: `paperclip`'s `doc/execution-semantics.md` is the deepest treatment in the set — an **atomic checkout** (`checkoutRunId` ownership lock vs `executionRunId` live run, kept distinct → no double-work, no runaway spend); a **liveness contract** (every non-terminal agent-owned issue must answer "what moves this forward next?" via a typed action-path primitive — active run / queued wake / monitor / interaction / approval / human owner / blocker chain / recovery action — else it is "stalled" and surfaced, *never* silently completed from prose); a **5-step crash/restart reconciliation** (reap orphaned running runs, resume queued runs, reconcile stranded assigned work, scan silent active runs, reconcile reviews); a **silent-run watchdog** (output silence classified ok/suspicious/critical/snoozed with source-aware "folding"); and a **cheap-model recovery lane** (`allowDeliverableWork:false`, `resumeRequiresNormalModel:true`) for cost-efficient liveness repair. `cline`'s `TeamRunRecord` carries the same primitives at the row level: `heartbeatAt`/`lastProgressAt`/`currentActivity`, a `leaseOwner`, and `retryCount`/`nextAttemptAt` backoff.
- *Hand-rolled loops*: `codel` (per-flow goroutine: pop → process → `getNextTask` → enqueue; stop = close the channel), `AgentGPT` (the whole loop runs *in the browser* over a `workLog` queue — a cautionary anti-pattern: a platform with budgets/audit needs *server-side* durable orchestration), `devika` (an append-only per-project JSON state-stack that doubles as audit + pause/resume checkpoint).
- *Mid-run governance/HITL*: `superagi` `WAITING_FOR_PERMISSION` + `AgentExecutionPermission` (per-tool approve/reject), `mastra`'s `cost-guard` processor (budget caps scoped `run|resource|thread` over time windows `1h..365d`, aborting via a `TripWire`), `dify` `human_input_*` (typed pause/resume), `pydantic-ai` `DeferredToolRequests/Results` (suspend, resume with approve/deny/override-args), `strands` `Interrupt` serialized into session state, `cline`'s file-based approval IPC gate (request file polled for an approval/denial, timeout→denied — works headless).
- *Loop-safety primitives*: `swe-agent`/`autogen` step/turn caps, `browser-use`/`cline` rolling-similarity loop-detection nudge, `plandex` `MaxPreviousMessages` guard + should-continue checker, `bolt-diy` `maxLLMSteps: 5` (the *only* control it has — a GAP signal).

**For zuzuagents.** The decided substrate is **CF Workflows + `step.waitForEvent()`**; Temporal/Inngest/Celery are *analogs to learn from, not adopt*. The closest analogs are `agent-kit`'s durable-wait HITL (approval keyed to a work item, durable wait, timeout-as-escalation) and `julep`'s append-only transition-log state machine (adopt the `init…finish/error/cancel` lifecycle verbatim as the ticket/run lifecycle). **Read paperclip's execution-semantics doc cover-to-cover before building the runtime surface** — the checkout-vs-execution lock split, the liveness contract, the 5-step reconciliation loop, and the silent-run watchdog are battle-tested details zuzuagents will otherwise rediscover painfully. The decided **shared decrementing budget envelope hitting zero** is the generalized loop-guard (mastra's `cost-guard` TripWire is the cleanest expression); layer step/turn caps and similarity loop-detection on top.

### Scheduling, triggers & heartbeats

**What it is.** Scheduling decides *when* an agent wakes up to do work it wasn't explicitly asked to do right now: on a cron, on an external event (webhook), when another agent finishes, or on a periodic heartbeat. The recurring lesson across the field is uniform: every fire should **spawn a fresh run and write a durable run-history row** — never mutate in place — and a queue between "wake requested" and "wake executed" buys you coalescing, idempotency, concurrency control, and catch-up.

**Design space.**
- *Trigger kinds* — cron/recurring; webhook/external event; event-driven (one agent's completion fires another); on-demand wake; periodic heartbeat poll.
- *Queue semantics* — DB-backed wakeup queue (coalescing + idempotency keys) vs in-memory scheduler vs poll-the-next-run-index.
- *Concurrency & catch-up policies* — skip-if-running, queue, or fire-all-missed; per-fire fresh-run + history row.
- *Distribution* — leader election / process-locks for exactly-once across replicas; time-bucket sharding to spread heavy periodic load.

**In the field.**
- *DB-backed wakeup queue (the gold standard)*: `paperclip` `agent_wakeup_requests` with `coalescedCount`, `idempotencyKey`, sources/triggers, claim/finish timestamps, feeding `heartbeat_runs`; plus a `routines` table (cron + webhook + API triggers with **explicit concurrency + catch-up policies**, each execution creating a tracked issue + waking the assignee). "If it can receive a heartbeat, it's hired."
- *Cron subsystems*: `agno` `scheduler/` (`cron.py`/`poller.py`/`executor.py`/`manager.py` — cron + background jobs, no external infra), `cline` `cron/` (hand-rolled parser + **SQLite-backed store** + report writer), `agentscope` APScheduler exposed *to the agent as tools* (`ScheduleCreate/List/Stop/View`, persisted as `ScheduleRecord`), `autogpt` (dedicated Scheduler process + `recommendedScheduleCron` on each graph), `goose` `tokio-cron`, `dify` Celery beat (`workflow_schedule_task`, `queue_monitor_task`), `open-webui`/`dify` (rrule + `next_run_at`-indexed poll + per-run ledger), `litellm` `LiteLLM_CronJob` (thin heartbeat hook).
- *Cron-as-stream + sharding*: `tabby`'s `CronStream` renders a cron schedule as an async `Stream`, with **time-bucketed sharding** (`REPOSITORIES_PER_SHARD`, modulo-by-hour) to spread expensive periodic indexing across runs — a strong throttling trick.
- *Distribution / exactly-once*: `khoj` APScheduler + **Postgres `ProcessLock` leader election** across replicas (`CronTrigger`, cron stored per-automation), `cognee`'s `agent_mode` watchdog (polls every 60s, SIGTERMs the server when active connections hit zero — an ephemeral-runtime pattern).
- *Webhook / event triggers*: `autogpt` `IntegrationWebhook` propagating to nodes (cron + event triggers, not polling), `composio` `Triggers` (subscribe to external events with *versioned* webhook payload schemas V1/V2/V3 + HMAC `verifyWebhook`, delivered via Pusher realtime), `babyagi` triggers (a function fires when another completes — reactive delegation), `anything-llm` child-process job workers gated by cron + a `p-queue`, with per-run rows (`scheduledJob` + `scheduledJobRun`, status `success|failed|timed_out|killed`, SIGTERM handling, push-on-finish).
- *GAP signals (exhaustive coverage)*: `agency-swarm` has *no scheduler* (`watchfiles` is dev hot-reload only); `autogen` `SingleThreadedAgentRuntime` has *no cron/heartbeat*; `atomic-agents`/`auto-code-rover` are one-shot batch with no daemon; `bolt-diy` has no heartbeat at all. Absence is common — scheduling is frequently the thing teams defer.

**For zuzuagents.** Implement on **CF Workflows** (APScheduler/Celery/Inngest/Temporal are analogs). Model the **runtime** surface on paperclip's **DB-backed wakeup queue with coalescing + idempotency keys** rather than an in-memory scheduler, and adopt its `routines` shape (cron + webhook + API triggers carrying explicit concurrency + catch-up policies, each fire → a tracked ticket + an assignee wake). Reporting-line completion firing a subordinate's review/notify maps onto babyagi-style trigger edges. Borrow composio's *versioned webhook payload schemas + HMAC verify* for any external ingress and tabby's *time-bucket sharding* if periodic load ever needs spreading. Every scheduled fire writes a durable run-history row (the **dashboard**/**tickets** substrate).

### Persistence & data model

**What it is.** This is the database behind the orchestrator: the tables that record runs, locks, wakeups, transitions, and reporting edges, plus the ORM/state-store stack choices that hold them. The defining tension is **OLTP entities** (agents, tickets, runs — relational, transactional, queryable) vs. **high-cardinality append-only telemetry** (every tool call, every transition — better in a columnar or cache store).

> Scope note: this covers the *runtime/orchestration* data model only. Memory-tier stores, generation-version tables, and eval/score tables are owned by the memory, generations, and eval sections respectively — referenced here only where they share a table.

**Design space.**
- *Stack* — Postgres+Prisma (TS) or SQLAlchemy/SQLModel (Python); SQLite for local/embedded; Redis for hot counters/locks/queues; ClickHouse/columnar for trace volume.
- *Run/state representation* — append-only transition/event log (replayable) vs mutable run rows + a separate trace store vs serializable state bundle.
- *OLTP/OLAP split* — entities relational, traces columnar; or a fast cache for trace steps + a thin SQL row for lifecycle/aggregates.
- *Key runtime entities* — run record (heartbeat/lease/retry), wakeup queue, checkout/execution locks, transition log, `reportsTo`, ticket/dependency, budget/spend.
- *Pluggable persistence* — one `load/save/list` contract behind swappable backends.

**In the field.**
- *Postgres + Prisma*: `autogpt` (Prisma + pgvector; `CreditTransaction` append-only ledger with `runningBalance`; RabbitMQ for dispatch + Redis for locks/pubsub + separate executor & scheduler processes), `litellm` (Prisma; Redis for hot caches + rate-limit/spend counters), `paperclip` (Postgres; `agents`/`issues`/`agent_wakeup_requests`/`heartbeat_runs`/`budget_policies`/`activity_log`), `big-agi` (hosted branch). `codel` persists history/commands/outputs in Postgres with GraphQL subscriptions for live state.
- *SQLAlchemy / SQLModel*: `babyagi` (every tool is a versioned SQLite row via a pluggable `DBRouter`), `autogen` Studio (SQLModel, SQLite default + WebSocket streaming), `devika`/`khoj` (SQLite/Postgres; khoj layers FastAPI over **Django ORM** + Admin), `dify` (SQLAlchemy + Alembic + Celery), `superagi` (Celery + Redis; `agent_execution_feed` + `call_logs` as the trace).
- *Append-only transition/event log* (the replayable substrate): `julep`/Temporal (Execution + transition log), `devika` (per-project JSON state-stack), `helicone` (flat request log + `path` header → tree derived at read time; `HeliconeRequestType = Tool|LLM|VectorDB|Data`), `controlflow` `CheckpointEventType` enum + pluggable JSON/SQLite providers.
- *OLTP/OLAP split*: `agentops` (Supabase/Postgres for orgs/billing + **ClickHouse** for spans + Redis + OTel Collector — "keep entities relational, push high-cardinality traces columnar"), `helicone` (Postgres + ClickHouse + MinIO/S3 for large payloads), `cognee` (trace steps in a fast cache/FS; the SQL `SessionRecord` holds only lifecycle + aggregate counters, linked by a non-FK string `session_id`; `abandoned` *inferred at read time* from `last_activity_at` — no sweeper job).
- *Pluggable persistence contract*: `burr` `BaseStateLoader`/`BaseStateSaver` (SQLite/Postgres/Mongo/Redis/S3 behind one interface, per-snapshot `status` for review), `julep` microservice split (`memory-store` Postgres as the single store; `scheduler` = Temporal). `litellm`'s **budget-as-shared-object** (`LiteLLM_BudgetTable` attached to Org/Project/Team/User/Key/Agent) and **daily spend rollup tables** are the canonical budgets schema.
- *Worktree-as-state*: `paperclip`/`cline` use git worktrees as the per-run isolation + persistence boundary (paperclip's no-remote-git contract enforced by a CI scanner).

**For zuzuagents.** Stack: **Postgres + Prisma** (matching the CF/Workers + TS world) with the runtime entities modeled on **paperclip** (`agents.reportsTo`, issues with `parentId` XOR-assignee + `blockedByIssueIds`, `agent_wakeup_requests`, scoped `budget_policies`) and **cline**'s `TeamRunRecord` (heartbeat/lease/`nextAttemptAt`). Represent a run as an **append-only transition log** (julep's lifecycle) so it is replayable and feeds the **runtime**/**tickets**/**dashboard** surfaces from one artifact. Adopt the **OLTP/OLAP split** if trace volume grows (agentops/helicone pattern): entities relational, tool-call traces to a columnar/cache store, with cognee's "thin SQL row + fast-cache steps, staleness inferred at read time" trick. Memory/generation/eval tables belong to their owning sections; the budget tables follow litellm's budget-as-shared-object shape (the **budgets** surface owns enforcement).

### Model gateway & routing

**What it is.** A model gateway is the single abstraction between agents and the dozens of LLM providers underneath — one request format, many backends — so an agent (or an operator) can swap models, fall back on failure, and meter cost without touching agent logic. Routing chooses *which* deployment serves a call; fallback handles the chosen one being down or over-context; caching avoids paying for identical calls twice.

**Design space.**
- *Provider abstraction* — one interface, per-provider adapters (translating tool-call formats, streaming, auth); per-role models (a cheap "weak" model vs a strong "main" one).
- *Routing & fallback* — primary→secondary on error, context-window fallback, content-policy fallback, retry policy + cooldown for unhealthy deployments.
- *Caching* — exact request/prompt cache (Redis), semantic cache, provider-native prompt-cache control, and *cache-for-deterministic-replay* (reproducible runs/evals).
- *Deployment* — in-process SDK adapter vs a standalone proxy server (adds auth, budgets, rate limits, an admin UI).

**In the field.**
- *Provider abstraction*: `litellm` is the reference proxy (one OpenAI-format interface to 100+ providers, virtual keys, spend tracking, MCP federation, admin dashboard). Others embed it directly: `aider`, `auto-code-rover` (thin per-provider adapter + central `register_all_models()`, per-role main/editor/weak models), `atomic-agents`/`crewai` (LiteLLM token-counting), `cognee` (LiteLLM + Instructor). In-house abstractions: `cline` `createGateway` (`@cline/llms`, a provider catalog with *XML-tool vs native-tool-call model families* and per-family system-prompt variants), `big-agi` AIX (provider-agnostic wire protocol: `AixWire_Particles → ContentReassembler → typed DMessage`, Zod wiretypes for tools, OpenAI/Anthropic/Gemini protocols), `bee` `ModelManager`, `anything-llm` (~35 adapters behind one `ai-provider` interface), `julep` `llm-proxy` (a LiteLLM-style routing microservice), `vercel-ai`/`bolt-diy` (`@ai-sdk/*` + OpenRouter + Ollama, custom `LLMManager`+registry over ~20 providers), `camel`/`atomic-agents` (`ModelManager`-style abstraction).
- *Routing & fallback*: `litellm` is the standout — declarative `fallbacks`, `context_window_fallbacks`, `content_policy_fallbacks`, `retry_policy`, and a cooldown cache for unhealthy deployments. `superagi`/others (`AgentMemory` + `MemoryWithFallback`) show the same primary→secondary-on-exception shape at the memory layer.
- *Caching*: `litellm` Redis request/prompt caching + an `anthropic_cache_control_hook` (provider-native cache control; note Anthropic/Bedrock count cache tokens *separately* vs OpenAI/Google folding them in — gateway must normalize), `langroid`/`khoj` (Redis-backed LLM response cache), `mastra` (`response-cache` as a composable processor), `agentscope`'s **cache context for deterministic replay** (LLM/embedding/prompt caches keyed on inputs → reproducible, cheap eval/rollback runs — the distinctive angle).
- *Cost attribution at the gateway*: `litellm` daily spend rollup tables (`DailyAgentSpend`/`DailyTeamSpend`/…) keyed by `(entity_id, date, api_key, model, mcp_namespaced_tool_name, endpoint)`, with raw `SpendLogs` underneath and **per-MCP-tool namespaced cost**; an `AuditLog` with before/after JSON; ~40 `CustomLogger` lifecycle hooks (pre-call, moderation, post-call, fallback-event, post-MCP-tool-call) so logging/guardrails/cost-tracking all plug in one way.
- *Honest gaps*: `litellm` has no agent memory, no real delegation/orchestration (`LiteLLM_AgentsTable` is thin billing scaffolding), no generations/eval — it is purely traffic-control + governance.

**For zuzuagents.** Run a gateway for **native/orchestrator-issued** model calls — but **BYO agents reach their own models through their adapter; do not force them through a proxy** (the gateway is for zuzu's own calls + cost attribution, not a mandatory hop). Adopt litellm's **routing/fallback** (`context_window_fallbacks` + cooldown) and its **budget-as-shared-object + daily spend rollups + per-MCP-tool namespaced cost** as the feed into the **budgets** surface (enforcement lives there, not here). For caching, layer Redis response caching plus **agentscope's cache-context-for-replay** so generations/evals are reproducible and bounded in cost. Per-role models (aider/auto-code-rover) map to the cheap-recovery-lane idea from the runtime section.

### Extensibility

**What it is.** Extensibility is how *new capability* enters the platform without forking the engine — most importantly **bring-your-own-agent adapters** (a clean boundary so any external agent runtime can be "hired"), plus plugin SDKs for tools/providers and the **capability gating** that decides what a given agent is allowed to do. For a control-plane that runs heterogeneous agents, the BYO-agent adapter contract is the load-bearing interface.

> Scope note: the tool *schema/sandbox* ladder (typed-signature tool schemas, sandbox spec-vs-instance, MCP transports) is owned by the tools section; it is referenced here, not re-taught.

**Design space.**
- *BYO-agent adapter* — a minimal `execute()`/heartbeat boundary so Claude Code, Codex, a bash script, or an HTTP bot all plug in identically; a flag for "runs its own loop" vs "SDK-driven."
- *Plugin SDK / registry* — decorator/auto-registration bundling a capability's schema + cost + auth + webhooks; bundle-style (config/markdown) vs code plugins (in-process).
- *Capability gating* — per-agent allow-lists, credential-aware tool visibility, read/write effect classes, approval requirements.
- *Hot-reload & governance* — self-authored tools/agents (gated behind review + sandbox); agent-management exposed *as a tool* so agents build agents.

**In the field.**
- *BYO-agent adapter contract*: `paperclip`'s `packages/adapters/AUTHORING.md` is the cleanest — a single `execute()` boundary; "any runtime that takes a heartbeat plugs in" (Claude Code, Codex, Cursor, bash, HTTP/webhook bots); `adapterType`/`adapterConfig` on the agent row. `composio`'s `BaseProvider` is the analog for *frameworks*: one tool catalog, many agent frameworks; the SDK injects a `_globalExecuteToolFn` and providers only translate schemas + call back, with an `_isAgentic` flag distinguishing "runs the loop itself" vs "SDK-driven." `agno` is explicitly "build agents using any framework" with external interface adapters (Slack/Telegram/A2A/AG-UI).
- *Plugin SDK / registry*: `autogpt` `backend/sdk/` (decorator auto-registration bundling a block's schema + cost + OAuth handler + webhook manager in one place), `cline` `AgentExtension` (capability manifests + lifecycle hooks via in-process or **subprocess hook runners** with file-config), `ChatDev 2.0` (registries everywhere — node/edge-condition/memory/provider/function-catalog; "add a type by registering"), `agno` `registry/` (code-defined registry of tools/models/dbs + toolkit-per-file), `anything-llm` imported "agent skills" (validated `plugin.json` + `handler.js`, path-traversal-guarded, `require.cache`-busted hot reload), `atomic-agents` Atomic Forge (self-contained tool folders downloadable via CLI). `lobe-chat` exposes *agent-management itself as a tool* so agents can build agents (directly on-thesis for build-your-team), and its tool-package convention (`manifest.ts + executor.ts + systemRole.ts`) is the cleanest packaging template.
- *Capability gating*: `AgentGPT` `Tool.dynamic_available(user, creds)` (an agent only sees tools it's authorized + credentialed for), `agno` `resource:<id>:action` wildcard scopes + `@approval` decorator (`required` blocking vs `audit` non-blocking), `goose` `ToolInspectionManager` (ordered Allow/Deny/RequireApproval inspectors) + an LLM `permission_judge` classifying read-only vs write, `mcp-servers` `readOnlyHint/destructiveHint` annotations, `composio` Tool Router Sessions (per-principal isolated MCP surface scoped to allowed toolkits + file mounts).
- *Hot-reloadable / self-authored* (governed): `claude-engineer` (a toolcreator writes a `BaseTool`, hot-reloaded by busting `sys.modules['tools.*']` — the agent grows its own tools), `babyagi` (tools are versioned DB rows), `Agent-E` (`@skill` decorator + global registry, Annotated signatures auto-generate the schema).
- *Lifecycle-hook seams* (extensibility without forking the loop): `langchain` `AgentMiddleware` (before/after model, `wrap_tool_call`), `litellm` `CustomLogger` (~40 hooks), `burr` lifecycle hooks, `mastra` processor pipeline, `cua` `AsyncCallbackHandler` — the highest-leverage shape, letting every faculty/gate bolt on as an ordered hook.

**For zuzuagents.** The **BYO-agent adapter** is the core extensibility primitive — adopt paperclip's `execute()`/heartbeat contract (with `adapterType`/`adapterConfig` on the agent row) and composio's `BaseProvider` split (translate-schemas + call-back, `_isAgentic` flag) so the **agent detail** surface can register Claude Code, a webhook bot, or an SDK agent identically; this is what makes the platform *model-agnostic*. Use a `langchain`/`litellm`-style **middleware/hook stack** as the seam through which budgets, governance gates, and trace-emission attach. For **capability gating**, combine `agno`'s scope grammar + `@approval` decorator with `goose`'s ordered inspectors and credential-aware tool visibility (AgentGPT) on the **tools** surface. Expose **agent-management as a tool** (lobe-chat) so manager agents can hire/configure reports — directly serving build-your-team — gated behind review + sandbox.

## Part III — Observability, governance & product surfaces

### Trace & observability

**What it is.** A trace is the durable record of what an agent system actually *did* at runtime: every model call, tool invocation, delegation, retrieval, and guardrail check, captured as it happened. The modern consensus shape is a **tree of typed spans** — each span has a kind (the OpenTelemetry GenAI conventions name AGENT, TOOL, LLM/GENERATION, plus CHAIN, RETRIEVER, GUARDRAIL), a parent pointer, inputs/outputs, timing, and token/cost fields — so a whole run reads back as a nested call tree rooted at the top-level request. Because it is append-only and typed, the same artifact serves observability (debug a run), evaluation (score a run), budget attribution (sum cost over a subtree), and rollback anchoring (which generation produced this span). It is the keystone: design it once and almost everything downstream is a view over it.

**Design space.**
- *Emission model:* decorator/auto-instrumentation (wrap functions, emit spans automatically) vs explicit span API vs event bus (typed events a handler turns into spans) vs derive-the-tree-at-read-time from a flat log.
- *Span taxonomy:* a rich enum (SESSION/WORKFLOW/AGENT/TASK/TOOL/LLM/CHAIN/RETRIEVER/GUARDRAIL) vs a minimal one (WORKFLOW/AGENT/TASK/TOOL). Richer = better filtering; minimal = easier to populate.
- *Lineage:* explicit `parent_observation_id` pointers vs a dotted "chained entity path" breadcrumb vs identity triples `(partition, app, sequence)`.
- *Storage split:* OLTP (Postgres) for config/relational + OLAP/columnar (ClickHouse) for high-volume telemetry is the production pattern; SQLite single-store for local; in-memory for ephemeral.
- *Standard vs bespoke:* emit OTel/OpenInference spans (portable, any backend reads them) vs a custom schema (tailored, but you build the viewer).
- *Privacy:* trace payloads contain prompts and tool I/O — content capture is usually gated by a flag and a byte cap, with secret redaction before persist.

**In the field.**
- **AgentOps** is the purest expression: everything (agent step, tool call, LLM call, guardrail, HTTP) is an OTel span with semantic-convention attributes; span kinds SESSION/WORKFLOW/AGENT/TASK/OPERATION/TOOL/LLM/CHAIN/GUARDRAIL; one `create_entity_decorator(SpanKind.X)` factory generates all the decorators; ClickHouse for spans, Postgres for entities — the clean OLAP/OLTP split.
- **Langfuse** is the canonical relational model: an `observations` table with `parent_observation_id` + a `type` enum {SPAN, EVENT, GENERATION, AGENT, TOOL, CHAIN, RETRIEVER, EVALUATOR, EMBEDDING, GUARDRAIL} + `level` {DEBUG/DEFAULT/WARNING/ERROR} + input/output + token & cost fields; GENERATION spans carry both user-provided and *calculated* cost. Postgres for config, ClickHouse for telemetry, BullMQ for ingestion (with secondary queues to isolate noisy tenants).
- **openllmetry (Traceloop)** shows the minimal taxonomy — `TraceloopSpanKindValues` = WORKFLOW/AGENT/TASK/TOOL via `@workflow`/`@agent`/`@task`/`@tool` decorators; a `get_chained_entity_path` builds a dotted parent→agent→task→tool breadcrumb automatically from execution context; input/output JSON-serialized onto spans, gated by a `TRACELOOP_TRACE_CONTENT` flag and a byte cap; "associations" (`USER_ID`, `SESSION_ID`, `conversation_id`) attach business correlation IDs to every span in scope.
- **Phoenix** and **dify** treat tracing as a pluggable substrate: Phoenix is OTel/OpenInference-native; dify's `core/ops` trace-manager fans the same trace out to Langfuse/LangSmith/Arize Phoenix/Opik/Aliyun. **Langflow** generalizes this with a `BaseTracer` multi-provider abstraction (LangSmith/LangFuse/Phoenix/Opik/LangWatch/Traceloop swappable).
- **Helicone** derives the tree at read time: each request carries `Helicone-Session-Id` + a `path` like `/parent/child`, and the UI rebuilds a `FolderNode`/`TraceNode` tree from flat logs, tagging each span `Tool|LLM|VectorDB|Data`. Cheap append-only writes, hierarchy computed on read.
- **AutoGPT** persists the trace as relational execution rows: `AgentGraphExecution → AgentNodeExecution → AgentNodeExecutionInputOutput` (named I/O pins) with per-node status, queued/started/ended timestamps, and `stats` JSON — a queryable, diffable, replayable trace; `parentExecutionId` self-relation makes a manager-run nest its sub-agent runs.
- **babyagi** gives both call-nesting and causality from one table: a Log with `parent_log_id` (nesting within an agent) + `triggered_by_log_id` (who-delegated-to-whom). **agency-swarm** threads run-id + parent-run-id through a `MasterContext` for a free call tree. **beeai** lifts this into an `Emitter` with `EventTrace` carrying `id`/`runId`/`parentRunId` and namespaced events (`["tool","handoff"]`). **DSPy** threads an `ACTIVE_CALL_ID` ContextVar through `BaseCallback` (`on_lm/module/tool_start/end`) for a built-in trace tree with near-zero coupling.
- **OpenTelemetry-first runtimes:** Agno, AutoGen (`autogen_core/_telemetry`, GenAI semconv), google-adk (OTel + a local **SQLite span exporter** so traces persist without external infra), Letta (`trace_method` decorator → ClickHouse, plus per-call `ProviderTrace` of raw request/response keyed by `step_id`), strands, skyvern (OTel + Laminar), cognee/graphiti (OTel spans across the memory pipeline).
- **Event-stream-as-trace:** Burr (declare a `__tracer` param, open nested named spans → fine-grained tree, native OTel bridge); CrewAI's typed event bus + handler graph; ControlFlow's `QueueHandler`/`PrintHandler`; marvin's typed `Event` + sync/async `Handler` bus (a `DBHandler` persists, a `UIHandler` streams — same events); langroid's `ChatDocLoggerFields` + styled `HTMLLogger` rendering per-turn tool name/type/result; AgentGPT's typed `AgentWork` worklog (run/conclude/next/onError). **SWE-agent**'s `Trajectory` rows are tool-call trace + cost ledger in one, broadcast over WebSocket to React.
- **Provenance on spans:** tabby's `MessageAttachment` (git_url, commit, filepath, line range per message); graphiti's episode→fact chain — makes "which memory/source drove this step?" answerable.
- **Redaction before persist:** langflow's `sanitize_data` + `SENSITIVE_KEYS_PATTERN`; browser-use's placeholder redaction in the tool layer; paperclip scrubs secrets from activity and wake payloads.

**For zuzuagents.** This is the decided keystone — the **typed, append-only, tree-shaped trace**. Build it first; nearly every other surface is a view over it. Concrete recs:
- Adopt **OTel GenAI span-kinds** (AGENT/TOOL/LLM, plus RETRIEVER/GUARDRAIL/EVALUATOR) on a recursive `parent_span_id` model, langfuse-style — one schema that simultaneously powers the **runtime** view, **dashboard**, **budgets** (sum cost over a subtree), and **generations/evals** (scores attach to a span). Emitting standard spans means a self-hostable backend (langfuse/phoenix) reads them for free.
- The trace tree falls out of the **recursive A2A invocation contract**: each delegation hop opens a child AGENT span under its caller, giving the runtime reporting tree (distinct from the design-time org tree). Carry the **shared budget envelope** and ticket/tenant IDs as association attributes (openllmetry-style) so they thread to every child span without manual plumbing.
- Use the **OLTP/OLAP split** (relational config + columnar trace store) once volume warrants; start single-store. Gate content capture behind a flag + byte cap, and **redact secrets before persist** (mandatory for a multi-tenant store).
- Surfaces: the **runtime** surface streams live spans; the **dashboard** aggregates; the canvas **run-pulse** animates active edges driven by the *same* span stream that feeds evals.

---

### Evaluation & scoring

**What it is.** Evaluation answers "was this good?" about an agent's output or trajectory, producing a comparable score. The field has converged on a *ladder of scorers* of increasing cost and subtlety: **code assertions** (cheapest — did it call the right tool, return valid JSON, hit the goal state), **LLM-as-judge** (a model grades against a rubric or ground truth), and **human review** (a person annotates). The decisive insight is to store all three under **one Score schema** with a `source` enum {HUMAN, AUTO, API} so they are directly comparable. Evals run inline (a gate that blocks a run) or offline (over a curated dataset of past traces, for regression). The trace is the natural input: a saved trajectory replayed against a scorer.

**Design space.**
- *Scorer type:* code/programmatic (assertions, matchers: equals/contains/regex/jsonSchema/levenshtein/numeric) · LLM-judge (rubric or pairwise) · human annotation.
- *Score shape:* numeric · boolean · categorical · freeform, often with an optimization direction (maximize/minimize) and a pass threshold.
- *Trigger:* inline guardrail (same evaluator, runtime call site) vs scheduled/sampled over production traffic vs offline dataset run.
- *Target:* a whole trace/run vs a specific span/step vs a memory operation vs a tool-call sequence.
- *Datasets & regression:* curated `Dataset → DatasetItem → Run → RunItem` for benchmark/regression; "eval set = curated production traces."
- *Authoring:* code fixtures (JSONL) · declarative template (judge prompt + var-mapping + sampling%) · natural-language spec compiled to executable test (Gherkin→pytest).
- *Feedback loop:* score → blame-assignment → corrective advice → next generation; auto-apply vs human-approved proposals.

**In the field.**
- **Langfuse** is the reference: one unified `scores` table with a `source` enum ANNOTATION(human)/API/EVAL(auto), typed by `ScoreConfig` {NUMERIC, BOOLEAN, CATEGORICAL}, attachable to a trace *or* an observation. Its declarative pipeline is `EvalTemplate` (LLM_AS_JUDGE prompt+model, or CODE in Python/TS, with vars + output schema) → `JobConfiguration` (filter selecting which traces, variableMapping, `sampling` 0..1, `delay`, `timeScope` NEW/EXISTING) → `JobExecution`. Plus `Dataset/DatasetItem/DatasetRuns/DatasetRunItems` for regression.
- **Phoenix** unifies human + LLM-judge under one annotation schema: three types CATEGORICAL (named values + scores) / CONTINUOUS (numeric bounds) / FREEFORM, each with an `OptimizationDirection`; `Experiment/ExperimentRun/ExperimentRunAnnotation` tracks a change and its eval results; a daemon experiment-runner (concurrency semaphore + priority dispatch + retry heap) executes them.
- **openllmetry** makes the same evaluator runnable twice: a named `Evaluator` (Pydantic input schema, server-side by slug) executes both as an offline eval inside an "experiment run" *and* as an inline runtime guardrail — one definition, two call sites — streaming results over SSE; `UserFeedback.create(annotation_task, entity_id, tags)` posts human judgments against a specific traced entity.
- **lobe-chat** ships a full **rubric engine**: `eval-rubric` runs weighted rubrics with composable matchers (equals/contains/regex/jsonSchema/levenshtein/numeric/anyOf/external + `llmEq` and `llmRubric` judge scoring) and a `passThreshold`, with `extractor`s to pull the answer first.
- **Tool-call-trace-as-assertion** (the cheap, high-value eval): **Agno**'s `ReliabilityResult` and **upsonic**'s `ReliabilityEvaluator` assert expected vs actual tool calls — failed/passed/missing/additional calls, per-argument checks. **Agent-E** (EmergenceAI)'s harness routes pluggable evaluators (StringEvaluator/URLEvaluator/HTMLContentEvaluator/ManualContentEvaluator via `EvaluatorComb` + `evaluator_router`) over JSON task configs with per-task logs+screenshots.
- **LLM-judge built in:** **browser-use**'s first-class `judge.py` (`JudgementResult`, optional `ground_truth`) scores the run trace including screenshots; **DSPy**'s `Evaluate(devset, metric, parallel)` + `auto_evaluation` LM-judge, and the standout `OfferFeedback`/GEPA **reflective blame-assignment** that scores a multi-stage program and assigns per-module blame with corrective advice — a template for a manager-review step over an org tree.
- **AutoGen Studio** has dedicated eval tables: `EvalTask`, `EvalCriteriaDB` (judge criteria), `EvalRunDB` (runner+judge config + status + scores), `EvalScore`/`EvalDimensionScore`. **CrewAI** has a `MetricCategory` taxonomy (goal_alignment, semantic_quality, reasoning_efficiency, tool_selection, parameter_extraction, tool_invocation) → `EvaluationScore` (0–10 + feedback). **mastra** attaches code + LLM **scorers** to runs, persisted alongside traces and shown in the playground.
- **Review-as-loop** (inline gating): gpt-researcher's reviewer-returns-None-or-feedback conditional edge with a `max_*_revisions` cap (quality gate + hard stop in one); AgentVerse's evaluator stage with a score threshold (>=8) feeding `advice` + `previous_plan` into a retry, plus Agree/Disagree critic gating; AutoCodeRover's `ReviewDecision` + regression-test status maps with/without the patch; cline's `TeamOutcome`/`TeamOutcomeFragment` (draft→in_review→finalized, each fragment authored + `reviewedBy`); ChatDev's `is_majority_voting` ensemble vote.
- **Datasets / offline rigs / spec authoring:** gpt-researcher's `evals/` (SimpleQA factuality + hallucination, LLM-grader templates over JSONL); google-adk's `BaseEvalService` + eval sets + an **agent simulator** with a tool-connection analyzer; LaVague's Gherkin `.feature` → pytest compiler; gpt-engineer's pluggable `benchmark/` loaders; paperclip regression-tests the orchestrator's *governance prompt* with **promptfoo** against `core.yaml`/`governance.yaml` suites.
- **Hardening loop:** lobe-chat's nightly self-review agent files **approval-gated** self-improvement proposals; cognee/agno's proposal-first `SkillImprovementProposal` (confidence + rationale, human approves before commit); dify's `annotation_service` wires human review feedback back into evals.

**For zuzuagents.** Realize the decided **swappable scorer** ladder — assertion → LLM-judge → human — as the `evaluate(target, criteria) → verdict` primitive, mapped to the **generations/evals** surface:
- Use **one unified Score schema** (langfuse/phoenix style): `source` enum {HUMAN, AUTO, API}, `ScoreConfig` {numeric, boolean, categorical, freeform} + direction + threshold, attaching to a **trace span** (since the trace is the keystone). Never build separate human-vs-auto tables — comparability is the point.
- Lead with **trace-as-assertion** evals (Agno/upsonic `ReliabilityResult` shape): assert expected vs actual tool calls and **memory operations** in the trace — the cheapest high-value eval, and it doubles as the memory-operation eval.
- Offer a **declarative eval pipeline** (langfuse `Template → Config → Execution`): define a judge once (code or LLM, var-mapping + sampling% + trace filter), auto-run it on matching generations. An **eval set = curated production traces** powers regression across generations.
- For the hardening loop, follow lobe-chat/cognee: scheduled review **files an approval-gated proposal** that becomes a new pinned generation on human sign-off — auto-implement deferred. Consider DSPy `OfferFeedback`-style blame-assignment across the org tree on a failed ticket, feeding the next generation.
- Surfaces: scorer results render on **generations/evals**; human review routes to the **dashboard** annotation/approval inbox (see UI surfaces).

---

### Versioning & generations

**What it is.** A "generation" is a captured version of an agent's *definition* — its prompt, model, tool set + versions, memory schema, and attached references. Versioning lets you compare generations, roll back a regression, and fork an experiment. There is a critical distinction the field constantly blurs: **definitions** (the design-time spec — what the agent *is*) versus **run snapshots** (the runtime state — what happened on a given execution). Pinning *definitions* gives you a clean lockfile you can diff and roll back; snapshotting *runs* gives you a replay/audit substrate. **Prompt-drift** — a system prompt silently changing without a version bump — is the specific failure versioning must guard against. The clean model is an **immutable version row + an active pointer + a `forkedFrom` relation**: rollback = flip the pointer; fork = a first-class relation, not a copy hack.

**Design space.**
- *What gets versioned:* definitions (prompt/model/tools/schema — the lockfile) vs run state (conversation + files + memory snapshot) vs both (a manifest pinning definitions per run).
- *Mechanism:* immutable version rows + `isActive`/tag pointer + `forkedFrom` (the clean model) · git-commit-per-change with authorship tags · serialized state blob (`dump_state`/`save_state`) · checkpoint lineage (`parent_config`) · immutable Version + movable Tag (promote/rollback by retagging).
- *Rollback semantics:* flip active pointer (instant, immutable history preserved) vs revert commit vs restore snapshot vs re-point manifest.
- *Drift guard:* hash the (prompt+schema) and compare to the declared version to catch forgotten bumps · protected labels · before/after audit snapshots.
- *Fork vs resume:* fork-to-new-id (branch, immutable parent) vs resume-in-place (mutate same id).

**In the field.**
- **AutoGPT** is the closest fit for the definition model: `AgentGraph` has composite PK `@@id([id, version])` + `isActive` + a self-relation `forkedFrom(Id,Version)` — new versions are new rows, immutable history, rollback = flip active, fork = a relation. **babyagi** mirrors it for tools: `Function → FunctionVersion(is_active)`; `activate_function_version(name, ver)` is the rollback. **Langflow**: `FlowVersion` (monotonic `version_number` + JSON snapshot + unique constraint + prune + deployed-attachment). **Phoenix** and **Helicone** use immutable Version + movable Tag (`PromptVersion`/`PromptVersionTag`; Helicone major/minor + environment/production pointer) — promote/rollback by retagging, "version in UI from production data."
- **Config-revision with rollback pointer:** **paperclip**'s `agent_config_revisions` (before/after config, changedKeys, source, `rolledBackFromRevisionId`) is governance-with-rollback for agent config; generalize to any governed entity. **litellm**/**langfuse** `AuditLog` store before/after JSON snapshots — generic change-history; rollback = re-apply `before_value`.
- **Prompt-drift guard:** **lobe-chat**'s `llm_generation_tracing` records `scenario`, a human-bumped `promptVersion`, *and a 6-char `promptHash` of (systemPrompt+schema)* to catch forgotten bumps — plus feedback signals (explicit_thumbs, implicit_regenerate, downstream_acceptance, manual_edit). The cheapest high-value drift defense. **langfuse** prompt management adds versioning + labels + protected labels + `PromptDependency` (composable prompts) with server+client caching.
- **Run-snapshot cluster (the trap — route to the trace store, not generations):** Burr's fork-to-new-id (`initialize_from(fork_from_app_id, fork_from_sequence_id, override)`, identity triple `(partition, app, sequence)`, `fork_parent_pointer`/`spawning_parent_pointer`); bolt.diy's `{chatIndex, files}` snapshot binding conversation cursor to file tree; LangGraph's checkpoint lineage (`parent_config`-linked, resume/fork by `checkpoint_id`); DSPy `dump_state/load_state`; AutoGen `save_state/load_state` + `ComponentModel`; ChatDev's immutable state linked-list (`commit`/`create_next`/`rollback`, `--step N` rewind); e2b pause/resume snapshots (fs+mem); langroid's `rewind_tool` (prune-from-N via `child_id` links); gpt-pilot's next-state fork; gpt-engineer's `BaseVersionManager.snapshot()` + git; aider's git-commit-per-edit with aider-authored tags (`/undo` only reverts agent commits).
- **Manifest-per-generation:** zep pins an immutable `config_snapshot` + parent-run lineage per run (snapshot the org chart + prompts + tools + ontology; rollback = re-point).

**For zuzuagents.** Hold the decided backbone firmly: **generation = pinned definitions** (prompt + model + tool versions + memory-schema version + attached refs) + an **active pointer** + `forkedFrom`; **rollback = flip the pointer**.
- Adopt the **AutoGPT lockfile model** verbatim (`@@id([id, version])` + `isActive` + `forkedFrom`) for agent/team definitions, generalized to any governed entity via paperclip's `agent_config_revisions` + `rolledBackFromRevisionId`. Use immutable Version + movable Tag (phoenix/helicone) for the **promote/rollback UX** on the generations/evals surface.
- **Route the entire run-snapshot cluster to the trace store, NOT the generation model** — Burr forks, bolt.diy `{index,files}`, LangGraph checkpoints, DSPy/AutoGen state blobs are *runtime data observed via the typed trace*, the eval/replay substrate. "Pin definitions, observe data."
- Adopt lobe-chat's **promptHash drift guard** directly: hash (systemPrompt + schema), compare to the declared `promptVersion`, flag silent drift on the agent-detail / generations surface. Cheap, high value.
- Surfaces: version history + diff + promote/rollback live on **generations/evals**; the drift flag surfaces on **agent detail**.

---

### Budget & cost control

**What it is.** Budget control accounts for what a run costs (tokens, dollars, tool calls, time, concurrency) and *enforces* limits before spend gets out of hand. Two levels exist and are routinely confused: **accounting** (measure and report cost — most projects stop here) and **enforcement** (a hard stop that aborts or pauses when a cap is hit). Costs are computed from per-model price tables and aggregated per scope (per call → per agent → per team → per org). The robust enforcement model is a **shared budget object** that many entities reference and that **decrements as it is spent**, so a parent's cap bounds all its children — and hitting zero doubles as a runaway/cycle kill.

**Design space.**
- *Accounting vs enforcement:* track-only (a `usage`/cost object, `/cost` readout) vs hard-stop that aborts/pauses/cancels-queued-work.
- *Dimensions:* tokens · dollars · request count · tool calls/turns/steps · wall-clock time · concurrency. Treat as multi-dimensional, not just tokens.
- *Scope & propagation:* per-call cap vs a budget shared by org/team/agent/run that decrements; usage propagated *up* the call tree (parent accumulates children) vs *down* (child inherits remaining envelope).
- *Price resolution:* static price table · regex name-pattern matching with specificity ranking (resolves model aliases) · live-fetched + cached pricing.
- *Enforcement point:* pre-call hook (reject before spend, preflight estimate) vs post-call (charge then check) — pre-call avoids TOCTOU over-spend.
- *Rollups:* raw spend-log rows + daily aggregate tables keyed by (entity, date, model, tool) make dashboards cheap.
- *Idempotency:* a ledger keyed on entry-id so retries/rollbacks don't double-charge.

**In the field.**
- **litellm** is the reference enforcement model: one reusable `LiteLLM_BudgetTable` (max_budget, soft_budget, tpm/rpm, `budget_duration`/`budget_reset_at`, per-model `model_max_budget`, `allowed_models`) **attaches to any of Org/Project/Team/User/Key/EndUser/Tag/Agent** — a shared object many entities point at, not a duplicated column; overspend pauses + cancels queued work. Daily rollup tables (`DailyAgentSpend`/`DailyTeamSpend`/…) keyed by (entity, date, model, mcp_tool, endpoint) make dashboards cheap; raw events in `SpendLogs`.
- **paperclip** is the product-grade version: `budget_policies` scoped (company/agent/project/goal/issue), with `warnPercent`/`hardStopEnabled` — **overspend pauses agents + cancels queued work**, `budget_incidents` recorded; `cost_events` per (company, agent, issue, project, goal, run, provider, model) with input/cached/output tokens → multi-dimensional rollups.
- **AutoGPT** runs an append-only **credit ledger**: `CreditTransaction` (TOP_UP/USAGE/GRANT/REFUND/SUBSCRIPTION) with `runningBalance`, per-block `block_cost_config`, **preflight cost estimates** that warn/block before a run, and an explicit **TOCTOU-safe** charging note (charge atomically, guard with `max(0,…)`).
- **Usage-propagated-up-the-tree:** ChatDev's `get_spend()`/`report_metrics()` (per-agent, per-role tiktoken→dollars); AutoCodeRover's thread-local `thread_cost`; camel/upsonic contextvar-scoped ledgers with automatic parent roll-up (idempotent on `entry_id` → retry/rollback-safe); ChatDev 2.0's per-node token tracking tagged by node/model/workflow; gpt-researcher's `cost_callback` threaded through every call.
- **Cost-as-data with pattern matching:** **Phoenix**'s `model_cost_manifest.json` with regex `name_pattern` + specificity ranking (resolves variants/aliases) and a `span_cost_calculator` daemon backfilling cost onto spans; **browser-use**'s `TokenCost.register_llm` interceptor (live pricing cache, per-call + cumulative). agency-swarm bundles `model_prices_and_context_window.json` for costing (no enforcement). Letta drives budgets off a per-step token table + `ProviderTrace`.
- **Multi-dimensional / time-windowed enforcement:** **mastra**'s `cost-guard` processor (budget caps scoped `run|resource|thread`, time windows 1h..365d, aborts via `TripWire`) + `token-limiter`; goose's `max_turns` (default 25) + `token_counter` + context compaction at 0.8; AutoGen's composable `TokenUsageTermination` & `TimeoutTermination` (combine with `&`/`|`); Agent-E's per-agent round budgets + `is_agent_stuck_in_loop`; anything-llm's aibitat `maxRounds`/`maxToolCalls`; bolt.diy `maxLLMSteps: 5`; gpt-pilot/plandex revision + message caps.
- **Accounting-only (the common stopping point):** agency-swarm (`/cost`, no cap), AgentGPT (`token_service.calculate_max_tokens` only), atomic-agents (`get_context_token_count` breakdown + turn-preserving eviction), LaVague (per-step per-component cost into `ActionResult`), goose/sweep `TrajectoryUsage`.

**For zuzuagents.** Implement the decided **shared decrementing budget envelope** carried in the recursive A2A invocation contract; hitting zero is the cycle/runaway kill.
- Model budget as **litellm's shared object** (one Budget row referenced by org/agent/team/run; max + soft, multi-dimensional: tokens/$/actions/concurrency/time) rather than a per-entity column. Propagate up the tree (camel/upsonic contextvar rollup, **idempotent on entry-id** so retries are safe).
- **Enforce, don't just account** — paperclip's model: warn% → hard-stop that **pauses the agent and cancels queued work**, with a `budget_incident`. Prefer **pre-call enforcement + preflight estimate** (AutoGPT) over post-call to avoid TOCTOU overspend.
- Resolve prices via a **cost-manifest-as-data with regex pattern + specificity** (Phoenix) and **backfill cost onto trace spans** so per-agent / per-ticket attribution falls out of the keystone trace for free. Daily rollup tables (litellm) make the budgets dashboard cheap.
- Surfaces: caps + incidents + spend rollups on **budgets**; live remaining envelope visible on **runtime**; cost attribution derived from the **trace**.

---

### Governance, approvals & human-in-the-loop

**What it is.** Governance is the set of controls that keep agents accountable to humans: **approval gates** (pause before a risky action until a person signs off), **HITL pause/resume** (durably suspend a run awaiting human input, then continue), and **override/terminate** (a human can edit, redirect, or kill a run). The durable version treats a paused run as a first-class *state* ("awaiting input"), not an out-of-band side channel — survives crashes, supports timeouts and escalation, and writes every decision into the audit trail. The cleanest unifying abstraction is an **ordered gate pipeline**: every cross-cutting check (permission, budget, safety, human approval) is a pluggable inspector returning Allow / Deny / RequireApproval.

**Design space.**
- *Gate placement:* before-tool/before-model hook · declarative `interrupt_before`/node gate · a `Requirement`/Rule that prevents stop · approval as a callable tool the agent invokes.
- *Approval modes:* blocking (run pauses until resolved) vs audit-only (non-blocking compliance record) vs shadow (run-but-don't-block, for safe rollout).
- *HITL mechanism:* durable `waitForEvent`/interrupt suspended into persisted state vs DB-backed pause flag vs in-memory pause. Timeout-with-default vs timeout-as-escalation.
- *Decision surface:* approval inbox / annotation queue (per-item locking + assignment) vs inline chat prompt vs CLI confirm.
- *Policy expression:* per-action human gate · auto-approval policy record (manager pre-approves a class) · risk-scored auto-classification (LLM decides which actions need a human) · deny→ask→allow priority ladder.
- *Override/terminate:* edit-and-resume · external kill switch · intercept/modify/drop messages mid-flight.

**In the field.**
- **Durable HITL = a wait inside a tool:** **agent-kit**'s `step.waitForEvent("approval", {timeout, match: ticketId})` inside a tool handler — crash-safe via Inngest checkpointing, free timeout/escalation, approval keyed to a work item. **julep/temporal**-style append-only transition logs (queued→running→**awaiting_input**→succeeded) make HITL a durable state. **pydantic-ai** `DeferredToolRequests`/`DeferredToolResults` (suspend, resume with approve/deny/override-args). **strands** serializes an Interrupt into session state. **LangGraph** `interrupt()` surfaces a `HumanInterrupt` (allowed actions accept/edit/respond/ignore), resume via `Command(resume=...)`, `interrupt_before`/`interrupt_after` gate nodes; state is editable while paused.
- **Approval as data, with auto-approve policy:** **AutoGPT**'s `HUMAN_IN_THE_LOOP` block + `PendingHumanReview` (ReviewStatus WAITING/APPROVED/REJECTED, editable, payload, instructions, reviewMessage, wasEdited, processed) — and a synthetic `auto_approve_{graph_exec_id}_{node_id}` key that lets a governance policy short-circuit a gate. **Agno**'s `@approval` decorator with two types: `required` (blocking, resolved via approvals API) and `audit` (non-blocking record), plus a dedicated `os/routers/approvals/`. **lobe-chat**'s `agent_operations` status includes `waiting_for_human`/`interrupted` and `completionReason` includes `cost_limit`/`max_steps`/`waiting_for_human` — one table is tickets + trace + budget + HITL pause points.
- **The ordered-gate / inspector pipeline (the highest-value pattern):** **goose**'s `ToolInspector` trait (`inspect() → Vec<InspectionResult>` with `InspectionAction::{Allow, Deny, RequireApproval(msg)}`, confidence, reason) run by a `ToolInspectionManager` — permission, security, repetition all plug in as ordered inspectors; an LLM `permission_judge` auto-classifies read-only vs write to decide what needs a human. **OpenHands**'s permission engine: Pydantic rules `{tool_name, rule_content, behavior(allow/deny/ask), source}` in a fixed **deny→ask→tool-specific→allow→bypass** priority ladder. **mastra**'s `ProcessorRunner` (input/output processors incl. `moderation`, `tool-call-filter`) + `TripWire` abort. **beeai**'s `ConditionalRequirement`/`Rule` engine (`{target, allowed, forced, preventStop, hidden, reason}`, `min/maxInvocations`, `priority`, `toolCallChecker`) — deterministic guardrails over nondeterministic LLMs, with `reason` strings for audit. **openllmetry**'s `@guardrail(...on_failure=...)` with raise/log/ignore-**shadow-mode**/fallback policies.
- **Annotation/approval inbox:** **langfuse**'s `AnnotationQueue` + `AnnotationQueueItem` (objectType TRACE/OBSERVATION/SESSION, status PENDING/COMPLETED, **per-item locking** via lockedAt/lockedByUserId) + `AnnotationQueueAssignment` (who reviews which queue) — routing + double-review prevention. **cua**'s async pending-approval queue + Gradio UI. **paperclip**'s `approvals`/`issue_approvals`/`issue_execution_decisions`/`approval_comments` board workflow; pause/resume/terminate any agent; `secret_access_events` + `activity_log` immutable audit.
- **Override/terminate & intercept:** **AutoGen**'s triad — `ExternalTermination` (human flips a switch) + `InterventionHandler` (on_send/on_publish/on_response can log, modify, or **drop** messages mid-flight) + `UserProxyAgent`; composable `TerminationCondition`s. **agentscope** lifecycle `running/pausing/paused/stopped` + `lastConclusion` replay. AgentGPT pause/stop.
- **Approval-as-a-tool / escalation:** Agent-E's `get_user_input`/`pause_flow` callable skills; anything-llm's `request-user-input` (typed questions, per-turn cap, 120s timeout degrading to "best judgment"); gpt-pilot's "execute? Y/n" gate; gpt-researcher's `HumanAgent.review_plan` with `max_plan_revisions`; AgentVerse letting a human occupy any agent slot; marvin's `RequestHumanApproval`/`SubmitForReview` end-turn tools; camel's `LLMGuardRuntime` risk-scoring each tool call. agency-swarm's guardrail tripwire (raise → extract output+guidance → re-prompt) — extend to route to a human queue.

**For zuzuagents.** Implement HITL via the decided durable **`waitForEvent`**, keyed to a work item with **timeout-as-escalation** (agent-kit shape) — a paused run is a first-class state, crash-safe.
- Model the gate as **goose's ordered inspector pipeline**: permission, budget (envelope at zero), safety, and human approval all become inspectors returning Allow/Deny/RequireApproval — one composable chain, decoupled from agent logic. Use an LLM `permission_judge` (read-only vs write) to decide what needs a human.
- Store approvals **as data** (AutoGPT `PendingHumanReview` + the auto-approve policy key, so a manager can pre-approve a class of action), and capture every gate decision **as a span on the trace** (AgentOps `@guardrail` span) so the governance trail and the execution trace are the same object.
- Give the **paused-for-human** state a destination: a **langfuse-style annotation/approval inbox** with per-item locking + assignment on the **dashboard**.
- Surfaces: gates configured on **agent detail** / **governance**; the approval inbox + override/terminate controls on the **dashboard**; pause/resume on **runtime**; decisions appended to the **trace**.

---

### Guardrails, safety & secrets

**What it is.** Guardrails are automated checks on what goes *into* and comes *out of* an agent — input guardrails (prompt-injection detection, moderation, PII scrubbing on the way in) and output guardrails (validate/moderate/redact before a result is shown or persisted). Adjacent concerns: **secret injection** (give an agent a credential only at execution, scoped, scrubbed from prompts and traces) and **sandboxing isolation** (run agent-generated code/tools in a confined environment with bounded filesystem and network so a compromised or buggy agent can't reach the host or exfiltrate data). The unifying idea is that these are policy *interception points* around the loop — and capturing each check as a span keeps the safety trail inside the trace.

**Design space.**
- *Guardrail placement:* pre-model input filter vs post-model output filter vs per-tool-call gate; composable pipeline (parallel/sequential/fail-fast) with an `on_failure` policy (raise/log/ignore-shadow/fallback).
- *Guardrail content:* prompt-injection scanner · moderation · PII/PHI detector + anonymizer · regex/keyword filter · system-prompt scrubber · output schema validation.
- *Secret handling:* encrypted at rest (Fernet) injected into execution scope only · proxy-side credential injection (sandbox never holds the secret) · placeholder substitution before the LLM sees data · scoped + versioned + audited access.
- *Sandbox isolation level:* none (host exec + confirm) → in-process kernel → subprocess/out-of-process service → WASM → container (Docker) → microVM (E2B) → remote/K8s. A graduated ladder selectable per trust/cost.
- *Network policy:* egress allow/deny by host/CIDR; SSRF proxy; mitmproxy for credential injection + egress control.
- *Redaction-before-persist:* scrub secrets/PII from the trace store and wake payloads (a multi-tenant requirement).

**In the field.**
- **Input/output guardrails as a pipeline:** **mastra**'s processor library — `moderation`, `pii-detector`, `prompt-injection-detector`, `system-prompt-scrubber`, `regex-filter`, `tool-call-filter`, `language-detector` — run by `ProcessorRunner` around each step, aborting via `TripWire`. **openllmetry**'s `@guardrail` builder (`.parallel()/.sequential()/.fail_fast()`, shadow mode) with per-guard spans. **goose**'s `security/` inspectors: prompt-injection scanner, `adversary_inspector`, `egress_inspector`, command classifier, `extension_malware_check`, `recipe-scanner`. **agency-swarm**'s input/output guardrail tripwires (`GuardrailTripwireTriggered`). **AgentOps**'s first-class `@guardrail` span + GUARDRAIL span kind. **cua**'s `PIIAnonymizationCallback` (scrub in/out). **autogen**'s `InterventionHandler` (drop/modify messages). **AutoGPT** uses ClamAV for file scanning.
- **Secrets:** **babyagi** encrypts secret keys with **Fernet**, injects them into the function's local scope only at execution, gated by declared `key_dependencies`. **paperclip** scopes secrets instance+company, encrypted, versioned, provider-backed, with `secret_access_events` audit, injected only into scoped runs and **scrubbed from prompts/activity/wake payloads**. **browser-use** swaps secrets for `<placeholder>` before they reach the LLM, scoped per resource. **AgentOps** has per-deployment secrets CRUD in its deploy lifecycle. **Phoenix**'s `ProviderCredentialSpec` declares each sandbox backend's required secrets.
- **Proxy-side credential injection (sandbox never holds the secret):** onyx's mitmproxy egress proxy injects credentials proxy-side and controls egress; dify's HTTP sandbox + SSRF proxy.
- **Sandbox isolation ladder:** **google-adk**'s graduated `BaseCodeExecutor` — `unsafe_local` → `container` (Docker) → `gke` (K8s) → `vertex_ai` → `agent_engine_sandbox`, picked per trust/cost. **Phoenix**'s `SandboxBackend` ABC (Daytona/Deno/E2B/Modal/Vercel/WASM) with `config_fingerprint` session reuse + a regex **dependency-spec grammar** validating install strings before execution. **e2b**'s microVM sandbox addressed by ID with **per-sandbox egress allow/deny by host/CIDR**, pause/resume, `setTimeout`/`onTimeout`. **OpenHands** (Docker/Remote/Process workspaces). **strands** WIT+WASM Component Model for untrusted tools. **beeai** (bee-agent-framework) code-interpreter-as-a-service (out-of-process HTTP). **AutoCodeRover**/**gpt-engineer** Docker-isolated execution in throwaway git repos. **paperclip** isolates each run in a git worktree with a **no-remote-git contract** enforced by a static CI scanner (`check-no-git-push.mjs`). **AgentVerse**'s out-of-process BMTools HTTP tool server. The proposer/executor split in Agent-E (LLM proposes, separate executor runs) is a structural sandbox boundary.
- **Honest gaps (sandbox-by-default matters):** agency-swarm's `PersistentShellTool` runs real local shell (no isolation); babyagi `exec()`s stored code in-process by default (only the e2b plugin is sandboxed; authors warn "not for production"); anything-llm's MCP hypervisor flags arbitrary-code-exec with no isolation; open-interpreter/aider run on host with confirm. These confirm sandbox-by-default is a differentiator to own.
- **Redaction before persist:** langflow's `sanitize_data` + `SENSITIVE_KEYS_PATTERN`; paperclip's secret scrubbing across activity/wake payloads; openllmetry's content-trace flag.

**For zuzuagents.** Treat guardrails as inspectors in the same **ordered gate pipeline** as governance (goose/mastra): input guards (prompt-injection, PII scrub) before the model, output guards (moderation, schema validation, redaction) after — each with an `on_failure` policy and a **shadow mode** for safe rollout of new rules. Capture each as a **GUARDRAIL span** on the trace.
- **Secrets:** encrypt at rest, inject into the **execution scope only** (babyagi Fernet + `key_dependencies`), scope+version+audit access (paperclip), and **scrub from prompts and the trace store** (browser-use placeholders). Prefer **proxy-side credential injection** (onyx) so the sandbox never holds the raw secret.
- **Sandbox isolation:** zuzuagents must **sandbox by default** (the explicit gaps above are the lesson). Adopt a **graduated, swappable** isolation ladder behind one interface (Phoenix `SandboxBackend` ABC / google-adk levels), addressed by ID and metadata-tagged (e2b), with **per-sandbox egress allow/deny** as enforceable config — governance at the runtime boundary, not app-layer hope. (Isolation here is the *safety* angle; the tool ladder itself is owned elsewhere.)
- Surfaces: guardrail policy on **agent detail** / **tools** / **governance**; secrets management on **tools**; sandbox config + egress policy on **tools**/**runtime**; redaction enforced before the **trace**/**dashboard**.

---

### Work items / tickets / task queues

**What it is.** A work-item or ticket is a durable, addressable unit of work an agent picks up, advances, and completes — with status, an assignee, dependencies on other items, and often a parent for work breakdown. A task queue is the mechanism agents pull from. Mature systems separate two relations that are easy to conflate: **structure** (parent/child = work breakdown + rollup) and **dependency** (blocked-by = can't proceed until X changes). **Note for zuzuagents: there is NO tickets entity in the concept.** The closest primitive is the typed trace tree itself — so "tickets" should be treated as a *candidate view over the trace/work-item*, not assumed as a separate entity. This section describes what tickets look like in the field *if* zuzuagents chooses to surface them.

**Design space.**
- *Entity vs view:* a first-class issues table vs a derived view over trace/operation rows vs tasks-as-tools (agents file/update tasks via tool calls).
- *Structure vs dependency:* `parentId` (breakdown) kept separate from `blockedByIssueIds` (blockers) — the clean split — vs one conflated graph.
- *Assignment:* single-assignee invariant (agent XOR human) vs multi; routing by reporting line / mailbox.
- *Queue mechanics:* DB-backed wakeup queue with coalescing + idempotency vs in-process `p-queue` vs message bus; exact-once decomposition to avoid duplicate child trees.
- *Lifecycle:* status enum (queued→running→awaiting_input→done/failed) with run-history rows; readiness (deps satisfied) gating pickup.
- *External waits:* one-shot monitors polling CI/deploys with timeout/maxAttempts.

**In the field.**
- **paperclip** is the template: a single-assignee invariant on issues (`assigneeAgentId` XOR `assigneeUserId`), and the deliberate **separation of `parentId` (work breakdown + rollup) from `blockedByIssueIds` (blockers)**; goal ancestry travels with every issue so agents see the "why"; **accepted-plan decomposition** is exact-once keyed on `(sourceIssueId, acceptedPlanRevisionId)` so concurrent retries don't duplicate child trees; a DB-backed **wakeup queue** (`agent_wakeup_requests`) with coalescing + idempotency keys; **one-shot issue monitors** (`executionPolicy.monitor.nextCheckAt`) poll external async services with timeout/maxAttempts/recoveryPolicy.
- **cline**'s `TeamTask` (tickets with `dependsOn` chains + readiness) + `TeamMailboxMessage` (reporting-line routing) + `TeamRunRecord` (lease/heartbeat/`nextAttemptAt` backoff) is an almost turnkey dependency-aware ticket schema.
- **Tasks-as-tools:** agent-kit's `create/get/list/update_task` tools (backed by `is_state_injected`) let agents file and update tickets; marvin's `PlanSubtasks` end-turn tool creates subtasks dynamically; AgentGPT's typed `AgentWork` worklog (run/conclude/next/onError) is a ticket's step lifecycle.
- **Trace/run rows as the de-facto ticket:** anything-llm's scheduled-job run rows (status enum + timeout + SIGTERM kill + push-on-finish); AutoGen Studio's `Session → Run → Message(+meta)` + RunStatus; AutoGPT's `AgentGraphExecution` tree; babyagi's dual-FK Log; lobe-chat's `agent_operations` (the single table that is tickets + trace + budget + HITL at once); skyvern's task table where "the tool-call trace IS the task table" (GraphQL `BroadcastTaskAdded`/`BroadcastFlowUpdated`).
- **Queue mechanics:** anything-llm's child-process workers gated by cron + `p-queue`; AutoGPT's RabbitMQ dispatch + Redis locks + separate executor/scheduler processes; langfuse's BullMQ queue catalog (~35 queues incl. a DeadLetterRetryQueue); metagpt's `Environment` message bus routing by `member_addrs` + `_watch(actions)`; Agno's `tasks` team mode (shared task list + loop-until-done) as tickets flowing down reporting lines.
- **paperclip's liveness contract** is the discipline: every non-terminal issue must answer "what moves this forward next?" via a typed action-path primitive (active run / queued wake / monitor / interaction / approval / human owner / blocker chain / recovery) — otherwise it is visibly "stalled," never silently completed.

**For zuzuagents.** **Flag this explicitly: zuzuagents has no tickets entity in its concept.** The default position is **tickets = a view over the trace tree** — a top-level AGENT span (a delegated unit of work) *is* a work-item; status, assignee, and lineage are span attributes; the work breakdown is the trace's parent/child nesting and the runtime reporting tree from the recursive contract.
- If a first-class tickets entity is later wanted, model it on **paperclip**: single-assignee invariant, **`parentId` (breakdown) split from `blockedByIssueIds` (dependency)**, exact-once decomposition, and the **liveness contract** (every non-terminal item has a typed next-action or is visibly stalled). Adopt cline's `dependsOn` + readiness for dependency gating.
- Do *not* quietly assume a tickets table; surface the decision. Either way, the durable substrate is the trace — agents file/update work via tasks-as-tools (agent-kit), and those operations land as spans.
- Surfaces: if surfaced, **tickets** is a filtered view of the **trace**; assignment ties to the **org chart**; queue/liveness state shows on **runtime**.

---

### UI/UX surfaces

**What it is.** The surfaces are where humans actually operate the system: an **org-chart canvas** to compose and inspect the team, **run visualization** (a live "run-pulse" along the canvas plus a trace inspector) to watch and debug executions, an **approval inbox / annotation queue** to action pauses and reviews, **dashboards** for cost/health/eval aggregates, and ergonomic accelerators like a command palette. The recurring lesson: drive every live view from the *same* trace/event stream (don't build parallel plumbing), render entities through consistent CRUD modals, and make the run a navigable graph rather than a wall of logs.

**Design space.**
- *Org chart / builder:* React Flow / `@xyflow` node-graph canvas with auto-layout (elk/dagre) vs tree/list; drag-to-wire (`@dnd-kit`).
- *Run visualization:* interactive flowchart of the run vs timeline/span-tree inspector vs live log stream; run-pulse animation along active edges; scatter/gather (parallel rays → fusion) view.
- *Live transport:* WebSocket / SSE / GraphQL subscriptions / Pusher pushing trace events to the client; per-conversation isolated stores to avoid global re-renders.
- *Trace inspector:* payload/measurements debugger (latency/token table, payload override) vs replay/time-travel scrubber vs trajectory viewer (problem + cost + patch + eval in one).
- *Approval/annotation surface:* inbox/queue with per-item locking + assignment; annotation forms.
- *Config rendering:* schema-driven auto-rendered forms (typed config → admin/user form) vs bespoke per-backend UI.
- *Sandbox observability:* noVNC / live browser observer for sandboxed work.
- *Entity management:* modal CRUD per entity + a conversation/run branch tree.

**In the field.**
- **Run-as-flowchart / canvas:** voltagent's VoltOps renders multi-agent runs as interactive flowcharts; AutoGPT/dify/langflow use **React Flow (`@xyflow`)** node-graph builders (skyvern also React Flow + Zustand); Burr's "your app IS the visualizable graph." big-agi's **Beam** scatter/gather (N models in parallel → human-in-the-loop fusion of typed `Instruction[]` steps; stage state machine idle/fusing/success/stopped + per-ray `AbortController`) is a ready "compare generations"/ensemble view. `@dnd-kit` (a big-agi dependency) is the natural drag tool for an org-chart canvas.
- **Time-travel / replay:** AgentOps's `timetravel` route + `span-visual-list`/`spans-list` execution-tree components (Next.js App Router + shadcn + Tailwind, route-per-domain: traces/deploy/timetravel/logs/[sessionId]); browser-use's `AgentHistoryList` (per-step thoughts/actions/results/screenshots + rerun helpers).
- **Trace inspector / payload debugger:** big-agi's AIX debugger (payload override + a latency/token **measurements table**); SWE-agent's `http.server` trajectory inspector stitching problem + cost + patch + eval result into one browsable view, with WebSocket broadcast of the trajectory stream to React; mastra's **playground** (inspect agents, threads, traces, scores, memory); langroid's styled `HTMLLogger`; memary's ANSI-stripped ReAct trace in a Streamlit dashboard.
- **Approval inbox / annotation queue:** **langfuse**'s `AnnotationQueue`/`AnnotationQueueItem` (PENDING/COMPLETED, **per-item locking**, assignment) — the canonical inbox; **Agno**'s approvals API router + inbox; **cua**'s async pending-approval queue + Gradio UI; paperclip's board approval workflow.
- **Dashboards:** litellm's Next.js 16 + antd admin dashboard powered by **daily spend rollup tables** (the data→dashboard plumbing is the reusable idea); AutoGPT's monitor processes (accuracy/error/late-execution/notification) + Prometheus; babyagi's embeddable Flask dashboard (function graph, log relationship graph) mounted on a route; Helicone's heartbeat/alerting worker posting structured Slack blocks.
- **Entity CRUD + branch tree:** open-webui's modal-driven CRUD over each noun (Models/Prompts/Tools/Skills/Knowledge) + `Overview.svelte` conversation branch tree + `playground/` + `admin/`; mem0's Redux-Toolkit sliced store + Radix/Tailwind dashboard (slices apps/memories/config/filters).
- **Schema-driven config forms:** open-webui's Valves (typed Pydantic config auto-renders as admin/user forms); langflow's schema-driven typed-input panels; Phoenix's server-driven "generative UI" manifest whitelisting which components an agent may render (a UI safety boundary).
- **Live transport & isolation:** GraphQL subscriptions (skyvern `Broadcast*`), Pusher (composio), WebSocket (gpt-researcher's `stream_output` color-coded by agent role; AutoGen Studio); big-agi's vanilla-Zustand **per-conversation** stores + `ConversationHandler` overlay (real-time updates without global re-renders).
- **Sandbox observer:** noVNC live-browser streaming in skyvern and openclaw (sandboxed browser with dedicated network + CIDR allowlist + noVNC observer) — watchable sandboxed work.
- **lobe-chat / paperclip** are the on-point control-plane UIs: lobe-chat's per-tool `client/` React UI convention + headless primitives; paperclip's React + Vite + shadcn-style + Storybook, "monitor cost + work from one dashboard."

**For zuzuagents.** Map the field's UX onto the decided surfaces, all driven by the keystone trace:
- **Org chart:** React Flow / `@xyflow` canvas with auto-layout for the strict 1:N tree + mirror aliases; `@dnd-kit` for wiring reporting lines.
- **Runtime / run-pulse:** animate active edges from the **live span stream** (voltagent flowchart model) — the *same* stream that feeds evals, no parallel plumbing. Use WebSocket/SSE with per-run isolated stores (big-agi `ConversationHandler`) to avoid global re-renders. Offer a big-agi-Beam-style scatter/gather view for comparing generations.
- **Trace inspector:** combine AgentOps's span-tree/time-travel scrubber with big-agi's payload+measurements debugger and SWE-agent's "problem + cost + patch + eval in one view" on the **generations/evals** surface.
- **Approval inbox / annotation queue:** the langfuse `AnnotationQueue` (per-item locking + assignment, PENDING→COMPLETED) is the destination for the **paused-for-human** state — on the **dashboard**.
- **Dashboards:** drive **budgets**/health/eval aggregates from **daily rollup tables** (litellm) over the trace; consider monitor processes (AutoGPT) for alerting.
- **Config forms:** schema-driven auto-rendered forms (open-webui Valves) let **memory**/**tools** tabs render faculty config without bespoke UI per backend; whitelist agent-rendered components (Phoenix) as a safety boundary.
- **Sandbox observer:** noVNC live view (skyvern/openclaw) once L2 sandbox runs are watchable — on **runtime**.
- A **command palette** is the ergonomic accelerator across surfaces (jump to agent, ticket/trace, generation, approval).
---

## Borrow list — Top 20, prioritized & mapped to a surface

Ranked by leverage. Surfaces: `org chart · agent detail · memory · tools · generations/evals · tickets · budgets · dashboard · runtime`.

| # | Borrow | Source(s) | Surface | Why it's high-leverage |
|---|---|---|---|---|
| 1 | **Typed append-only tree-shaped trace (OTel span-kinds AGENT/TOOL/LLM/GUARDRAIL), one schema** | langfuse, agentops, openllmetry, burr, tabby | generations/evals + dashboard + runtime + budgets | The keystone. One artifact feeds evals, run-pulse, budget attribution, rollback anchoring. Build first. |
| 2 | **Versioned-definition row + `isActive` pointer + `forkedFrom`** (lockfile generations) | autogpt, babyagi, langflow, litellm AuditLog | generations/evals | The correct generation model; rollback = flip pointer, fork = relation. NOT run snapshots. |
| 3 | **Middleware/hook stack as the universal extensibility seam** | langchain AgentMiddleware, goose ToolInspectionManager, cua callbacks | runtime (+ all faculties) | Every faculty/gate bolts on as an ordered hook without forking the engine. |
| 4 | **`reportsTo` recursive self-FK; structure (`parentId`) separate from dependency** | paperclip, autogpt parent-run, babyagi dual-FK | org chart | The 1:N tree as a DB model; keep design-time parent vs runtime parent-run distinct. |
| 5 | **Delegation-as-a-tool scoped to direct reports + `can_handoff_to` allow-list + logged reason** | openai-swarm, agency-swarm, swarms SwarmSpec, llama_index | org chart + tickets | Reporting lines = which handles a node holds; auto-logs to the trace as the delegation audit. |
| 6 | **Durable `waitForEvent` HITL keyed to a work item + timeout-as-escalation** | agent-kit, paperclip wakeup queue, pydantic-ai DeferredTool | runtime + tickets | Closest analog to the decided CF-Workflows human gate; crash-safe approval. |
| 7 | **Checkout-vs-execution lock split + silent-run watchdog + crash reconciliation** | paperclip (read doc/execution-semantics) | runtime | Prevents double-work / runaway spend; the near-twin already solved it. |
| 8 | **Shared decrementing budget envelope propagated up the recursive tree (idempotent ledger)** | litellm budget-as-object, pydantic-ai usage propagation, camel/upsonic rollup | budgets | Matches the decided contract; doubles as cycle/runaway kill at zero. |
| 9 | **Tool-call-trace-as-eval-assertion (expected vs actual tool calls / memory ops)** | agno ReliabilityResult, upsonic ReliabilityEvaluator, openai-swarm | generations/evals + memory | Realizes the concept's L1 code-assertion + memory-operation eval cheaply. |
| 10 | **Unified Score table, source enum {HUMAN/AUTO/API}, attached to trace/observation** | langfuse, phoenix, openllmetry | generations/evals | Makes human review and auto-eval directly comparable; = the swappable-scorer ladder. |
| 11 | **Per-faculty memory extractor + cost-gatekeeper over one substrate** | lobe-chat gatekeeper, memary tier-views, mem0 scope-ID | memory | Tiered, governed, cost-aware memory; the closest analog to the decided ladder. |
| 12 | **Tool schema from typed signature + read/write effect class + risk hints** | codel, mcp-servers hints, goose permission_judge, browser-use | tools | Single source of truth; effect class feeds governance gates. |
| 13 | **MCP as universal tool protocol + tool-package convention; agent-management AS a tool** | goose, composio, mcp-servers, lobe-chat | tools + org chart | Free tool ecosystem; agents that build agents = build-your-team UX. |
| 14 | **Spec-vs-instance sandbox behind one swappable interface, addressed by ID, metadata-tagged** | e2b, openhands, swe-agent SWE-ReX | tools + runtime | Wrap Labs' Containers+DO sandbox so it stays swappable; reconnect runs by ID. |
| 15 | **Secret redaction before trace persist; proxy-side credential injection** | langflow sanitize, browser-use placeholders, onyx egress proxy | tools + dashboard + runtime | Essential for a multi-tenant trace store + sandbox that never holds secrets. |
| 16 | **Typed supervisor instruction enum bounded by `maxRounds` (testable state machine)** | lobe-chat GroupOrchestrationSupervisor, semantic-kernel magentic, camel channel | org chart + runtime | Clean, testable supervisor delegation along reporting lines. |
| 17 | **Approval inbox / annotation queue (per-item locking + assignment) as the `paused-for-human` destination** | langfuse AnnotationQueue, agno approvals router, cua queue | dashboard + tickets | Gives the design-spec `paused-for-human` node state a real surface. |
| 18 | **Run visualization as flowchart + run-pulse driven by the trace stream; trace inspector** | voltagent VoltOps, burr, big-agi debugger, swe-agent inspector | dashboard | Fills the canvas + Generation&Eval tab; reuses the trace, no new plumbing. |
| 19 | **Approval-gated proposal-first self-improvement (nightly review files a proposal)** | lobe-chat nightly review, cognee/agno proposal, dspy OfferFeedback | generations/evals | The concept's eval→harden→human-approve→new-generation loop, with auto-implement safely deferred. |
| 20 | **Tickets / work-items (NET-NEW — flag, don't assume)** | paperclip issues (`parentId` vs `blockedByIssueIds`), cline TeamTask (`dependsOn`), lobe-chat `agent_operations` | tickets | ⚠️ zuzuagents has **no tickets entity** in the concept — closest is the trace/work-item. Model on paperclip issues, or treat tickets as a *view over the trace tree*. |

---

## Appendix: the two near-twins

- **paperclip** — *the structural template.* For the org-chart DB model, the ticket/dependency split, the DB-backed wakeup queue, checkout-vs-execution locks, scoped budget policies, and a two-layer (portable-core + provider-adapter) memory contract, read paperclip's `doc/execution-semantics.md` and `doc/memory-landscape.md` cover-to-cover.
- **lobe-chat** — *the on-point feature reference.* For tiered governed memory (per-faculty extractor + gatekeeper), a typed supervisor instruction enum, an `agent_operations` ledger that unifies tickets+trace+budget+HITL, a generation-tracing table with prompt-hash drift guard, a rubric eval engine, and an approval-gated nightly self-review — lobe-chat has shipped close analogs.

---

## How to use this for the build
Build order implied by the borrow list: **(1) the trace** → **(2) generations on top of it** → **(3) the middleware/hook seam** the faculties bolt onto → then memory, tools, budgets, governance as hooks → finally the dashboard/run-pulse, which is just a view over the trace.
