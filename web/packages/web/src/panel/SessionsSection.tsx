// §2 Sessions — calm table with recency section headers, status as the
// only color, faint-red failed-row tint on crashed rows, compact data
// density (ids/durations mono), counts strip at the top.
// Active session pins first (with SessionBrief beneath it); completed/etc
// sorted into Today / Yesterday / This Week / Older buckets.
import type { ZuzuuSessionEntry } from "@zuzuu-web/protocol";
import { useQuery } from "@tanstack/react-query";
import { zuzuuApi } from "../lib/zuzuu-api";
import { Count, StatusPill, cx } from "../components/ui";
import { useRightPanel } from "../state/right-panel";
import { TeachingEmpty, relativeTime } from "./kit";
import { SessionBrief } from "./SessionBrief";
import { fmtDuration, sessionStateMeta, shortSessionId, splitSessions } from "./sections";

// ── sessions empty-state preview mock ────────────────────────────────────────

/** Faint mock rows that preview what the sessions list will look like once
 *  the first session is captured. Pointer-events-none is set by TeachingEmpty's
 *  preview wrapper; these are purely decorative. */
function SessionsPreviewMock() {
  const rows = [
    { state: "completed", host: "claude code", ago: "2m ago", dur: "12.3m", id: "a1b2c3d4" },
    { state: "captured",  host: "gemini cli",  ago: "1h ago", dur: "8.7m",  id: "e5f6g7h8" },
    { state: "captured",  host: "claude code", ago: "3h ago", dur: "22.1m", id: "i9j0k1l2" },
  ] as const;
  const toneCls: Record<string, string> = {
    completed: "text-ok border-ok/40 bg-[color-mix(in_oklab,var(--color-ok)_10%,transparent)]",
    captured:  "text-ink-400 border-border bg-surface",
  };
  return (
    <div className="flex flex-col divide-y divide-border overflow-hidden rounded-[var(--radius-ui)] border border-border">
      {rows.map((r) => (
        <div key={r.id} className="flex items-center gap-2 px-2 py-1.5">
          <span className={cx("wc-sans inline-flex items-center rounded px-1.5 py-0.5 text-meta font-medium border", toneCls[r.state])}>
            {r.state}
          </span>
          <span className="wc-sans min-w-0 flex-1 truncate text-ui font-medium text-ink-200">{r.host}</span>
          <span className="flex shrink-0 items-baseline gap-3 text-meta text-ink-500">
            <span className="wc-sans">{r.ago}</span>
            <span className="wc-mono">{r.dur}</span>
            <span className="wc-mono text-ink-600">{r.id}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

// ── recency bucketing ─────────────────────────────────────────────────────

type Bucket = "Today" | "Yesterday" | "This week" | "Older";

function recencyBucket(iso: string | null | undefined): Bucket {
  if (!iso) return "Older";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "Older";
  const now = Date.now();
  const age = now - t;
  const day = 86_400_000;
  if (age < day) return "Today";
  if (age < 2 * day) return "Yesterday";
  if (age < 7 * day) return "This week";
  return "Older";
}

function bucketSessions(sessions: ZuzuuSessionEntry[]): { bucket: Bucket; items: ZuzuuSessionEntry[] }[] {
  const order: Bucket[] = ["Today", "Yesterday", "This week", "Older"];
  const map = new Map<Bucket, ZuzuuSessionEntry[]>();
  for (const s of sessions) {
    const b = recencyBucket(s.startedAt);
    if (!map.has(b)) map.set(b, []);
    map.get(b)!.push(s);
  }
  return order.filter((b) => map.has(b)).map((b) => ({ bucket: b, items: map.get(b)! }));
}

// ── status pill mapping ───────────────────────────────────────────────────

function statusTone(tone: string): "ok" | "warn" | "bad" | "neutral" | "info" {
  if (tone === "ok") return "ok";
  if (tone === "warn") return "warn";
  if (tone === "danger") return "bad";
  return "neutral";
}

// ── summary counts strip ─────────────────────────────────────────────────

function CountsStrip({ sessions }: { sessions: ZuzuuSessionEntry[] }) {
  const total = sessions.length;
  const completed = sessions.filter((s) => s.state === "completed" || s.state === "captured").length;
  const active = sessions.filter((s) => s.state === "active" || s.state === "opening").length;
  const crashed = sessions.filter((s) => s.state === "crashed").length;
  return (
    <div className="flex items-center gap-2 pb-2">
      <span className="wc-sans text-meta text-ink-500">
        <Count>{total}</Count>
        <span className="ml-1.5">sessions</span>
      </span>
      {completed > 0 && (
        <span className="text-meta text-ink-600">
          <Count>{completed}</Count>
          <span className="ml-1 text-ink-600">completed</span>
        </span>
      )}
      {active > 0 && (
        <span className="text-meta">
          <Count>{active}</Count>
          <span className="ml-1 text-ink-500">active</span>
        </span>
      )}
      {crashed > 0 && (
        <span className="text-meta text-error">
          <Count>{crashed}</Count>
          <span className="ml-1">crashed</span>
        </span>
      )}
    </div>
  );
}

// ── a single session row (compact data table row) ─────────────────────────

function SessionRow({ session, pinned = false }: { session: ZuzuuSessionEntry; pinned?: boolean }) {
  const openSession = useRightPanel((s) => s.openSession);
  const meta = sessionStateMeta(session.state);
  const dur = fmtDuration(session.durationMs);
  const when = relativeTime(session.startedAt ?? undefined);
  const isCrashed = session.state === "crashed";
  const pillTone = statusTone(meta.tone);

  return (
    <button
      onClick={() => openSession(session.id)}
      className={cx(
        // compact table row — hover reveal, border between rows
        "group flex w-full items-center gap-2 py-1.5 pl-2 pr-2 text-left transition-colors hover:bg-hover",
        !pinned && "border-b border-border last:border-0",
        // faint full-row tint on crashed/failed — the only status-driven fill
        isCrashed && "bg-[var(--color-error-subtle)] hover:bg-[color-mix(in_oklab,var(--color-error-subtle)_80%,var(--color-hover))]",
      )}
      title={`Inspect session ${session.id}`}
    >
      {/* status pill — the ONLY color in the row */}
      <StatusPill tone={pillTone}>
        {meta.label}
      </StatusPill>

      {/* host — sans, primary label */}
      <span className="wc-sans min-w-0 flex-1 truncate text-ui font-medium text-ink-100">
        {session.host ?? "session"}
      </span>

      {/* trailing metadata — all mono for machine values, muted */}
      <span className="flex shrink-0 items-baseline gap-3 text-meta text-ink-500">
        {when && <span className="wc-sans">{when}</span>}
        {dur && <span className="wc-mono">{dur}</span>}
        <span className="wc-mono text-ink-600">{shortSessionId(session.id)}</span>
      </span>
    </button>
  );
}

// ── pinned active session card ─────────────────────────────────────────────

function ActiveCard({ session }: { session: ZuzuuSessionEntry }) {
  const openSession = useRightPanel((s) => s.openSession);
  const meta = sessionStateMeta(session.state);
  const dur = fmtDuration(session.durationMs);
  return (
    <div className="mb-2 flex flex-col gap-2 rounded-[var(--radius-ui)] border border-border bg-surface px-2 pb-2.5 pt-1.5">
      <button
        onClick={() => openSession(session.id)}
        className="flex w-full items-center gap-2 text-left transition-colors hover:opacity-80"
        title={`Inspect session ${session.id}`}
      >
        <StatusPill tone="ok">
          {meta.label}
        </StatusPill>
        <span className="wc-sans min-w-0 flex-1 truncate text-ui font-medium text-ink-100">
          {session.host ?? "session"}
        </span>
        <span className="flex shrink-0 items-baseline gap-3 text-meta text-ink-500">
          {dur && <span className="wc-mono">{dur}</span>}
          <span className="wc-mono text-ink-600">{shortSessionId(session.id)}</span>
        </span>
      </button>
      <SessionBrief />
    </div>
  );
}

// ── section header (recency bucket) ──────────────────────────────────────

function BucketHeader({ label }: { label: string }) {
  return (
    <div className="wc-sans pb-0.5 pt-2 text-meta font-medium text-ink-500 first:pt-0">
      {label}
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────

export function SessionsSection() {
  const q = useQuery({ queryKey: ["zuzuu", "sessions"], queryFn: zuzuuApi.sessions, refetchInterval: 6000 });
  const all = q.data?.sessions ?? [];
  const { active, rest } = splitSessions(all);
  const buckets = bucketSessions(rest);

  if (all.length === 0) {
    // Build a ModuleDisplay-shaped object for the sessions surface
    const sessionsDisplay = {
      label: "Sessions",
      icon: "M8 2.5a5.5 5.5 0 110 11 5.5 5.5 0 010-11M8 5v3.2l2.2 1.6",
      emptyHeadline: "Your agent hasn't run yet",
      teach: "Start a session and zuzuu watches over its shoulder — every run becomes something it can learn from.",
    };
    return (
      <div className="flex flex-col gap-2">
        <div className="wc-eyebrow">sessions</div>
        <TeachingEmpty
          display={sessionsDisplay}
          preview={<SessionsPreviewMock />}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {/* counts strip — sans, muted */}
      <CountsStrip sessions={all} />

      {/* active session pins at top with brief */}
      {active && <ActiveCard session={active} />}

      {/* bucketed history rows */}
      {buckets.map(({ bucket, items }) => (
        <div key={bucket}>
          <BucketHeader label={bucket} />
          <div className="flex flex-col rounded-[var(--radius-ui)] border border-border overflow-hidden">
            {items.map((s) => (
              <SessionRow key={s.id} session={s} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
