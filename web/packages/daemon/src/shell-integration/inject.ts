import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function readScript(name: string): string {
  // scripts sit beside this module in src; tsc copies them to dist via the
  // build step (see package.json), so resolve relative to the compiled file.
  return fs.readFileSync(path.join(HERE, name), "utf8");
}

export interface Injection {
  /** argv for pty.spawn (shell-specific) */
  args: string[];
  /** env overlay merged onto process.env */
  env: Record<string, string>;
  /** temp dir to remove when the session dies, if any */
  tempDir?: string;
}

/**
 * Build the spawn args + env that load webcode's OSC 133 / OSC 7 shell
 * integration after the user's own rc. Returns null for shells we don't
 * integrate (caller spawns as before and falls back to cwd polling).
 *
 * Mirrors VS Code's approach: a temp ZDOTDIR for zsh, --rcfile for bash,
 * a vendor conf.d for fish.
 */
export function buildInjection(shell: string): Injection | null {
  const base = path.basename(shell);

  if (base === "zsh") {
    const dir = mkTemp();
    const prevZdotdir = process.env.ZDOTDIR ?? os.homedir();
    // Each entry point sources the user's original, and .zshrc then adds us.
    const sourcePrev = (file: string) =>
      `[ -f "${prevZdotdir}/${file}" ] && WEBCODE_IN_INIT=1 . "${prevZdotdir}/${file}"\n`;
    write(dir, ".zshenv", sourcePrev(".zshenv"));
    write(dir, ".zprofile", sourcePrev(".zprofile"));
    write(dir, ".zlogin", sourcePrev(".zlogin"));
    write(
      dir,
      ".zshrc",
      sourcePrev(".zshrc") + readScript("webcode.zsh"),
    );
    return {
      args: ["-l"],
      env: { ZDOTDIR: dir, WEBCODE_ZDOTDIR_PREV: prevZdotdir },
      tempDir: dir,
    };
  }

  if (base === "bash") {
    const dir = mkTemp();
    const rc = path.join(dir, "rc.bash");
    fs.writeFileSync(
      rc,
      `[ -f ~/.bashrc ] && . ~/.bashrc\n` + readScript("webcode.bash"),
      "utf8",
    );
    // interactive (not login) so --rcfile is honored; the rc sources ~/.bashrc
    return { args: ["--rcfile", rc, "-i"], env: {}, tempDir: dir };
  }

  if (base === "fish") {
    const dir = mkTemp();
    const confDir = path.join(dir, "fish", "vendor_conf.d");
    fs.mkdirSync(confDir, { recursive: true });
    fs.writeFileSync(path.join(confDir, "webcode.fish"), readScript("webcode.fish"), "utf8");
    // fish reads conf.d from each XDG_DATA_DIRS/fish entry
    const prev = process.env.XDG_DATA_DIRS ?? "/usr/local/share:/usr/share";
    return {
      args: ["-l"],
      env: { XDG_DATA_DIRS: `${dir}:${prev}` },
      tempDir: dir,
    };
  }

  return null;
}

function mkTemp(): string {
  const dir = path.join(os.tmpdir(), `webcode-si-${crypto.randomBytes(6).toString("hex")}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function write(dir: string, file: string, content: string): void {
  fs.writeFileSync(path.join(dir, file), content, "utf8");
}

export function cleanupInjection(tempDir: string | undefined): void {
  if (tempDir) fs.rm(tempDir, { recursive: true, force: true }, () => {});
}
