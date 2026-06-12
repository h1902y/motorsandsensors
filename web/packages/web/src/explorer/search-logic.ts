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
