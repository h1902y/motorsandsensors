import { describe, expect, it } from "vitest";

// quick-fix matchers live in the web package; re-implement-free import would
// couple packages, so test the daemon-side parsers here and the matchers in web.
import { shellHistory } from "../src/history.js";

describe("shellHistory", () => {
  it("is callable and returns an array", async () => {
    const out = await shellHistory();
    expect(Array.isArray(out)).toBe(true);
  });
});

// git porcelain parsing is exercised via a real temp repo
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { status } from "../src/git.js";

const run = promisify(execFile);

describe("git status parser", () => {
  it("returns repo=false outside a repo", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "webcode-nogit-"));
    const s = await status(dir);
    expect(s.repo).toBe(false);
    await rm(dir, { recursive: true, force: true });
  });

  it("parses modified + untracked entries", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "webcode-git-"));
    await run("git", ["init", "-q"], { cwd: dir });
    await run("git", ["config", "user.email", "t@t.t"], { cwd: dir });
    await run("git", ["config", "user.name", "t"], { cwd: dir });
    await writeFile(path.join(dir, "tracked.txt"), "v1\n");
    await run("git", ["add", "tracked.txt"], { cwd: dir });
    await run("git", ["commit", "-qm", "init"], { cwd: dir });
    await writeFile(path.join(dir, "tracked.txt"), "v2\n"); // modify
    await writeFile(path.join(dir, "new.txt"), "x\n"); // untracked

    const s = await status(dir);
    expect(s.repo).toBe(true);
    const tracked = s.entries.find((e) => e.path === "tracked.txt");
    const fresh = s.entries.find((e) => e.path === "new.txt");
    expect(tracked?.worktree).toBe("M");
    expect(fresh?.index).toBe("?");
    expect(fresh?.worktree).toBe("?");

    await rm(dir, { recursive: true, force: true });
  });
});
