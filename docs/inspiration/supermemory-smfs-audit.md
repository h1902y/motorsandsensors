# supermemory/smfs — memory-as-a-filesystem audit (source-level)

> **Status:** source audit, 2026-06-08 (read-only `gh`). Repo: `supermemoryai/smfs` ("Supermemory Filesystem"), Rust+Python+TS, MIT, early-stage (v0.0.5, ~416★). Relevant to zuzu's **Knowledge/Memory faculties** and **faculty-serving surfaces**.

## What it is
Exposes an AI-memory container as a **mountable directory** — agents read/write/semantically-search memory as ordinary local files. Two access flows: a real **FUSE (Linux) / NFSv3 (macOS) mount**, or a **virtual-bash tool** (`@supermemory/bash`, TS/Py) for runtimes with no FS (serverless/edge). Files under configured **memory paths** get processed by Supermemory's server-side extraction+index pipeline; others are plain durable storage.

## The new idea for zuzu: a THIRD faculty-serving surface — the filesystem
zuzu had two serving surfaces (MCP, instruction-files). SMFS proves a third:
- **Mount / virtual-bash** — serve Knowledge/Memory as files. **Maximally host-agnostic**: every coding agent already has native `Read/Write/Grep/Bash` → **zero MCP wiring**, works on hosts with no hooks/MCP. The agent uses memory *naturally* (`cat`/`grep`), which directly mitigates "observability ∝ how much routes through us."
- **Flagless-grep = semantic, flagged-grep = literal** (`crates/smfs/src/cmd/grep.rs` + `init.rs` shell wrapper appended to `~/.zshrc`): semantic recall served through a command the agent already knows. "That split is the whole UX."
- **Virtual-bash single tool** (`bash/src/create-bash.ts`): `createBash()` returns `{ bash, toolDescription }` — one `run_bash(cmd)` tool over a memory-backed FS + a custom `sgrep`. Dropped into a Vercel-AI/Anthropic tool-set (no MCP). The FS-shaped surface for hosts without a real filesystem — and the one path zuzu can fully observe (single tool = one span).

## Reusable patterns (local-first — copy these)
- **Crash-safe coalescing push-queue** (`cache/schema.sql` `push_queue` + `sync/push.rs`): `inflight_started_at` atomic flag → exactly-one upload per filepath, pending write coalesces (≤2 requests/file); persists in SQLite, resumes on daemon restart; exp-backoff; failures surface as `<file>.smfs-error.txt` siblings.
- **`dirty_since` timestamp versioning** (`cache/fs.rs` `reconcile_one`): on pull, if local `dirty_since > remote updated_at` → **local wins, skip** (defer to push). Beats last-write-wins for multi-source sync.
- **Agent-hint injection with delimiter blocks** (`smfs-core/src/agent_hint.rs`): injects scoped hints into `~/.claude/CLAUDE.md` wrapped in `<!-- >>> smfs:<tag>:begin >>> -->` … `<<< end <<<`, **auto-removed on unmount** → multiple mounts coexist, clean teardown. (The coexistence discipline for zuzu's instruction-file injection — pairs with entire's hook-writer + `permissions.deny`.)
- **Tool-description-as-contract** (`bash/src/tool-description.ts`): the shipped string states what it can/can't do, **latency expectations** ("5–30s for indexing"), and the two-mode grep semantics — pushes discovery burden onto the designer, cuts hallucination.
- **Warm local cache** = SQLite filesystem tree (inodes+chunks) at `~/.cache/supermemoryfs/{org}/{tag}.db`; offline reads work; sync loops (delta-pull ~30s, deletion-scan ~5min, push, inflight-poll) gated on API presence.

## Honest assessment (the divergence from zuzu's thesis)
- **Heavy lifting is CLOUD-DEPENDENT (Supermemory SaaS):** extraction, chunking, embeddings, semantic index, and the synthesized `/profile.md` all run server-side; `sgrep` → remote `/v4/search`; no local vector index. Local = warm cache + durable queue only. **zuzu is local-first → copy the serving interface + cache/queue/versioning patterns, NOT the cloud dependency.** Our semantic tier (Knowledge L3 / Actions R3 pgvector) stays ours.
- **Filesystem is a serving *interface*, orthogonal to the *substrate*.** SMFS's "files + remote index" = "our Knowledge L3 vector tier, *served as a filesystem*." The mount does **not** replace the md→relational→graph→vector substrate ladder — it's a new way to *present* it.
- **Observability tradeoff:** a raw `cat memory.md` / wrapper-`grep` is **not** a clean tool-call span the way an MCP call is. Filesystem-serving trades observability granularity for host-agnostic reach. The **virtual-bash single-tool** is the compromise (FS-shaped, routed through one tool we trace).

## Five learnings for zuzu (tagged)
1. **[serving]** Add **filesystem (mount / virtual-bash) as a third faculty-serving surface** for Knowledge/Memory — most host-agnostic (uses the agent's own file tools, zero MCP), best for hosts without hooks/MCP.
2. **[serving]** **Virtual-bash single-tool** (`run_bash` + shipped tool-description) is the observable, FS-shaped surface for hosts without a real FS — and the version zuzu can fully trace.
3. **[knowledge/storage]** Adopt the **SQLite push-queue (`inflight_started_at` coalescing, resumable) + `dirty_since` versioning** for the Knowledge faculty's local sync — crash-safe, multi-source-safe.
4. **[serving/guardrails]** Adopt **delimiter-block instruction-file injection with auto-cleanup** (coexistence + teardown) — combine with entire's hook-writer + `permissions.deny`.
5. **[serving]** Ship a **tool-description-as-contract** (capabilities, can'ts, latency, mode semantics) for every served faculty surface.

## Notes
- Source-read via `gh`; paths/structs quoted from the agent pass — spot-verify before copying code. MIT-licensed.
- SMFS validates the *serving interface*; zuzu's local-first substrate + the graduation engine remain the differentiators.
