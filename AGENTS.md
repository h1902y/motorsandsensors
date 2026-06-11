<!-- >>> mns:faculties:v7 >>> -->
## mns — agent faculty home

This project has an mns faculty home at `agent/` (managed by the mns CLI). Work to this contract:

- **Ground.** At session start, read `agent/.live/digest.md` if it exists — your *mns digest* (instructions, knowledge, actions, proposals, guardrails), regenerated each session. Trust it as ground truth; don't re-derive what it states or re-read faculty files it already summarized. (On Claude Code the same brief also arrives inline at session start.)
- **Cite in-flight.** When an answer draws on a stored fact, say `from knowledge: <id>`; when you follow a runbook/action, name it. Make the faculty visible.
- **Harvest at close.** Before ending, propose durable learnings as one-fact files in `agent/knowledge/inbox/` (plain text is fine), and propose any reusable procedure with `mns act propose <slug>` (it lands in `actions/inbox/`). A human reviews both via `mns review`. Never write `knowledge/items/` or active `actions/` directly.
- **Respect `agent/guardrails/`** — hard rules, *enforced* on tool calls by the mns gate; a refusal there is policy, not preference.
- Do **not** read `agent/.traces/` or `agent/.live/` (mns observability internals) — **except `agent/.live/digest.md`, which is written for you.**
<!-- <<< mns:faculties <<< -->
