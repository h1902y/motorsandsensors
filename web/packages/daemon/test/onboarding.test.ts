import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { nextRecent } from "../src/config.js";
import { listDirs, mkdirIn } from "../src/browse.js";

describe("nextRecent", () => {
  it("prepends, dedups, and caps at 10", () => {
    expect(nextRecent(["/a", "/b"], "/c")).toEqual(["/c", "/a", "/b"]);
    expect(nextRecent(["/a", "/b"], "/a")).toEqual(["/a", "/b"]); // moved to front, no dup
    const many = Array.from({ length: 12 }, (_, i) => `/p${i}`);
    expect(nextRecent(many, "/new")).toHaveLength(10);
    expect(nextRecent(many, "/new")[0]).toBe("/new");
  });
});

describe("browse.listDirs", () => {
  it("lists subdirectories only (no files), hides dotfiles", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "webcode-browse-"));
    await mkdirIn(dir, "alpha");
    await mkdirIn(dir, "beta");
    await writeFile(path.join(dir, "afile.txt"), "x");
    await mkdirIn(dir, ".hidden");

    const res = await listDirs(dir);
    expect(res.path).toBe(dir);
    expect(res.parent).toBe(path.dirname(dir));
    const names = res.dirs.map((d) => d.name);
    expect(names).toContain("alpha");
    expect(names).toContain("beta");
    expect(names).not.toContain("afile.txt"); // files excluded
    expect(names).not.toContain(".hidden"); // dotfiles excluded
    expect(res.dirs.every((d) => path.isAbsolute(d.path))).toBe(true);

    await rm(dir, { recursive: true, force: true });
  });

  it("defaults to home for a missing/relative path", async () => {
    const res = await listDirs(undefined);
    expect(res.path).toBe(os.homedir());
  });

  it("mkdirIn rejects unsafe names", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "webcode-mkdir-"));
    await expect(mkdirIn(dir, "../escape")).rejects.toThrow();
    await expect(mkdirIn(dir, "")).rejects.toThrow();
    await expect(mkdirIn("relative", "x")).rejects.toThrow();
    await rm(dir, { recursive: true, force: true });
  });
});
