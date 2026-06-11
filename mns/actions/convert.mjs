// mns/actions/convert.mjs
// Pure manifest → tool-definition converters (the _labs tool-definition pattern).
// The manifest's `inputs` JSON Schema is already the right shape for each format,
// so conversion is a thin re-wrap.
//
// STATUS (2026-06-11): used today only by `mns act schema <slug> [--mcp|--openai|
// --anthropic]` for inspection. There is NO runtime MCP/native-tool *serving* yet —
// actions are invoked via `mns act <slug>` from the host shell and surfaced to the
// agent in the digest. Live "Actions over MCP" serving is DEFERRED (DESIGN §6 /
// Stage 2 / OpenCode bundle); these converters are the seam for it, not the thing.

const desc = (m) => m.description ?? m.title ?? m.slug;
const inputs = (m) => m.inputs ?? { type: 'object' };

export function toMcpTool(m) {
  const t = { name: m.slug, description: desc(m), inputSchema: inputs(m) };
  if (m.outputs) t.outputSchema = m.outputs;
  return t;
}

export function toOpenAITool(m) {
  return { type: 'function', function: { name: m.slug, description: desc(m), parameters: inputs(m) } };
}

export function toAnthropicTool(m) {
  return { name: m.slug, description: desc(m), input_schema: inputs(m) };
}
