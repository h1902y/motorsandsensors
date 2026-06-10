# Model & provider agnosticity — source-level GitHub audit

> **Status:** source audit, 2026-06-07 (read-only `gh`/raw-file, no clone). Grounds the agnosticity model in [`../agent-foundation-primitives.md`](../agent-foundation-primitives.md). Repos audited: goose, hermes-agent, aider, continue, litellm, codex, gemini-cli, OpenClaw. **Honest verification flags at the end.**

## The two needs (opposite sides of the agent loop)
- **Need 1 — Host-agnosticity.** zuzu wraps a host CLI (Claude Code / Codex / Gemini) that **owns its agent loop + model**. zuzu does not pick the agent-loop model — it bridges the host's wire protocol.
- **Need 2 — Internal-inference provider-agnosticity.** zuzu's *own* faculty ops (extraction, eval-judge, proposals) run on a cheap model — a **stopgap until MCP Sampling**, so the layer is designed to be mostly deleted later. *This framing is decisive: don't over-build it.*

## Config-schema patterns observed
| Pattern | Where | Shape |
|---|---|---|
| `provider/model` route string | litellm, aider, OpenClaw | `"anthropic/claude-opus-4-6"`; one resolver splits it |
| Per-faculty/role model keys defaulting to main | aider (main/weak/editor), continue (`roles[]`), OpenClaw (per-faculty keys), goose (`GOOSE_PLANNER_*`), hermes (`auxiliary.<task>`) | each faculty independently bindable; unset = inherit default |
| `string \| {primary, fallbacks[]}` model ref | OpenClaw | a model key is a bare string or a chain |
| Custom-provider table separate from selection | OpenClaw, codex `[model_providers.<id>]`, litellm `model_list[]`, goose `custom_providers/*.json` | endpoint/auth/transport defined once, referenced by id |
| Catalog-driven (data, not code) | hermes (models.dev + overlays), goose (declarative JSON), aider (`model-settings.yml`) | adding a provider = data |
| `${ENV}` indirection for secrets | litellm, OpenClaw, goose | YAML never holds raw keys |
| No provider table (env auto-detect) | gemini-cli `getAuthTypeFromEnv()` | a host can opt out of explicit provider config entirely |

**Key structural lesson (OpenClaw, verified):** `Model { id, name, api, provider, baseUrl }` separates **`api`** (wire protocol: `openai-completions` / `anthropic-messages`) from **`provider`** (auth/naming id; open `type Provider = string`). A new OpenAI-compatible vendor = `api: openai-completions` + `baseUrl` + key → **zero code**.

## Need 1 — the HostAdapter contract (verified across 3 repos)
**A wrapped host = one adapter whose `run()`/`stream()` is a subprocess/protocol bridge, not an HTTP completion call** — normalizing the host's native output (stream-json / ACP / app-server JSON-RPC) to **one internal event type**; the rest of the system never learns it isn't a normal LLM.
- goose: `crates/goose/src/providers/claude_code.rs`, `codex_acp.rs`, `gemini_cli.rs` — same `Provider` trait; `stream()` spawns the host CLI and bridges NDJSON.
- hermes: `agent/copilot_acp_client.py`, `transports/codex_app_server.py` — OpenAI-compatible shim over `--acp` / `app-server`, normalized to one shape, opt-in gated.
- OpenClaw: `src/agents/harness/builtin-openclaw.ts` — its own loop implements the same `AgentHarness` contract as external `codex`/`copilot` harnesses; `registerAgentHarness(...)`, selected by `supports()`+priority.

Recommended contract: `{ id, supports(ctx)→{supported,priority}, ownsModelSelection:true, modelSelectionHint?, run(params)→AsyncIterable<NormalizedEvent>, init({workingDir,sessionId,env}), dispose() }`. Rules:
1. **Normalize to ONE internal event type at the seam**; keep retries/auth/caching in zuzu core, not per-adapter (hermes `ProviderTransport`).
2. **Construction-time `workingDir`/session anchor** distinct from the hot path (goose `from_env_with_working_dir`).
3. **Host declares it owns model selection** (goose `model_selection_hint`) → zuzu's model UI degrades gracefully.
4. **Assume NO shared host schema** (codex = provider/profile then model string; gemini-cli = env-detected AuthType + `--model`, no provider table).
5. **Owner-id per adapter** for hot-swap/teardown (OpenClaw `sourceId`, hermes `pluginId`).
6. **Pick by `supports()`+priority probe**, not hardcoding.

## Need 2 — internal-inference (thin litellm-style, not vendored)
- **Adopt aider's altitude, not continue's:** aider has *zero* per-provider subclasses — `Model.send_completion()` → one kwargs dict → `litellm.completion()`, provider from the model-string prefix, lazy import, `drop_params=True` (`aider/models.py:985`, `aider/llm.py`). Contrast continue's ~70 `BaseLLM` subclasses (`core/llm/llms/index.ts`) — too much to maintain for a deletable layer.
- **Copy litellm's canonical-transform *pattern* without the dependency:** each provider implements `map_openai_params`/`transform_request`/`transform_response`/`get_error_class` against ONE OpenAI-canonical shape + `drop_params` (`litellm/llms/base_llm/chat/transformation.py`). Don't vendor litellm's Router/cooldown/credential-union (`litellm/router.py`) — far heavier than 3 faculty ops need.
- **Single required primitive = `stream()`** (goose `providers/base.rs`: `complete = collect_stream(stream)`, embeddings/oauth defaulted).
- **Auth:** validate per-provider up front, surface `missing_keys` as config errors not runtime 401s (aider `fast_validate_environment`); env indirection; reject conflicting auth modes (codex `validate()`); ambient creds return a sentinel (OpenClaw `<authenticated>` for Vertex/Bedrock).
- **Fallback:** tie to **selection source** (user-pinned = STRICT; `default` walks fallbacks — OpenClaw `model-failover.md`), **error-type-keyed** (litellm `context_window_fallbacks` / `content_policy_fallbacks`), + **HTTP-402/credit failover** (hermes).
- **Local models = ordinary descriptors** (`api`+`base_url`+no key). Gotchas to copy: Ollama native `/api/chat` not `/v1` (breaks tool calling); localhost→127.0.0.1 (continue); **exact-host `api_base` match before attaching stored keys** (litellm `_endpoint_matches_api_base` — anti-exfiltration).

## Recommended config — two independent blocks
`host:` (active + per-host adapters; model is **opaque/host-owned**, null = host default) and `inference:` (`default` cheap model + per-faculty overrides defaulting to it + custom `providers` keyed by `api`/`base_url`/env-key + type-keyed `fallbacks`). (Full sketch in the foundation doc.)

## Top-8 learnings (tagged)
1. **[host]** Wrap each host as one adapter; `run()` is a subprocess/protocol bridge → one internal event type. *(goose/hermes/OpenClaw)*
2. **[host]** Assume no shared host model-schema; map zuzu intent onto each host's real knob. *(codex vs gemini-cli)*
3. **[internal]** Thin litellm-style seam, not a subclass tree — it's a stopgap until MCP Sampling. *(aider vs continue)*
4. **[internal]** Per-faculty model binding defaulting to one cheap `default`. *(aider/continue/OpenClaw/hermes)*
5. **[internal]** Fallback gated on selection-source + error-type-keyed + 402 failover. *(OpenClaw/litellm/hermes)*
6. **[host]** Construction-time `workingDir`/session anchor separate from the inference surface. *(goose)*
7. **[internal]** Validate per-provider auth up front; env indirection; reject conflicting modes. *(aider/litellm/codex)*
8. **[internal]** Local models as ordinary descriptors; copy Ollama + exact-host-`api_base` gotchas. *(goose/continue/OpenClaw/litellm)*

## Honest gaps & verification flags
- **Claude Code is closed-source** — never auditable. zuzu's most important host adapter must be **reverse-engineered from CLI flags / stream-json I/O**; goose's `claude_code.rs` is the best reference (`--input-format stream-json --output-format stream-json --include-partial-messages`). Treat its contract as *inferred*.
- **MCP-Sampling migration is unprecedented** in all 6 repos — no source shows offloading internal inference via Sampling. Design the resolver to swap to an MCP-sampling client behind the same `complete()`/`stream()` surface, but know this is forward-looking.
- **OpenClaw metadata anomaly:** the repo reports ~377k stars / created 2025-11-24 — implausible. The *file paths + code constructs* (`AGENT_MODEL_CONFIG_KEYS`, `ProviderPlugin`/`registerAgentHarness`) were verified to resolve, so the **patterns are real** — but the same patterns are independently verified in **goose + hermes** (genuinely open-source). **Lean on goose/hermes as the backbone; treat OpenClaw as corroborating-only.**
- continue's multi-provider fallback lives server-side (`continue-proxy`, outside the repo) → continue gives role-selection evidence, not fallback evidence.
