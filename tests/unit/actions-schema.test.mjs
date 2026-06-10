import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../../mns/actions/schema.mjs';

test('object: required + property types', () => {
  const schema = { type: 'object', properties: { name: { type: 'string' }, n: { type: 'integer' } }, required: ['name'] };
  assert.deepEqual(validate(schema, { name: 'a', n: 3 }), []);
  assert.equal(validate(schema, { n: 3 }).length, 1);                 // missing required name
  assert.ok(validate(schema, { name: 5 })[0].includes('string'));     // wrong type
  assert.ok(validate(schema, { name: 'a', n: 1.5 })[0].includes('integer'));
});

test('scalars: string/number/boolean', () => {
  assert.deepEqual(validate({ type: 'string' }, 'x'), []);
  assert.equal(validate({ type: 'number' }, 'x').length, 1);
  assert.equal(validate({ type: 'number' }, NaN).length, 1);
  assert.deepEqual(validate({ type: 'boolean' }, true), []);
});

test('non-object value against object schema fails cleanly', () => {
  assert.ok(validate({ type: 'object' }, 'nope')[0].includes('object'));
  assert.ok(validate({ type: 'object' }, null)[0].includes('object'));
  assert.ok(validate({ type: 'object' }, [])[0].includes('object'));
});
