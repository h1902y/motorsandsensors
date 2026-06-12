// Pure path derivation over the zuzuu home (`.zuzuu/` — the same dir the
// daemon's zuzuu-api resolves), following the Faculty Standard: envelope
// items are one .md per item. Kept React-free so the derivations are
// unit-testable.
import type { FacultyKey } from "@zuzuu-web/protocol";

export const ZUZUU_HOME = ".zuzuu";
/** the session-start grounding brief — written FOR reading, unlike the rest of .live */
export const DIGEST_PATH = `${ZUZUU_HOME}/.live/digest.md`;

export const facultyDir = (key: FacultyKey): string => `${ZUZUU_HOME}/${key}`;
export const facultyReadmePath = (key: FacultyKey): string => `${facultyDir(key)}/README.md`;
/** the faculty's payload schema (seeded by `zuzuu init`, human-extendable) */
export const facultySchemaPath = (key: FacultyKey): string => `${facultyDir(key)}/schema.json`;

/** Where a faculty's flat envelope items live. Actions are dir-shaped
 *  (actions/<slug>/ACTION.md — scripts stay siblings) → null here. */
export function facultyItemsDir(key: FacultyKey): string | null {
  if (key === "actions") return null;
  if (key === "memory") return `${ZUZUU_HOME}/memory/entries`;
  return `${facultyDir(key)}/items`;
}

/** An envelope item's file: `<items dir>/<id>.md` — for actions, the
 *  runbook dir's `ACTION.md`. */
export function facultyItemPath(key: FacultyKey, id: string): string {
  if (key === "actions") return `${ZUZUU_HOME}/actions/${id}/ACTION.md`;
  return `${facultyItemsDir(key)}/${id}.md`;
}
