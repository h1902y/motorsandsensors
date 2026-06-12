// Pure logic for the panel-v3 sections (React-free, unit-tested):
// §1 needs-you grouping, §2 session splitting + state labelling and the
// graduated-from-session provenance filter, plus duration formatting.
import type { FacultyItem, FacultyOverviewEntry, ZuzuuSessionEntry } from "@zuzuu-web/protocol";

// ── §1 Needs you ──────────────────────────────────────────────────────

export interface NeedsYouGroup {
  id: string;
  title: string;
  pending: number;
}

/** Per-faculty pending groups ("Knowledge · 3 to review"), faculties with
 *  nothing pending omitted — an empty result means "all caught up". */
export function needsYouGroups(faculties: FacultyOverviewEntry[]): NeedsYouGroup[] {
  return faculties
    .filter((f) => f.counts.pending > 0)
    .map((f) => ({ id: f.id, title: f.title, pending: f.counts.pending }));
}

/** Total pending across all faculties — the Review CTA's count. */
export const pendingTotal = (faculties: FacultyOverviewEntry[]): number =>
  faculties.reduce((n, f) => n + f.counts.pending, 0);

// ── §2 Sessions ───────────────────────────────────────────────────────

/** The ACTIVE session pins to the top (the Session brief renders under it);
 *  everything else lists in given order (the CLI emits newest-first). */
export function splitSessions(sessions: ZuzuuSessionEntry[]): {
  active: ZuzuuSessionEntry | null;
  rest: ZuzuuSessionEntry[];
} {
  const active = sessions.find((s) => s.state === "active") ?? null;
  return { active, rest: sessions.filter((s) => s !== active) };
}

export interface SessionStateMeta {
  label: string;
  tone: "ok" | "warn" | "danger" | "idle";
  /** true only for the live session's dot */
  pulse: boolean;
}

/** State label + tone for a session row. Unknown/absent states (file-read
 *  fallback without the CLI) degrade to a neutral dash. */
export function sessionStateMeta(state: string | undefined): SessionStateMeta {
  switch (state) {
    case "active": return { label: "active", tone: "ok", pulse: true };
    case "opening": return { label: "opening", tone: "idle", pulse: true };
    case "completed": return { label: "completed", tone: "ok", pulse: false };
    case "abandoned": return { label: "abandoned", tone: "warn", pulse: false };
    case "crashed": return { label: "crashed", tone: "danger", pulse: false };
    case "captured": return { label: "captured", tone: "idle", pulse: false };
    default: return { label: state ?? "—", tone: "idle", pulse: false };
  }
}

/** Items whose provenance cites this session — "graduated from this session".
 *  (Filtered client-side; provenance rides only on full envelope items.) */
export function graduatedFromSession(items: FacultyItem[], sessionId: string): FacultyItem[] {
  if (!sessionId) return [];
  return items.filter((it) =>
    (it.provenance ?? []).some((p) => p.session === sessionId));
}

/** "12s" · "5.5m" · "2h 4m" — session durations. */
export function fmtDuration(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

/** A session's compact display id (full ids are hashes/uuids). */
export const shortSessionId = (id: string): string => id.slice(0, 8);
