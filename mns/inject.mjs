// Delimiter-block injection for host instruction files (CLAUDE.md / AGENTS.md /
// GEMINI.md) — the supermemory coexistence pattern: our content lives between
// versioned markers; injecting again replaces OUR block only and never touches
// the user's surrounding text. Pure string functions; I/O stays in the command.

const BEGIN = (v) => `<!-- >>> mns:faculties:v${v} >>> -->`;
const END = '<!-- <<< mns:faculties <<< -->';
// matches our block at ANY version (so a v1 block is replaced by a v2 inject)
const BLOCK_RE = /[ \t]*<!-- >>> mns:faculties:v\d+ >>> -->[\s\S]*?<!-- <<< mns:faculties <<< -->[ \t]*\n?/;

export const BLOCK_VERSION = 2;

/** The block content served to host agents. Keep short — it's steering, not docs. */
export function facultiesBlock(version = BLOCK_VERSION) {
  return `${BEGIN(version)}
## mns — agent faculty home

This project has an mns faculty home at \`.mns/\` (managed by the mns CLI):

- **Read \`.mns/knowledge/\`** — verified project facts/entities. Treat as ground truth.
- **Follow \`.mns/instructions/\`** — project steering (who/how to be in this project).
- **Use \`.mns/actions/\`** — named procedures/runbooks for this project.
- **Respect \`.mns/guardrails/\`** — hard rules, *enforced* on tool calls by the mns gate.
- **Record durable, verified learnings** in \`.mns/knowledge/\` (facts only, no speculation).
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
