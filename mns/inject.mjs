// Delimiter-block injection for host instruction files (CLAUDE.md / AGENTS.md /
// GEMINI.md) — the supermemory coexistence pattern: our content lives between
// versioned markers; injecting again replaces OUR block only and never touches
// the user's surrounding text. Pure string functions; I/O stays in the command.

const BEGIN = (v) => `<!-- >>> mns:faculties:v${v} >>> -->`;
const END = '<!-- <<< mns:faculties <<< -->';
// matches our block at ANY version (so a v1 block is replaced by a v2 inject)
const BLOCK_RE = /[ \t]*<!-- >>> mns:faculties:v\d+ >>> -->[\s\S]*?<!-- <<< mns:faculties <<< -->[ \t]*\n?/;

export const BLOCK_VERSION = 5;

/** The block content served to host agents. Keep short — it's steering, not docs. */
export function facultiesBlock(version = BLOCK_VERSION) {
  return `${BEGIN(version)}
## mns — agent faculty home

This project has an mns faculty home at \`.mns/\` (managed by the mns CLI). Work to this contract:

- **Ground.** At session start you receive an *mns digest* (instructions, knowledge, proposals, guardrails). Trust it as ground truth; don't re-derive what it states or re-read faculty files it already summarized.
- **Cite in-flight.** When an answer draws on a stored fact, say \`from knowledge: <id>\`; when you follow a runbook/action, name it. Make the faculty visible.
- **Harvest at close.** Before ending, propose durable learnings as one-fact files in \`.mns/knowledge/inbox/\` (plain text is fine), and propose any reusable procedure with \`mns act propose <slug>\` (it lands in \`actions/inbox/\`). A human reviews both via \`mns review\`. Never write \`knowledge/items/\` or active \`actions/\` directly.
- **Respect \`.mns/guardrails/\`** — hard rules, *enforced* on tool calls by the mns gate; a refusal there is policy, not preference.
- Do **not** read \`.mns/traces/\` or \`.mns/live/\` (mns observability internals).
${END}`;
}

export function hasBlock(text) {
  return BLOCK_RE.test(text);
}

/**
 * Insert or replace our block in `text`. User content is never modified:
 * existing block → replaced in place; no block → appended with one blank line.
 */
export function injectBlock(text, block = facultiesBlock()) {
  if (hasBlock(text)) return text.replace(BLOCK_RE, block + '\n');
  const sep = text.length === 0 ? '' : text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n';
  return text + sep + block + '\n';
}

/** Remove our block (for the future `mns deinit`); user content untouched. */
export function removeBlock(text) {
  return text.replace(BLOCK_RE, '');
}
