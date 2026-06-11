import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMcpTool, toOpenAITool, toAnthropicTool } from '../../zuzuu/actions/convert.mjs';

const MANIFEST = {
  slug: 'greet', title: 'Greet', description: 'say hi',
  inputs: { type: 'object', properties: { who: { type: 'string' } }, required: ['who'] },
  outputs: { type: 'object', properties: { msg: { type: 'string' } } },
};

test('toMcpTool: name/description/inputSchema/outputSchema', () => {
  const t = toMcpTool(MANIFEST);
  assert.equal(t.name, 'greet');
  assert.equal(t.description, 'say hi');
  assert.deepEqual(t.inputSchema, MANIFEST.inputs);
  assert.deepEqual(t.outputSchema, MANIFEST.outputs);
});

test('toOpenAITool: function wrapper', () => {
  const t = toOpenAITool(MANIFEST);
  assert.equal(t.type, 'function');
  assert.equal(t.function.name, 'greet');
  assert.equal(t.function.description, 'say hi');
  assert.deepEqual(t.function.parameters, MANIFEST.inputs);
});

test('toAnthropicTool: name/description/input_schema', () => {
  const t = toAnthropicTool(MANIFEST);
  assert.equal(t.name, 'greet');
  assert.equal(t.description, 'say hi');
  assert.deepEqual(t.input_schema, MANIFEST.inputs);
});

test('description falls back to title then slug; inputs default to empty object schema', () => {
  const bare = { slug: 'x' };
  assert.equal(toMcpTool(bare).description, 'x');
  assert.deepEqual(toMcpTool(bare).inputSchema, { type: 'object' });
  assert.equal(toAnthropicTool({ slug: 'y', title: 'Y' }).description, 'Y');
});
