// Pure: flatten a module's payload JSON-Schema (a small subset) into a readable
// field list — name, type, required, enum — for the rendered schema view.
// React-free so the parsing is unit-testable. Best-effort: a shape it doesn't
// recognize yields [] (the caller keeps the raw-file escape hatch).

export interface SchemaField {
  name: string;
  /** display type: "string", "array<object>", "object", "string (enum)", … */
  type: string;
  required: boolean;
  /** allowed values when the field is an enum */
  enumValues?: string[];
  /** a constraint hint (pattern / minLength / etc.), when present */
  constraint?: string;
}

interface JsonSchema {
  type?: string | string[];
  required?: string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  enum?: unknown[];
  pattern?: string;
  minLength?: number;
  maxLength?: number;
}

function typeLabel(s: JsonSchema): string {
  const base = Array.isArray(s.type) ? s.type.join("|") : s.type ?? "any";
  if (base === "array" && s.items?.type) {
    return `array<${Array.isArray(s.items.type) ? s.items.type.join("|") : s.items.type}>`;
  }
  return base;
}

function constraintOf(s: JsonSchema): string | undefined {
  const parts: string[] = [];
  if (typeof s.pattern === "string") parts.push(`pattern ${s.pattern}`);
  if (typeof s.minLength === "number") parts.push(`min length ${s.minLength}`);
  if (typeof s.maxLength === "number") parts.push(`max length ${s.maxLength}`);
  return parts.length ? parts.join(" · ") : undefined;
}

/**
 * Flatten the top-level `properties` of a payload schema into display fields.
 * Only the top level — nested object/array item shapes are summarized by their
 * type label, not exploded (keeps the view scannable; the file escape hatch
 * shows the full nesting). Returns [] for anything without `properties`.
 */
export function schemaFields(schema: unknown): SchemaField[] {
  if (!schema || typeof schema !== "object") return [];
  const s = schema as JsonSchema;
  if (!s.properties || typeof s.properties !== "object") return [];
  const required = new Set(Array.isArray(s.required) ? s.required : []);
  const fields: SchemaField[] = [];
  for (const [name, raw] of Object.entries(s.properties)) {
    if (!raw || typeof raw !== "object") continue;
    const enumValues = Array.isArray(raw.enum) ? raw.enum.map(String) : undefined;
    fields.push({
      name,
      type: enumValues ? "string (enum)" : typeLabel(raw),
      required: required.has(name),
      ...(enumValues ? { enumValues } : {}),
      ...(constraintOf(raw) ? { constraint: constraintOf(raw) } : {}),
    });
  }
  // required fields first (the ones the agent must supply), then the rest
  fields.sort((a, b) => Number(b.required) - Number(a.required));
  return fields;
}
