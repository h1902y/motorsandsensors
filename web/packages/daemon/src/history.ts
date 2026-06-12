import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const MAX = 500;

/**
 * Read the user's shell history (zsh extended `: <ts>:<dur>;<cmd>` or plain),
 * deduped, most-recent-first. Best-effort — returns [] if no file is found.
 */
export async function shellHistory(): Promise<string[]> {
  const home = os.homedir();
  const candidates = [
    process.env.HISTFILE,
    path.join(home, ".zsh_history"),
    path.join(home, ".bash_history"),
  ].filter(Boolean) as string[];

  for (const file of candidates) {
    let raw: string;
    try {
      raw = await fsp.readFile(file, "utf8");
    } catch {
      continue;
    }
    const cmds: string[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      // zsh extended: ": 1700000000:0;the command"
      const m = /^: \d+:\d+;(.*)$/.exec(line);
      cmds.push(m ? m[1]! : line);
    }
    // most-recent-first, dedup keeping first occurrence
    const seen = new Set<string>();
    const out: string[] = [];
    for (let i = cmds.length - 1; i >= 0 && out.length < MAX; i--) {
      const c = cmds[i]!.trim();
      if (c && !seen.has(c)) {
        seen.add(c);
        out.push(c);
      }
    }
    return out;
  }
  return [];
}
