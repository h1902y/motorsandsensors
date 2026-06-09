# playground-4 — provider journey

Exercises the capture → OTLP journey for the four major hosts (Claude Code, Gemini CLI, Codex, OpenCode) against whatever is **real on this machine**, and prints an honest matrix:

- **✓ REAL** — adapter + real session data; full journey validated.
- **⏭** — adapter exists, but no data for that host here (use it once, then re-run).
- **✗** — no adapter yet (planned).

No fabricated green: a host only shows ✓ when its adapter parses a session that host actually produced. Fails only if a host with data yields an invalid trace; skips only if no host has any data.

Run: `node playground/run.mjs 4`
