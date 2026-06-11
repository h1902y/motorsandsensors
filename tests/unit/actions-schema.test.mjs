import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../../zuzuu/actions/schema.mjs';
import { validateInputs, validateOutputs } from '../../zuzuu/actions/schema.mjs';

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

test('enum + constraints', () => {
  assert.deepEqual(validate({ type: 'string', enum: ['a', 'b'] }, 'a'), []);
  assert.ok(validate({ type: 'string', enum: ['a', 'b'] }, 'c')[0].includes('one of'));
  assert.ok(validate({ type: 'string', minLength: 2 }, 'x')[0].includes('minLength'));
  assert.ok(validate({ type: 'integer', maximum: 5 }, 9)[0].includes('maximum'));
});

test('validateInputs merges defaults then caller, then validates', () => {
  const schema = { type: 'object', properties: { a: { type: 'string' }, b: { type: 'integer' } }, required: ['a', 'b'] };
  const r = validateInputs(schema, { b: 1 }, { a: 'hi' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.args, { b: 1, a: 'hi' });
  const bad = validateInputs(schema, {}, { a: 'hi' }); // b missing
  assert.equal(bad.ok, false);
  assert.ok(bad.error.includes('b'));
});

test('validateOutputs requires an object, then validates', () => {
  const schema = { type: 'object', properties: { ok: { type: 'boolean' } } };
  assert.equal(validateOutputs(schema, { ok: true }).ok, true);
  assert.equal(validateOutputs(schema, 'nope').ok, false);
  assert.equal(validateOutputs(schema, null).ok, false);
  assert.ok(validateOutputs(schema, { ok: 'x' }).error.includes('boolean'));
});

test('array: items validated with indexed path', () => {
  const schema = { type: 'array', items: { type: 'integer' } };
  assert.deepEqual(validate(schema, [1, 2, 3]), []);
  const errs = validate(schema, [1, 'two', 3]);
  assert.equal(errs.length, 1);
  assert.ok(errs[0].includes('[1]'));          // indexed path
  assert.ok(errs[0].includes('integer'));
  assert.ok(validate(schema, 'not-array')[0].includes('array'));
});

test('nested object: recursion builds dotted path + nested required', () => {
  const schema = { type: 'object', properties: { user: { type: 'object', properties: { age: { type: 'integer' } }, required: ['id'] } } };
  assert.deepEqual(validate(schema, { user: { id: 'x', age: 30 } }), []);
  const missing = validate(schema, { user: { age: 30 } });          // user.id missing
  assert.ok(missing.some((e) => e.includes('$.user.id')));
  const badType = validate(schema, { user: { id: 'x', age: 'old' } });
  assert.ok(badType.some((e) => e.includes('$.user.age') && e.includes('integer')));
});
