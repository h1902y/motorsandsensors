import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PathError, resolveSafe, safeJoin, toRel } from "../src/safe-path.js";

let root: string;
let outside: string;

beforeAll(async () => {
  root = await realpath(await mkdtemp(path.join(os.tmpdir(), "webcode-root-")));
  outside = await realpath(await mkdtemp(path.join(os.tmpdir(), "webcode-outside-")));
  await mkdir(path.join(root, "src", "deep"), { recursive: true });
  await writeFile(path.join(root, "src", "a.txt"), "a");
  await writeFile(path.join(outside, "secret.txt"), "secret");
  await symlink(outside, path.join(root, "link-out"));
  await symlink(path.join(outside, "secret.txt"), path.join(root, "file-out"));
  await symlink(path.join(root, "src"), path.join(root, "link-in"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe("safeJoin", () => {
  it("resolves workspace-relative paths", () => {
    expect(safeJoin("/ws", "src/a.txt")).toBe("/ws/src/a.txt");
    expect(safeJoin("/ws", "/src/a.txt")).toBe("/ws/src/a.txt");
    expect(safeJoin("/ws", "")).toBe("/ws");
    expect(safeJoin("/ws", ".")).toBe("/ws");
  });

  it("rejects .. traversal", () => {
    expect(() => safeJoin("/ws", "../etc/passwd")).toThrow(PathError);
    expect(() => safeJoin("/ws", "src/../../etc")).toThrow(PathError);
    expect(() => safeJoin("/ws", "..")).toThrow(PathError);
  });

  it("does not treat sibling prefixes as inside", () => {
    expect(() => safeJoin("/ws", "../ws-evil/x")).toThrow(PathError);
  });

  it("rejects NUL bytes", () => {
    expect(() => safeJoin("/ws", "a\0b")).toThrow(PathError);
  });

  it("normalizes .. within bounds", () => {
    expect(safeJoin("/ws", "src/deep/../a.txt")).toBe("/ws/src/a.txt");
  });
});

describe("resolveSafe", () => {
  it("accepts real paths inside the root", async () => {
    await expect(resolveSafe(root, "src/a.txt")).resolves.toBe(path.join(root, "src", "a.txt"));
  });

  it("accepts not-yet-existing paths under existing dirs", async () => {
    await expect(resolveSafe(root, "src/deep/new-file.txt")).resolves.toBe(
      path.join(root, "src", "deep", "new-file.txt"),
    );
  });

  it("rejects a symlinked dir pointing outside", async () => {
    await expect(resolveSafe(root, "link-out")).rejects.toThrow(PathError);
    await expect(resolveSafe(root, "link-out/secret.txt")).rejects.toThrow(PathError);
  });

  it("rejects a symlinked file pointing outside", async () => {
    await expect(resolveSafe(root, "file-out")).rejects.toThrow(PathError);
  });

  it("rejects creating files under an out-pointing symlink", async () => {
    await expect(resolveSafe(root, "link-out/new.txt")).rejects.toThrow(PathError);
  });

  it("accepts symlinks that stay inside the root", async () => {
    await expect(resolveSafe(root, "link-in/a.txt")).resolves.toBe(
      path.join(root, "link-in", "a.txt"),
    );
  });

  it("rejects lexical escapes before touching the fs", async () => {
    await expect(resolveSafe(root, "../x")).rejects.toThrow(PathError);
  });
});

describe("toRel", () => {
  it("returns forward-slash relative paths", () => {
    expect(toRel("/ws", "/ws/src/a.txt")).toBe("src/a.txt");
    expect(toRel("/ws", "/ws")).toBe("");
  });
});
