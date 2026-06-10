// mns/actions/schema.mjs
// A hand-rolled JSON-Schema *subset* validator — zero-dep (no Ajv), matching the
// project's node-builtins-only policy. Supports: object (properties, required),
// array (items), string/number/integer/boolean scalars, enum, and basic length/
// range constraints. Returns an array of error strings ([] = valid). No coercion:
// values are expected to already carry real JSON types.

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** @returns {string[]} error messages; empty array = valid */
export function validate(schema, value, path = '$') {
  const errors = [];
  if (!schema || typeof schema !== 'object') return errors; // no schema → accept
  const type = schema.type;

  if (type === 'object') {
    if (!isPlainObject(value)) return [`${path}: expected object`];
    for (const req of schema.required ?? []) {
      if (!(req in value)) errors.push(`${path}.${req}: required`);
    }
    for (const [k, sub] of Object.entries(schema.properties ?? {})) {
      if (k in value) errors.push(...validate(sub, value[k], `${path}.${k}`));
    }
    return errors;
  }

  if (type === 'array') {
    if (!Array.isArray(value)) return [`${path}: expected array`];
    if (schema.items) value.forEach((v, i) => errors.push(...validate(schema.items, v, `${path}[${i}]`)));
    return errors;
  }

  if (type === 'string' && typeof value !== 'string') errors.push(`${path}: expected string`);
  else if (type === 'number' && (typeof value !== 'number' || Number.isNaN(value))) errors.push(`${path}: expected number`);
  else if (type === 'integer' && !Number.isInteger(value)) errors.push(`${path}: expected integer`);
  else if (type === 'boolean' && typeof value !== 'boolean') errors.push(`${path}: expected boolean`);

  return errors;
}
