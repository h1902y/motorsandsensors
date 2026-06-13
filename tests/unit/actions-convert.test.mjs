import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMcpTool, toOpenAITool, toAnthropicTool } from '../../zuzuu/actions/convert.mjs';

// An ACTION.md envelope manifest, as loadManifest returns it (W24).
const MANIFEST = {
  id: 'greet', module: 'actions', kind: 'script', title: 'Greet',
  status: 'active', created_at: '2026-06-12T00:00:00Z',
  payload: { exec: 'run.mjs' }, body: 'say hi\n\nlonger prose', promptSnippet: 'say hi',
};

test('toMcpTool: name/description/inputSchema (permissive object — no inputs in the envelope)', () => {
  const t = toMcpTool(MANIFEST);
  assert.equal(t.name, 'greet');
  assert.equal(t.description, 'say hi');
  assert.deepEqual(t.inputSchema, { type: 'object' });
  assert.equal(t.outputSchema, undefined, 'no outputs schema in the standard');
});

test('toOpenAITool: function wrapper', () => {
  const t = toOpenAITool(MANIFEST);
  assert.equal(t.type, 'function');
  assert.equal(t.function.name, 'greet');
  assert.equal(t.function.description, 'say hi');
  assert.deepEqual(t.function.parameters, { type: 'object' });
});

test('toAnthropicTool: name/description/input_schema', () => {
  const t = toAnthropicTool(MANIFEST);
  assert.equal(t.name, 'greet');
  assert.equal(t.description, 'say hi');
  assert.deepEqual(t.input_schema, { type: 'object' });
});

test('description falls back to title then id', () => {
  assert.equal(toMcpTool({ id: 'x' }).description, 'x');
  assert.deepEqual(toMcpTool({ id: 'x' }).inputSchema, { type: 'object' });
  assert.equal(toAnthropicTool({ id: 'y', title: 'Y' }).description, 'Y');
});
