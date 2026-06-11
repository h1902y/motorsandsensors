// Delimiter-block injection for host instruction files (CLAUDE.md / AGENTS.md /
// GEMINI.md) — the supermemory coexistence pattern: our content lives between
// versioned markers; injecting again replaces OUR block only and never touches
// the user's surrounding text. Pure string functions; I/O stays in the command.

const BEGIN = (v) => `<!-- >>> zuzuu:faculties:v${v} >>> -->`;
const END = '<!-- <<< zuzuu:faculties <<< -->';
// Matches our block at ANY version AND either marker name (mns or zuzuu), so a
// pre-rebrand v7 `mns:faculties` block is replaced in place by the new
// `zuzuu:faculties` block — never duplicated.
const BLOCK_RE = /[ \t]*<!-- >>> (?:mns|zuzuu):faculties:v\d+ >>> -->[\s\S]*?<!-- <<< (?:mns|zuzuu):faculties <<< -->[ \t]*\n?/;

export const BLOCK_VERSION = 8;

/** The block content served to host agents. Keep short — it's steering, not docs. */
export function facultiesBlock(version = BLOCK_VERSION) {
  return `${BEGIN(version)}
## zuzuu — agent faculty home

This project has a zuzuu faculty home at \`agent/\` (managed by the zuzuu CLI; \`mns\` is a legacy alias). Work to this contract:

- **Ground.** At session start, read \`agent/.live/digest.md\` if it exists — your *zuzuu digest* (instructions, knowledge, actions, proposals, guardrails), regenerated each session. Trust it as ground truth; don't re-derive what it states or re-read faculty files it already summarized. (On Claude Code the same brief also arrives inline at session start.)
- **Cite in-flight.** When an answer draws on a stored fact, say \`from knowledge: <id>\`; when you follow a runbook/action, name it. Make the faculty visible.
- **Harvest at close.** Before ending, propose durable learnings as one-fact files in \`agent/knowledge/inbox/\` (plain text is fine), and propose any reusable procedure with \`zuzuu act propose <slug>\` (it lands in \`actions/inbox/\`). A human reviews both via \`zuzuu review\`. Never write \`knowledge/items/\` or active \`actions/\` directly.
- **Respect \`agent/guardrails/\`** — hard rules, *enforced* on tool calls by the zuzuu gate; a refusal there is policy, not preference.
- Do **not** read \`agent/.traces/\` or \`agent/.live/\` (zuzuu observability internals) — **except \`agent/.live/digest.md\`, which is written for you.**
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
