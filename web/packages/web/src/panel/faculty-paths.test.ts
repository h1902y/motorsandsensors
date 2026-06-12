// Pure tests for the right panel's path derivation (the Faculty Standard:
// one envelope .md per item; actions are dir-shaped ACTION.md).
import { describe, expect, it } from "vitest";
import {
  facultyDir, facultyItemPath, facultyItemsDir, facultyReadmePath, facultySchemaPath,
} from "./faculty-paths";

describe("faculty path derivation (envelope items)", () => {
  it("derives the flat item dirs: items/ everywhere, memory uses entries/", () => {
    expect(facultyItemsDir("knowledge")).toBe(".zuzuu/knowledge/items");
    expect(facultyItemsDir("memory")).toBe(".zuzuu/memory/entries");
    expect(facultyItemsDir("instructions")).toBe(".zuzuu/instructions/items");
    expect(facultyItemsDir("guardrails")).toBe(".zuzuu/guardrails/items");
  });

  it("actions are dir-shaped (scripts stay siblings) — no flat items dir", () => {
    expect(facultyItemsDir("actions")).toBeNull();
  });

  it("derives an item's envelope file from its id", () => {
    expect(facultyItemPath("knowledge", "file-commands-hook-mjs"))
      .toBe(".zuzuu/knowledge/items/file-commands-hook-mjs.md");
    expect(facultyItemPath("memory", "20260612-session"))
      .toBe(".zuzuu/memory/entries/20260612-session.md");
    expect(facultyItemPath("guardrails", "no-root-wipe"))
      .toBe(".zuzuu/guardrails/items/no-root-wipe.md");
    expect(facultyItemPath("instructions", "steering"))
      .toBe(".zuzuu/instructions/items/steering.md");
  });

  it("derives an action's ACTION.md from its slug", () => {
    expect(facultyItemPath("actions", "run-tests")).toBe(".zuzuu/actions/run-tests/ACTION.md");
  });

  it("derives faculty dir, README and seeded schema", () => {
    expect(facultyDir("memory")).toBe(".zuzuu/memory");
    expect(facultyReadmePath("actions")).toBe(".zuzuu/actions/README.md");
    expect(facultySchemaPath("guardrails")).toBe(".zuzuu/guardrails/schema.json");
  });
});
