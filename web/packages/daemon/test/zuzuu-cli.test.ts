// The zuzuu spawn layer (zuzuu-cli.ts): runZuzuu (reads → null on failure)
// and runZuzuuMut (absent vs failed distinguished), via stub binaries.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, chmodSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { runZuzuu, runZuzuuMut } from "../src/zuzuu-cli.js";
import { jsonStub, failStub } from "./zuzuu-fixtures.js";

let root: string;
beforeEach(() => { root = realpathSync(mkdtempSync(path.join(tmpdir(), "zw-"))); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("runZuzuu", () => {
  it("returns null when the binary is absent", async () => {
    const out = await runZuzuu(root, ["status"], { binary: "definitely-not-a-real-binary-zzz" });
    expect(out).toBeNull();
  });
  it("parses JSON stdout from a stub binary", async () => {
    const stub = jsonStub(root, '{"ok":true}');
    const out = await runZuzuu(root, ["status"], { binary: stub });
    expect(out).toEqual({ ok: true });
  });
});

describe("runZuzuuMut", () => {
  it("absent binary → {ok:false, code:'absent'}", async () => {
    const r = await runZuzuuMut(root, ["proposals", "approve", "p1"], { binary: "definitely-not-a-real-binary-zzz" });
    expect(r).toEqual({ ok: false, code: "absent" });
  });
  it("stub success → {ok:true, data} with parsed stdout JSON", async () => {
    const stub = jsonStub(root, '{"ok":true,"action":"approve","itemIds":["k2"],"warnings":[]}');
    const r = await runZuzuuMut(root, ["proposals", "approve", "p1"], { binary: stub });
    expect(r).toEqual({ ok: true, data: { ok: true, action: "approve", itemIds: ["k2"], warnings: [] } });
  });
  it("non-zero exit → {ok:false, code:'failed'} with stderr tail", async () => {
    const stub = failStub(root, "no such proposal: p9");
    const r = await runZuzuuMut(root, ["proposals", "approve", "p9"], { binary: stub });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("failed");
      expect(r.stderr).toMatch(/no such proposal: p9/);
    }
  });
  it("unparseable stdout on exit 0 → 'failed'", async () => {
    const stub = jsonStub(root, "not json at all");
    const r = await runZuzuuMut(root, ["checkpoint", "mint"], { binary: stub });
    expect(r).toMatchObject({ ok: false, code: "failed" });
  });
  it("non-ENOENT spawn error (EACCES) → {ok:false, code:'failed'} not 'absent'", async () => {
    // Skip on Windows: chmod is a no-op there and EACCES isn't raised the same way.
    if (process.platform === "win32") return;
    const notExec = path.join(root, "not-executable");
    writeFileSync(notExec, "#!/bin/sh\necho '{}'\n");
    chmodSync(notExec, 0o644); // readable but not executable → EACCES on spawn
    const r = await runZuzuuMut(root, ["any"], { binary: notExec });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("failed");
      expect(r.stderr).toBeTruthy();
    }
  });
});
