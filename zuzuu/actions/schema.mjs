// zuzuu/actions/schema.mjs
// A hand-rolled JSON-Schema *subset* validator — zero-dep (no Ajv), matching the
// project's node-builtins-only policy. Supports: object (properties, required),
// array (items), string/number/integer/boolean scalars, enum, pattern, and basic
// length/range constraints. Returns an array of error strings ([] = valid). No
// coercion: values are expected to already carry real JSON types. Shared by the
// actions runner AND the faculty envelope (payload validation — W24).

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

  if (schema.enum && errors.length === 0 && !schema.enum.includes(value)) errors.push(`${path}: must be one of ${schema.enum.join(', ')}`);
  if (typeof value === 'string') {
    if (schema.minLength != null && value.length < schema.minLength) errors.push(`${path}: shorter than minLength ${schema.minLength}`);
    if (schema.maxLength != null && value.length > schema.maxLength) errors.push(`${path}: longer than maxLength ${schema.maxLength}`);
    if (schema.pattern != null) {
      try {
        if (!new RegExp(schema.pattern).test(value)) errors.push(`${path}: does not match pattern ${schema.pattern}`);
      } catch { /* an unparseable authored pattern never blocks (fail-open) */ }
    }
  }
  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) errors.push(`${path}: below minimum ${schema.minimum}`);
    if (schema.maximum != null && value > schema.maximum) errors.push(`${path}: above maximum ${schema.maximum}`);
  }

  return errors;
}

/**
 * Validate caller inputs against the manifest `inputs` schema.
 * Merges default_args then caller args (caller wins).
 * @returns {{ok:true,args:object} | {ok:false,error:string,errors:string[]}}
 */
export function validateInputs(schema, defaults = {}, caller = {}) {
  const args = { ...(defaults ?? {}), ...(caller ?? {}) };
  const errors = validate(schema ?? { type: 'object' }, args);
  return errors.length ? { ok: false, error: errors[0], errors } : { ok: true, args };
}

/**
 * Validate an action's return value against the manifest `outputs` schema.
 * Enforces the main(args) → object contract first.
 * @returns {{ok:true,value:object} | {ok:false,error:string,errors?:string[]}}
 */
export function validateOutputs(schema, value) {
  if (!isPlainObject(value)) return { ok: false, error: 'action output must be a JSON object' };
  const errors = validate(schema ?? { type: 'object' }, value);
  return errors.length ? { ok: false, error: errors[0], errors } : { ok: true, value };
}
