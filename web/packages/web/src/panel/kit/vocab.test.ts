import { describe, it, expect } from "vitest";
import { versionLabel, snapshotLabel } from "./vocab";

describe("vocab", () => {
  it("versionLabel maps a generation id to a short version label", () => {
    expect(versionLabel("gen_006")).toBe("v6");
    expect(versionLabel("gen_1")).toBe("v1");
    expect(versionLabel("weird")).toBe("weird");
  });
  it("snapshotLabel maps a checkpoint id to a snapshot label", () => {
    expect(snapshotLabel("cp_002")).toBe("Snapshot 2");
    expect(snapshotLabel("x")).toBe("x");
  });
});
