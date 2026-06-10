// mns/actions/convert.mjs
// Pure manifest → tool-definition converters (the _labs tool-definition pattern).
// The manifest's `inputs` JSON Schema is already the right shape for each format,
// so conversion is a thin re-wrap. This is the bridge to DESIGN §6 "Actions over
// MCP": author the manifest once for `mns act`, get an MCP/OpenAI/Anthropic tool
// definition for free (Stage 2 / OpenCode).

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
