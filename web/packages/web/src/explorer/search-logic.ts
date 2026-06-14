// Pure logic for the Files-panel search state (no React/fetch — unit-testable).

/** trimStart shifts highlight offsets left by the removed whitespace. */
export function shiftRanges(m: { text: string; ranges: [number, number][] }): [number, number][] {
  const cut = m.text.length - m.text.trimStart().length;
  if (cut === 0) return m.ranges;
  return m.ranges
    .map(([s, e]) => [Math.max(0, s - cut), Math.max(0, e - cut)] as [number, number])
    .filter(([s, e]) => e > s);
}

/** Search fires only from 2 trimmed characters (ripgrep noise floor). */
export const MIN_QUERY_LEN = 2;

export const canSearch = (query: string): boolean => query.trim().length >= MIN_QUERY_LEN;

/** A row in the in-tree search filter (matching files + their ancestor dirs). */
export interface FilteredRow {
  path: string;
  name: string;
  depth: number;
  isDir: boolean;
}

/** From the flat list of matching file paths (content-search hits), build a
 *  nested tree of the files PLUS all their ancestor directories, in DFS
 *  pre-order (a plain lexicographic path sort yields valid pre-order). Used to
 *  filter the file tree in place during search — the tree stays visible, just
 *  pruned to matches. Every dir here is implicitly expanded. */
export function buildFilteredRows(matchPaths: string[]): FilteredRow[] {
  const dirs = new Set<string>();
  const files = new Set<string>();
  for (const p of matchPaths) {
    if (!p) continue;
    files.add(p);
    const parts = p.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  return [...new Set([...dirs, ...files])].sort().map((path) => ({
    path,
    name: path.split("/").pop() ?? path,
    depth: path.split("/").length - 1,
    isDir: dirs.has(path),
  }));
}
