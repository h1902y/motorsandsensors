# Terminal-first Runtime — verification research

> **Status:** read-only web research, 2026-06-07. Grounds the wrap-the-host runtime model in [`../agent-foundation-primitives.md`](../agent-foundation-primitives.md). Cited; **honesty flags inline** — some claims are spec-real but not host-supported yet.

## 1. Are OpenClaw / Hermes / Pi real, and are they terminal-first encapsulators?
- **OpenClaw — VERIFIED.** An *agent harness* that "manages everything except the LLM's reasoning" (provider/model selection, auth, context budget, transcript, workspace, sandbox, tool policy, channel delivery). Extends via three plugin types: **Provider plugins**, **Agent-Harness plugins** (native session runtimes, e.g. a Codex harness), **Tool-Result Middleware**. **This is essentially zuzu's shape** — and the framing "the agent harness is eclipsing the frontier model" is our thesis. Refs: docs.openclaw.ai/plugins/sdk-agent-harness ; wireloop.ai/press/the-agent-harness-openclaw-hermes-cli-anything ; zylon.ai blog.
- **Hermes — VERIFIED** (Nous Research). A standalone, terminal-first, **self-improving** agent (CLI + Telegram/Discord/Slack); **creates & improves its own skills, extraction after 5+ tool calls.** Not a wrapper — a frontier agent — but it *validates the evolving-Actions/skills faculty.* Refs: github.com/nousresearch/hermes-agent .
- **Pi / pi-dev — UNVERIFIABLE.** Referenced as influencing Hermes' RPC mode; no standalone product/GitHub found. Treat as unverified.

## 2. Terminal coding agents — instruction files / MCP / hooks / trace
- **goose** (Block): YAML config + portable **recipes**; **full MCP** (70+ extensions); hooks on roadmap; `TrajectoryUsage` cost tracking.
- **aider**: Jinja2 prompt templates; consumable **as** an MCP server (community `aider-mcp-server`); audit via git commits.
- **continue**: agents are **`.continue/*.md`** files; full MCP (`.continue/mcpServers/`); tool-gating modes (Ask First / Automatic); no Sampling.

## 3. Host integration surfaces (what a wrapper can inject/observe/gate today)
- **Claude Code (richest):** **Hooks** — types `command/http/mcp_tool/prompt/agent`; events `SessionStart/UserPromptSubmit/PreToolUse/PostToolUse/Stop/SessionEnd`; `PreToolUse` can deny/allow/escalate. **CLAUDE.md**, **settings.json**, **`--append-system-prompt`**, full **MCP client**, **Elicitation implemented**, **Sampling NOT yet** (issue #1785). Refs: code.claude.com/docs/en/hooks , /mcp .
- **OpenAI Codex CLI:** **AGENTS.md** (global+project hierarchy, `~/.codex/AGENTS.override.md`), full **MCP** (Codex itself exposable as an MCP server over stdio), skills; no traditional hooks. Refs: developers.openai.com/codex/guides/agents-md .
- **Gemini CLI:** **GEMINI.md** context file, **extension ecosystem** (packages prompts + MCP servers + commands), full **MCP**; no explicit hooks. Refs: geminicli.com/docs .

## 4. MCP Sampling vs Elicitation — host-support reality (critical)
- **Sampling** (`sampling/createMessage` — server asks the *client's* model to complete, no server API key): spec finalized (2025-11-25) but **NOT implemented in Claude Code / Codex / Gemini / Continue today.** → We **cannot** yet run zuzu's internal LLM ops on the user's subscription via MCP; use our own cheap model until adoption. Ref: modelcontextprotocol.io/specification/2025-11-25/client/sampling ; Claude Code issue #1785.
- **Elicitation** (server requests structured user input): **implemented in Claude Code** (auto dialogs); partial elsewhere. → HITL/approval over MCP works today on Claude Code.

## 5. Prior art — wrap / proxy / observe an agent
- **MCP gateways:** IBM **mcp-context-forge** (registry+proxy over MCP/A2A/REST, OTel observability, auth/rate-limit, K8s); **MetaMCP** (aggregator/orchestrator/gateway in one); **AgentGateway** (MCP+A2A proxy: security/observability/governance).
- **ACP (Agent Client Protocol) proxy chains** — emerging standard for context injection between client and agent (inject AGENTS.md/skills/MCP resources; subsumes hooks/instruction-files into one proxy interface). Adopted by **Zed**; **not** by Claude Code/Codex/Gemini yet. Ref: agentclientprotocol.com/rfds/proxy-chains .
- **Invariant Gateway** — observe-mode LLM proxy (log everything, block nothing) for pre-policy data collection.
- **Cursor hooks** (enterprise) — `beforeShellExecution/beforeMCPExecution/beforeReadFile/afterFileEdit/stop`; partners MintMCP (tool inventory, sensitive-data scan), Snyk (prompt-injection/dangerous-call detection).
- **CLI-Anything** (HKUDS) — auto-generates agent-native CLIs (JSON output) for legacy software; relevant for *creating* Actions, not wrapping agents.

## 6. Top borrows
1. **Hook event model** (Claude Code/Cursor) — `PreToolUse`/`PostToolUse` as the capture+intercept points (where the host has hooks).
2. **Instruction-file hierarchy** (Codex AGENTS.md global→project) — `~/.zuzuagents/system.md` → `.zuzuagents/project.md` → per-agent; version-controlled, diffable.
3. **MCP gateway + OTel observability** (mcp-context-forge/MetaMCP) — a gateway between zuzu and MCP servers; host-agnostic tracing.
4. **W3C TraceContext in MCP `params._meta`** — host-agnostic, local-first end-to-end trace propagation.
5. **Inspector/gate pipeline** (goose/mastra) — Allow/Deny/RequireApproval; budget-zero→Deny, approval→RequireApproval→Elicitation/`waitForEvent`.

## 7. Honest gaps
- **MCP Sampling not host-supported** → we push adoption or use our own cheap model meanwhile.
- **ACP is the "correct" standard but barely adopted** (Zed only).
- **Trace-context propagation across hosts not yet standardized** (W3C-in-`params._meta` is the best available convention).
- **Per-host richness varies sharply** (Claude Code hooks ≫ Codex/Gemini) → progressive enhancement, Claude-Code-deepest.

> Foundational refs verified; product pages (OpenClaw/Hermes docs) and the MCP spec are primary sources. Recheck Sampling/Elicitation host-support before building anything that depends on them.
