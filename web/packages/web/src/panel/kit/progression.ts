// Pure progression-framing helpers (React-free, unit-tested). Versioning is
// rendered as levels, never a git log: this turns counts into "N more → Gen X".
export function nextGenRemaining(approved: number, threshold: number): number {
  return Math.max(0, threshold - approved);
}

// `unit` must be a regular plural noun (e.g. "approved proposals", "clean sessions"); singularization just drops a trailing "s".
export function genLadderLabel(remaining: number, unit: string, nextGen: number): string {
  if (remaining <= 0) return `Ready to mint Gen ${nextGen}`;
  const noun = remaining === 1 && unit.endsWith("s") ? unit.slice(0, -1) : unit;
  return `${remaining} more ${noun} → Gen ${nextGen}`;
}
