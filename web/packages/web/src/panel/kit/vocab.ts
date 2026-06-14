// User-facing vocabulary for the evolution engine. Internal ids (generation,
// checkpoint) are unchanged — this is the PRESENTATION layer only.

/** "gen_006" → "v6", "gen_1" → "v1"; unparseable → the raw id. */
export function versionLabel(genId: string): string {
  const n = /(\d+)/.exec(genId)?.[1];
  return n ? `v${parseInt(n, 10)}` : genId;
}
/** "cp_002" → "Snapshot 2"; unparseable → the raw id. */
export function snapshotLabel(cpId: string): string {
  const n = /(\d+)/.exec(cpId)?.[1];
  return n ? `Snapshot ${parseInt(n, 10)}` : cpId;
}
/** Plain-language definitions for the new nouns — used by InfoDot popovers. */
export const GLOSSARY: Record<string, { term: string; what: string }> = {
  session:  { term: "Session",  what: "One run of your coding agent. zuzuu watches it and proposes what to learn — nothing is saved without your approval." },
  proposal: { term: "Proposal", what: "Something your agent learned in a session, suggested for keeping. Approve it to make it part of a module." },
  version:  { term: "Version",  what: "A saved state of one module. Approving proposals saves a new version; you can roll back to an earlier one." },
  snapshot: { term: "Snapshot", what: "A save-point across all modules at once — your agent's whole state at a moment, for coherent rollback." },
  module:   { term: "Module",   what: "One of your agent's five capabilities (knowledge, memory, actions, instructions, guardrails) that grows from your sessions." },
};
