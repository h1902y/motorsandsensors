import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import type { SearchFileResult, SearchMatch, SearchResponse } from "@webcode/protocol";
import { toRel } from "./safe-path.js";

const execFileAsync = promisify(execFile);

const MAX_MATCHES = 500;
const MAX_LINE_LEN = 500;

let rgAvailable: boolean | null = null;

async function hasRg(): Promise<boolean> {
  if (rgAvailable === null) {
    rgAvailable = await execFileAsync("rg", ["--version"], { timeout: 2000 })
      .then(() => true)
      .catch(() => false);
  }
  return rgAvailable;
}

export interface SearchOptions {
  query: string;
  /** absolute, already validated via resolveSafe */
  searchRoot: string;
  /** workspace root for relativizing result paths */
  root: string;
  regex: boolean;
  caseSensitive: boolean;
}

export async function search(opts: SearchOptions): Promise<SearchResponse> {
  return (await hasRg()) ? rgSearch(opts) : grepSearch(opts);
}

/** Run a process, collecting stdout until the match cap is hit, then kill. */
function collectLines(
  cmd: string,
  args: string[],
  cwd: string,
  onLine: (line: string) => boolean, // return false to stop early
): Promise<{ truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "ignore"] });
    let buf = "";
    let truncated = false;
    let settled = false;
    const finish = () => {
      if (!settled) {
        settled = true;
        resolve({ truncated });
      }
    };
    proc.stdout.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (line && !onLine(line)) {
          truncated = true;
          proc.kill("SIGTERM");
          finish();
          return;
        }
      }
    });
    proc.on("error", (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
    proc.on("close", () => {
      if (buf.trim() && !settled) onLine(buf.trim());
      finish();
    });
  });
}

async function rgSearch(opts: SearchOptions): Promise<SearchResponse> {
  const args = [
    "--json",
    "--max-filesize",
    "1M",
    "--max-columns",
    String(MAX_LINE_LEN),
    "--max-columns-preview",
  ];
  if (!opts.caseSensitive) args.push("-i");
  if (!opts.regex) args.push("-F");
  args.push("-e", opts.query, "--", ".");

  const byFile = new Map<string, SearchMatch[]>();
  let total = 0;

  const { truncated } = await collectLines("rg", args, opts.searchRoot, (line) => {
    let ev: {
      type: string;
      data?: {
        path?: { text?: string };
        line_number?: number;
        lines?: { text?: string };
        submatches?: { start: number; end: number }[];
      };
    };
    try {
      ev = JSON.parse(line);
    } catch {
      return true;
    }
    if (ev.type !== "match" || !ev.data?.path?.text) return true;
    const abs = path.resolve(opts.searchRoot, ev.data.path.text);
    const rel = toRel(opts.root, abs);
    const text = (ev.data.lines?.text ?? "").replace(/\n$/, "").slice(0, MAX_LINE_LEN);
    const match: SearchMatch = {
      line: ev.data.line_number ?? 0,
      text,
      ranges: (ev.data.submatches ?? [])
        .filter((s) => s.start < MAX_LINE_LEN)
        .map((s) => [s.start, Math.min(s.end, MAX_LINE_LEN)]),
    };
    const list = byFile.get(rel) ?? [];
    list.push(match);
    byFile.set(rel, list);
    total += 1;
    return total < MAX_MATCHES;
  });

  return { results: toResults(byFile), total, truncated, engine: "rg" };
}

async function grepSearch(opts: SearchOptions): Promise<SearchResponse> {
  const args = [
    "-rnI",
    "--exclude-dir=.git",
    "--exclude-dir=node_modules",
    "--exclude-dir=dist",
  ];
  if (!opts.caseSensitive) args.push("-i");
  args.push(opts.regex ? "-E" : "-F", opts.query, ".");

  const byFile = new Map<string, SearchMatch[]>();
  let total = 0;

  const { truncated } = await collectLines("grep", args, opts.searchRoot, (line) => {
    // ./path:line:text  (filenames with ":" are rare; accept the ambiguity)
    const m = /^(.+?):(\d+):(.*)$/.exec(line);
    if (!m) return true;
    const abs = path.resolve(opts.searchRoot, m[1]!);
    const rel = toRel(opts.root, abs);
    const text = m[3]!.slice(0, MAX_LINE_LEN);
    // grep gives no offsets — compute first occurrence for highlighting
    const ranges: [number, number][] = [];
    if (!opts.regex) {
      const haystack = opts.caseSensitive ? text : text.toLowerCase();
      const needle = opts.caseSensitive ? opts.query : opts.query.toLowerCase();
      const idx = haystack.indexOf(needle);
      if (idx >= 0) ranges.push([idx, idx + needle.length]);
    }
    const list = byFile.get(rel) ?? [];
    list.push({ line: Number(m[2]), text, ranges });
    byFile.set(rel, list);
    total += 1;
    return total < MAX_MATCHES;
  }).catch(() => ({ truncated: false })); // grep exits 1 on no matches via error? no — only spawn errors land here

  return { results: toResults(byFile), total, truncated, engine: "grep" };
}

function toResults(byFile: Map<string, SearchMatch[]>): SearchFileResult[] {
  return [...byFile.entries()]
    .map(([p, matches]) => ({ path: p, matches }))
    .sort((a, b) => a.path.localeCompare(b.path));
}
