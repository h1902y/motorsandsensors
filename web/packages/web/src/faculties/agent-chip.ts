// Pure logic for the status-bar agent chip (kept free of React/fetch).

/** The status-bar chip: `⟡ <active generation>` (+ ` · N pending` only when N > 0). */
export function agentChipLabel(activeGeneration: string | null | undefined, pendingCount: number): string {
  const gen = `⟡ ${activeGeneration ?? "no gen"}`;
  return pendingCount > 0 ? `${gen} · ${pendingCount} pending` : gen;
}
