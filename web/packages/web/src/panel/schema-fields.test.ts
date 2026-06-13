import { describe, it, expect } from "vitest";
import { schemaFields } from "./schema-fields";

describe("schemaFields", () => {
  it("flattens knowledge's payload schema (type required, attributes/relations)", () => {
    const schema = {
      type: "object",
      required: ["type"],
      properties: {
        type: { type: "string", pattern: "^[a-z0-9][a-z0-9-]*$" },
        attributes: { type: "object" },
        relations: { type: "array", items: { type: "object" } },
      },
    };
    const fields = schemaFields(schema);
    expect(fields.map((f) => f.name)).toEqual(["type", "attributes", "relations"]);
    const type = fields.find((f) => f.name === "type")!;
    expect(type.required).toBe(true);
    expect(type.constraint).toMatch(/pattern/);
    expect(fields.find((f) => f.name === "relations")!.type).toBe("array<object>");
  });

  it("surfaces enum values and puts required fields first", () => {
    const schema = {
      type: "object",
      required: ["action", "pattern", "reason"],
      properties: {
        action: { type: "string", enum: ["deny", "ask", "allow"] },
        tool: { type: "string" },
        pattern: { type: "string", minLength: 1 },
        reason: { type: "string", minLength: 1 },
      },
    };
    const fields = schemaFields(schema);
    // required ones (action/pattern/reason) sort before the optional (tool)
    expect(fields[fields.length - 1]!.name).toBe("tool");
    const action = fields.find((f) => f.name === "action")!;
    expect(action.type).toBe("string (enum)");
    expect(action.enumValues).toEqual(["deny", "ask", "allow"]);
    expect(fields.find((f) => f.name === "pattern")!.constraint).toMatch(/min length 1/);
  });

  it("returns [] for shapes without properties (the escape hatch covers it)", () => {
    expect(schemaFields(null)).toEqual([]);
    expect(schemaFields({})).toEqual([]);
    expect(schemaFields({ type: "string" })).toEqual([]);
    expect(schemaFields("not an object")).toEqual([]);
  });
});
