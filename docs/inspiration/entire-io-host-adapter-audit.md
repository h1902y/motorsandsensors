# entire.io — host-adapter & session-observability audit (source-level)

> **Status:** source audit, 2026-06-08 (read-only `gh`, no clone). The closest real-world prior art to zuzu's host-adapter layer. Repo: `entireio/cli` (Go, MIT). **Corrects** two earlier mischaracterizations (see end).

## What it is
A CLI "system of record" for agent-assisted coding: installs git + per-agent hooks, captures each session (prompts, transcript, tool calls, files, tokens) in the background, and writes **Checkpoints linked to commits** so reviewers see the *why*, not just the diff. Local-first — stored in your own repo on a git branch; no server required. Host-agnostic across **Claude Code · Codex · Cursor · Copilot CLI · Gemini · Factory Droid · OpenCode · Pi** + external-agent plugins.

## The architecture (this is the blueprint zuzu adopts for the OBSERVE path)

**1. A real interface hierarchy** (`cmd/entire/cli/agent/agent.go`) — not "just hook files":
- **`Agent`** (required, all agents): `Name/Type/DetectPresence/ReadTranscript/GetSessionID/ReadSession/WriteSession/FormatResumeCommand/ProtectedDirs/…`
- **`HookSupport`** (optional): `HookNames()`, `ParseHookEvent(hookName, stdin) → *Event`, `InstallHooks(localDev, force)`, `UninstallHooks`, `AreHooksInstalled`.
- **Specialist optional interfaces** (implement only what the host supports): `TranscriptAnalyzer` (offset-based file-change extraction), `PromptExtractor`, `TranscriptPreparer`, `TokenCalculator`, `FileWatcher` (the fallback for hookless agents).
- **Registry factory** (`registry.go`): `Register(name, factory)` on `init()`; `Detect(ctx)` auto-detects the running agent by presence.

**2. One normalized `Event`** (`agent/event.go`) — every agent maps its native hook into this; the dispatcher routes by `EventType`, **never by agent name**:
```
EventType: SessionStart | TurnStart | TurnEnd | Compaction | SessionEnd
         | SubagentStart | SubagentEnd | ModelUpdate | ToolUse
Event{ Type, SessionID, PreviousSessionID, SessionRef, Prompt, Model, Timestamp,
       ToolUseID, SubagentID, ToolInput, SubagentType, TaskDescription,
       ModifiedFiles, NewFiles, DeletedFiles, CWD, ResponseMessage,
       DurationMs, TurnCount, ContextTokens, ContextWindowSize, SkillEvents, Metadata }
```

**3. Hook install = per-agent native-format writer** (`InstallHooks()` per agent). Examples (verbatim shapes):
- Claude Code → `.claude/settings.json` `hooks`: `SessionStart/SessionEnd/Stop/UserPromptSubmit/PreToolUse(Task)/PostToolUse(Task,TodoWrite)`, each command `entire hooks claude-code <hook>`; **plus** `permissions.deny: ["Read(./.entire/metadata/**)"]` (agent can't read its own session metadata → no feedback loop).
- Gemini → `.gemini/settings.json` (`Before/AfterModel`, `Before/AfterTool`, `PreCompress`, …) + `hooksConfig.enabled`.
- Cursor → `.cursor/hooks.json`; Codex → `.codex/hooks.json` (+ `codex_hooks=true`); OpenCode/Pi → **TypeScript** plugin files.
- **Graceful-degradation wrapper:** the hook command is wrapped so that if the `entire` binary is missing it prints a warning and `exit 0` — **never breaks the user's agent.**

**4. Dispatch at runtime** (`hook_registry.go` → `lifecycle.go`): hook fires → `entire hooks <agent> <hook>` → `ParseHookEvent(stdin)` → normalized `Event` → `DispatchLifecycleEvent` switches on `EventType` → strategy/checkpoint logic (all agent-agnostic).

**5. Storage — git branch, local-first** (`checkpoint/committed.go`): sharded tree on `entire/checkpoints/v1` (`<id[:2]>/<id[2:]>/…`): `metadata.json` (tokens, model, counts, attribution) + `full.jsonl` (transcript) + `prompt.txt` + task subtrees. Session state in `.git/entire-sessions/{id}.json` (shared across worktrees → cross-agent resume).

**6. Redaction at write** (`redact/`): a typed **`RedactedBytes`** (compile-time guarantee you can't persist un-redacted) produced by layered detection — Shannon-entropy (>4.5 bits), betterleaks 260+ patterns, credentialed URIs/DSNs, bounded key/value, optional PII. Runs **at checkpoint-write**, not at hook time (preserves live context).

**Capability spread (= progressive enhancement, concrete):** richest = **Claude Code** (full hook lifecycle + `TokenCalculator` + skill events); intermediate = **Cursor** (granular hooks, token report on PreCompact); thinnest = **Codex** (no hooks → `FileWatcher` fallback, files diffed from transcript at turn-end).

## Learnings zuzu adopts
1. **HostAdapter = entire's observe model, NOT goose's streaming-bridge.** zuzu wraps (observes) a loop it doesn't drive → adopt `Agent` + optional `HookSupport`/capability interfaces + a registry, **not** `run()/stream()`. *(Corrects the prior goose/hermes-modeled adapter.)*
2. **Adopt the normalized `Event` as the basis of zuzu's trace-span schema** (answers the concept's "design the trace schema once"). EventType-routed dispatch keeps all downstream (eval lens, faculty graduation) agent-agnostic.
3. **Optional capability interfaces are the progressive-enhancement mechanism** — agents implement only what they support; a `FileWatcher` fallback covers hookless hosts. Capture completeness varies by host, by design.
4. **Per-agent native hook-writer + one callback binary + graceful-degradation wrapper** — install into each agent's own config dir; never break the host if our binary is absent.
5. **`RedactedBytes` type + redact-at-write** — make un-redacted persistence unrepresentable; entropy + pattern + PII layered. Direct fit for zuzu's Guardrails/secrets.
6. **Git-branch-as-storage** is the concrete substrate for zuzu's **local-native mode**; session state in `.git/` for cross-agent continuity. Server sync layers on top.
7. **`permissions.deny` on our own metadata dir** — stop the host agent from reading zuzu's session/metadata files (avoid feedback loops + accidental context pollution).

## Differentiator (unchanged, sharpened)
entire stops at **system-of-record** (capture + link to commits). It does **not** evaluate or evolve. **zuzu's wedge is the graduation engine** (eval → propose → graduate faculties) acting *on* the captured record — entire is the validated capture substrate, not a competitor on the core thesis.

## Corrections to earlier docs
- **`model-provider-agnosticity-audit.md` / foundation HostAdapter:** the adapter shape there (subprocess/protocol **streaming bridge**, from goose/hermes) is for *driving* a host. For zuzu's **wrap-and-observe** model, the correct shape is entire's **hook-callback → normalized Event** (this doc). Keep the streaming-bridge only if zuzu ever *drives* a host (not in scope).
- Earlier claim "entire has no unified adapter interface" (from marketing docs) is **false at source** — it has a clean `Agent`+`HookSupport`+capability-interface hierarchy with a normalized Event.

## Honest notes
- Read via `gh` at source level; file paths + struct/interface names quoted from the agent's source pass. Spot-verify the exact `Event` fields against `cmd/entire/cli/agent/event.go` before copying into a schema.
- entire is MIT — patterns are freely borrowable; if borrowing *code*, check current license header.
