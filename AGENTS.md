<!-- >>> zuzuu:faculties:v9 >>> -->
## zuzuu — agent faculty home

This project has a zuzuu faculty home at `.zuzuu/` (managed by the zuzuu CLI). Work to this contract:

- **Ground.** At session start, read `.zuzuu/.live/digest.md` if it exists — your *zuzuu digest* (instructions, knowledge, actions, proposals, guardrails), regenerated each session. Trust it as ground truth; don't re-derive what it states or re-read faculty files it already summarized. (On Claude Code the same brief also arrives inline at session start.)
- **Cite in-flight.** When an answer draws on a stored fact, say `from knowledge: <id>`; when you follow a runbook/action, name it. Make the faculty visible.
- **Harvest at close.** Before ending, propose durable learnings as one-fact files in `.zuzuu/knowledge/inbox/` (plain text is fine), and propose any reusable procedure with `zuzuu act propose <slug>` (it lands in `actions/inbox/`). A human reviews both via `zuzuu review`. Never write `knowledge/items/` or active `actions/` directly.
- **Respect `.zuzuu/guardrails/`** — hard rules, *enforced* on tool calls by the zuzuu gate; a refusal there is policy, not preference.
- Do **not** read `.zuzuu/.traces/` or `.zuzuu/.live/` (zuzuu observability internals) — **except `.zuzuu/.live/digest.md`, which is written for you.**
<!-- <<< zuzuu:faculties <<< -->
