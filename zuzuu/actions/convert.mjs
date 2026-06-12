// zuzuu/actions/convert.mjs
// Pure manifest → tool-definition converters (the _labs tool-definition pattern).
// Manifests are ACTION.md envelopes (W24): name = the envelope id, description =
// the prompt snippet (body first line) or title. The envelope carries no
// inputs/outputs JSON-schemas (clean break) — tool definitions expose the
// permissive object schema; the runner validates the same way.
//
// STATUS (2026-06-11): used today only by `zuzuu act schema <slug> [--mcp|--openai|
// --anthropic]` for inspection. There is NO runtime MCP/native-tool *serving* yet —
// actions are invoked via `zuzuu act <slug>` from the host shell and surfaced to the
// agent in the digest. Live "Actions over MCP" serving is DEFERRED (DESIGN §6 /
// Stage 2 / OpenCode bundle); these converters are the seam for it, not the thing.

const name = (m) => m.id ?? m.slug;
const desc = (m) => m.promptSnippet ?? m.title ?? name(m);
const inputs = () => ({ type: 'object' });

export function toMcpTool(m) {
  return { name: name(m), description: desc(m), inputSchema: inputs() };
}

export function toOpenAITool(m) {
  return { type: 'function', function: { name: name(m), description: desc(m), parameters: inputs() } };
}

export function toAnthropicTool(m) {
  return { name: name(m), description: desc(m), input_schema: inputs() };
}
