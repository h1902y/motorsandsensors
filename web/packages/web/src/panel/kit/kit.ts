// Pure logic for the faculty panel kit (React-free, unit-tested):
// card status mapping, the kind→icon map (universal over every envelope
// kind), faculty display metadata (manifest ui descriptors first, built-in
// FACULTY_META as the fallback), and relative-time formatting.
import type { FacultyItem, FacultyKey, FacultyOverviewEntry } from "@zuzuu-web/protocol";

// ── card status ───────────────────────────────────────────────────────

export type CardStatus = "ok" | "pending" | "empty";

/** FacultyCard's 3px top bar: pending (amber) wins; items alone = ok
 *  (green); nothing = empty (gray). */
export function cardStatus(count: number, pending: number): CardStatus {
  if (pending > 0) return "pending";
  if (count > 0) return "ok";
  return "empty";
}

// ── kind → icon (16×16 stroke paths, the IconButton convention) ──────

/** Every envelope kind across the five faculties (knowledge is an open,
 *  registry-governed set — these are its seeds; unknown kinds fall back). */
export const ALL_ENVELOPE_KINDS = [
  "fact", "entity", "command", "decision", // knowledge (open set, seeded)
  "episode",                               // memory
  "runbook", "script",                     // actions
  "steering", "amendment",                 // instructions
  "rule",                                  // guardrails
] as const;

export const KIND_ICONS: Record<string, string> = {
  fact: "M8 2.5a5.5 5.5 0 110 11 5.5 5.5 0 010-11M8 5.5v.5M8 8v3", // info dot
  entity: "M8 2l5 2.5v7L8 14l-5-2.5v-7L8 2M3 4.5L8 7l5-2.5M8 7v7", // cube
  command: "M3 4l3.5 4L3 12M8.5 12H13", // terminal prompt
  decision: "M4 13.5V8a4 4 0 014-4h4.5M10 1.5L13 4l-3 2.5", // fork/branch
  episode: "M8 2.5a5.5 5.5 0 110 11 5.5 5.5 0 010-11M8 5v3.2l2.2 1.6", // clock
  runbook: "M4 2.5h8.5v11H5.5A1.5 1.5 0 014 12V2.5M4 10.5h8.5", // book
  script: "M5.5 4L2.5 8l3 4M10.5 4l3 4-3 4", // code brackets
  steering: "M4 2.5v11M4 3.5h7.5L9.5 6l2 2.5H4", // flag
  amendment: "M3 13l.7-2.8 7.5-7.5a1.1 1.1 0 011.6 0l.5.5a1.1 1.1 0 010 1.6L5.8 12.3 3 13", // pencil
  rule: "M8 2l4.5 1.8v3.5c0 3-1.9 5.1-4.5 6.2-2.6-1.1-4.5-3.2-4.5-6.2V3.8L8 2", // shield
};

/** unknown kind (knowledge's set is open) → a neutral document icon */
export const DEFAULT_KIND_ICON = "M4.5 2.5h5L12 5v8.5H4.5v-11M9 2.5V5.5H12";

export const kindIcon = (kind: string | undefined): string =>
  (kind && KIND_ICONS[kind]) || DEFAULT_KIND_ICON;

// ── faculty display metadata ──────────────────────────────────────────

export const FACULTY_ORDER: FacultyKey[] = [
  "knowledge", "memory", "actions", "instructions", "guardrails",
];

export interface FacultyMeta {
  label: string;
  /** 16×16 stroke icon path */
  icon: string;
  /** TeachingEmpty headline */
  emptyHeadline: string;
  /** TeachingEmpty's ONE teaching sentence */
  teach: string;
}

export const FACULTY_META: Record<FacultyKey, FacultyMeta> = {
  knowledge: {
    label: "Knowledge",
    icon: "M6.3 13.5h3.4M6.8 11.5h2.4M8 2.5a3.9 3.9 0 012.2 7.1c-.5.4-.7 1.1-.7 1.9H6.5c0-.8-.2-1.5-.7-1.9A3.9 3.9 0 018 2.5",
    emptyHeadline: "No knowledge yet",
    teach: "Facts zuzuu learns from your sessions land here after your approval.",
  },
  memory: {
    label: "Memory",
    icon: "M8 2.5a5.5 5.5 0 110 11 5.5 5.5 0 010-11M8 5v3.2l2.2 1.6",
    emptyHeadline: "No memories yet",
    teach: "Episodes — distilled records of past sessions — accumulate here as you work.",
  },
  actions: {
    label: "Actions",
    icon: "M9 1.5L3.5 9H7l-.5 5.5L12 7H8.5L9 1.5",
    emptyHeadline: "No actions yet",
    teach: "Procedures zuzuu sees you repeat become reusable runbooks once you approve them.",
  },
  instructions: {
    label: "Instructions",
    icon: "M4 2.5v11M4 3.5h7.5L9.5 6l2 2.5H4",
    emptyHeadline: "No instructions yet",
    teach: "Steering — the pinned guidance your agent reads at every session start — lives here.",
  },
  guardrails: {
    label: "Guardrails",
    icon: "M8 2l4.5 1.8v3.5c0 3-1.9 5.1-4.5 6.2-2.6-1.1-4.5-3.2-4.5-6.2V3.8L8 2",
    emptyHeadline: "No guardrails yet",
    teach: "Hard rules enforced on tool calls — a refusal here is policy, not preference.",
  },
};

// ── manifest ui descriptors → display (FACULTY_META is the FALLBACK) ──

/** Manifest `ui.icon` names → 16×16 stroke paths. New faculties pick from
 *  this set (or fall back to a neutral document icon) — no frontend code. */
export const UI_ICON_PATHS: Record<string, string> = {
  book: FACULTY_META.knowledge.icon,
  clock: FACULTY_META.memory.icon,
  play: FACULTY_META.actions.icon,
  compass: FACULTY_META.instructions.icon,
  shield: FACULTY_META.guardrails.icon,
};

export interface FacultyDisplay {
  label: string;
  /** resolved 16×16 stroke icon path */
  icon: string;
  emptyHeadline: string;
  teach: string;
}

const isBuiltin = (id: string): id is FacultyKey => id in FACULTY_META;

/** A faculty's display block: the overview's manifest `ui` descriptor wins;
 *  the kit's built-in FACULTY_META covers CLI-less degradation; unknown
 *  (declarative third-party) faculties get generic-but-complete display. */
export function facultyDisplay(id: string, entry?: FacultyOverviewEntry): FacultyDisplay {
  const builtin = isBuiltin(id) ? FACULTY_META[id] : undefined;
  const label = entry?.title ?? builtin?.label ?? id.charAt(0).toUpperCase() + id.slice(1);
  const iconName = entry?.ui?.icon;
  const icon = (iconName && UI_ICON_PATHS[iconName]) ?? builtin?.icon ?? DEFAULT_KIND_ICON;
  return {
    label,
    icon,
    emptyHeadline: builtin?.emptyHeadline ?? `No ${label.toLowerCase()} yet`,
    teach: entry?.ui?.teaching ?? builtin?.teach ?? "Items graduate here through your review.",
  };
}

// ── relative time ─────────────────────────────────────────────────────

/** "2h ago"-style relative timestamp; null for missing/unparseable input.
 *  Future timestamps clamp to "just now" (clock skew, not a feature). */
export function relativeTime(iso: string | null | undefined, now: number = Date.now()): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

/** The newest updated_at/created_at across a faculty's items (card meta line). */
export function latestUpdate(items: Pick<FacultyItem, "created_at" | "updated_at">[]): string | null {
  let best: string | null = null;
  let bestT = -Infinity;
  for (const it of items) {
    const iso = it.updated_at ?? it.created_at;
    if (!iso) continue;
    const t = Date.parse(iso);
    if (!Number.isNaN(t) && t > bestT) { bestT = t; best = iso; }
  }
  return best;
}
