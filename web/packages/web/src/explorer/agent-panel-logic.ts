// Pure logic for the agent sidebar panel + the status-bar agent chip.
// Kept free of React/fetch so the formats are unit-testable.

/** First `max` lines of the digest for the sidebar peek box. */
export function digestPeek(text: string, max = 20): { text: string; truncated: boolean } {
  const lines = text.split("\n");
  if (lines.length <= max) return { text, truncated: false };
  return { text: lines.slice(0, max).join("\n"), truncated: true };
}

/** The status-bar chip: `⟡ <active generation>` (+ ` · N pending` only when N > 0). */
export function agentChipLabel(activeGeneration: string | null | undefined, pendingCount: number): string {
  const gen = `⟡ ${activeGeneration ?? "no gen"}`;
  return pendingCount > 0 ? `${gen} · ${pendingCount} pending` : gen;
}

export interface FacultyLink {
  label: string;
  /** workspace-relative path the editor opens */
  path: string;
}

export interface FacultyLinkRow {
  faculty: string;
  /** the faculty's README — the row's main link */
  readme: FacultyLink;
  /** secondary links (e.g. the pinned project.md under instructions) */
  extras: FacultyLink[];
}

/** The 5 faculty quick-links — each faculty's README, plus the pinned
 *  steering file under instructions (where `zuzuu init` scaffolds it). */
export function facultyQuickLinks(): FacultyLinkRow[] {
  const faculties = ["knowledge", "memory", "actions", "instructions", "guardrails"] as const;
  return faculties.map((faculty) => ({
    faculty,
    readme: { label: "README", path: `.zuzuu/${faculty}/README.md` },
    extras:
      faculty === "instructions"
        ? [{ label: "project.md", path: ".zuzuu/instructions/project.md" }]
        : [],
  }));
}
