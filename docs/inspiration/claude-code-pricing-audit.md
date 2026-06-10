# Claude Code pricing audit — why interactive-mode-first

> **Status:** audit, 2026-06-07. Grounds the **interactive-mode-first** pillar in [`../agent-foundation-primitives.md`](../agent-foundation-primitives.md). **Verified-vs-directional split is explicit** — don't quote the directional numbers externally without re-checking.

## The question
Claude Code has two modes: **interactive** (the `claude` TUI a developer drives) vs **non-interactive / headless** (`claude -p`, `--bare`, the Agent SDK). The competing harnesses (OpenClaw, Hermes) drive Claude Code *non-interactively*. Did a recent pricing change hurt them while sparing interactive use?

## Verified (primary source — `code.claude.com/docs/en/headless`, fetched 2026-06-07)
- **The billing split (the crux), quoted verbatim:** *"Starting June 15, 2026, Agent SDK and `claude -p` usage on subscription plans will draw from a new monthly Agent SDK credit, separate from your interactive usage limits."* → interactive subscription usage is **unchanged**; headless/SDK usage is **metered separately** (billed at API rates once the credit is exhausted).
- **`--bare` forces API keys:** *"Bare mode skips OAuth and keychain reads. Anthropic authentication must come from `ANTHROPIC_API_KEY`…"* — and `--bare` is *"the recommended mode for scripted and SDK calls, and will become the default for `-p` in a future release."* → the headless path is being steered off subscription auth onto pay-as-you-go API billing.
- **Interactive has capabilities headless lacks:** *"User-invoked skills … and built-in commands are only available in interactive mode."* And `--bare` **skips auto-discovery of hooks, skills, plugins, MCP servers, auto memory, and CLAUDE.md.**

## Directional (agent-reported via web research, NOT independently verified — treat as leads)
- **Aug 28, 2025:** weekly rate limits for Pro/Max (applies to all subscription usage, not mode-specific). (Consistent with the known real Jul-2025 announcement.)
- **Feb 2026:** ToS clause restricting OAuth to first-party (Claude Code / Claude.ai) — third-party products must use API keys.
- **Apr 4, 2026:** OpenClaw / third-party-harness ban from subscription credentials.
- **Exact Agent-SDK credit amounts** ($20 / $100 / $200 per tier). *Do not cite these numbers externally without re-verifying the support article.*

## How the wrappers invoke Claude Code (directional)
- **OpenClaw** — shells out to `claude -p` (headless) / Agent SDK.
- **Hermes** — two paths: headless `claude -p`, and PTY-driving the interactive TUI via tmux `send-keys`/`capture-pane`.

## Why this means interactive-mode-first (a double tailwind for zuzu)
1. **Pricing side:** headless wrappers sit in the metered Agent-SDK pool (or forced onto API keys via `--bare`). zuzu augments the **interactive** session → rides the **unchanged subscription** pool.
2. **Surface side:** zuzu's entire mechanism — **hooks, MCP, CLAUDE.md injection, skills** — *only fully works in interactive mode* (`--bare`/headless skips all of it). Headless wrappers lose exactly the surface zuzu depends on, **and** get metered for it.

| Change | Date | Hurts | Spares | Confidence |
|---|---|---|---|---|
| Agent-SDK credit split | Jun 15 2026 | headless `claude -p` / Agent SDK / wrappers | interactive subscription use | **Verified** (primary) |
| `--bare` → API-key-only | current | scripted/SDK callers | interactive (OAuth) | **Verified** (primary) |
| skills/built-ins interactive-only | current | headless feature parity | interactive | **Verified** (primary) |
| OpenClaw / harness ban | ~Apr 2026 | third-party headless harnesses | — | Directional |
| Weekly rate limits | Aug 2025 | all heavy subscription use | (mode-neutral) | Directional |

## Residual watch-item
Anthropic *could* later police interactive-augmentation tools too (e.g. hook/automation detection). **No evidence today** — interactive use is explicitly permitted — but track it.
