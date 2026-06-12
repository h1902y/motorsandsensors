// One session's detail (slides over the panel root, like FacultyView):
// trace summary (spans/tools/duration) + per-faculty mined signals from
// `session inspect`, plus "graduated from this session" — items whose
// provenance cites this session (filtered client-side from the faculty
// details). v1 scope: counts + lists, no transcript viewer.
import { useQueries, useQuery } from "@tanstack/react-query";
import type { FacultyItem, FacultyKey } from "@zuzuu-web/protocol";
import { isCliAbsent, describeZuzuuError, zuzuuApi } from "../lib/zuzuu-api";
import { useExplorer } from "../state/explorer";
import { useRightPanel } from "../state/right-panel";
import { FACULTY_ORDER, ItemRow, MetricChip, Section, facultyDisplay } from "./kit";
import { facultyItemPath } from "./faculty-paths";
import { fmtDuration, graduatedFromSession, sessionStateMeta, shortSessionId } from "./sections";

export function SessionDetail({ sessionId }: { sessionId: string }) {
  const closeDrill = useRightPanel((s) => s.closeDrill);
  const inspect = useQuery({
    queryKey: ["zuzuu", "session-inspect", sessionId],
    queryFn: () => zuzuuApi.sessionInspect(sessionId),
    refetchInterval: 8000,
    retry: false,
  });
  // header fallback while inspect loads/fails — the list is already cached
  const list = useQuery({ queryKey: ["zuzuu", "sessions"], queryFn: zuzuuApi.sessions, refetchInterval: 6000 });
  const session = inspect.data?.session ?? list.data?.sessions.find((s) => s.id === sessionId);

  // graduated-from-session: filter the faculty details' items by provenance
  const details = useQueries({
    queries: FACULTY_ORDER.map((key) => ({
      queryKey: ["zuzuu", "faculty", key],
      queryFn: () => zuzuuApi.faculty(key),
      staleTime: 8000,
    })),
  });
  const allItems: FacultyItem[] = details.flatMap((d) => d.data?.items ?? []);
  const graduated = graduatedFromSession(allItems, sessionId);

  const meta = sessionStateMeta(session?.state);
  const trace = inspect.data?.trace;
  const signals = Object.entries(inspect.data?.signals ?? {});
  const warnings = inspect.data?.warnings ?? [];

  return (
    <div className="wc-slide-in flex flex-col gap-4 p-3">
      {/* back to the panel root */}
      <div className="flex items-center gap-2">
        <button
          onClick={closeDrill}
          className="text-meta text-ink-500 transition-colors hover:text-accent"
          title="Back to the panel"
        >
          ‹ Sessions
        </button>
        <span className="ml-auto flex min-w-0 items-baseline gap-2 text-ui font-medium text-ink-100">
          <span className="truncate">{session?.host ?? "session"}</span>
          <span className="font-mono text-meta text-ink-500">{shortSessionId(sessionId)}</span>
          <span className="text-meta text-ink-500">{meta.label}</span>
        </span>
      </div>

      {/* summary chips — counts come from the index even without the CLI */}
      <div className="flex flex-wrap items-center gap-1.5">
        <MetricChip label="spans" value={trace?.spans != null ? String(trace.spans) : "—"} title="OTLP spans in the stored trace" />
        <MetricChip label="tools" value={trace?.tools != null ? String(trace.tools) : String(session?.counts?.tools ?? "—")} title="tool calls" />
        <MetricChip
          label="duration"
          value={fmtDuration(trace?.duration ?? session?.durationMs) ?? "—"}
          title="session duration"
        />
        {session?.counts?.errors !== undefined && session.counts.errors > 0 && (
          <MetricChip label="errors" value={String(session.counts.errors)} tone="pending" title="errored tool calls" />
        )}
      </div>

      {inspect.error != null && (
        <div className="rounded-ui border border-warn/40 bg-[color-mix(in_oklab,var(--color-warn)_10%,transparent)] px-3 py-2 text-meta text-warn">
          {isCliAbsent(inspect.error)
            ? "trace inspection needs the zuzuu CLI — npm i -g @zuzuucodes/cli"
            : describeZuzuuError(inspect.error)}
        </div>
      )}

      {/* per-faculty mined signals — what this session offered each faculty */}
      {inspect.data && (
        <Section label="signals">
          {signals.length === 0 ? (
            <div className="text-meta text-ink-600">no signals mined</div>
          ) : (
            <div className="flex flex-col">
              {signals.map(([faculty, counts]) => {
                const display = facultyDisplay(faculty);
                const parts = Object.entries(counts).filter(([, n]) => n > 0);
                return (
                  <div key={faculty} className="flex items-center gap-2 border-b border-border py-1 text-ui last:border-0">
                    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 text-ink-500" fill="none" stroke="currentColor" strokeWidth="1.4">
                      <path d={display.icon} strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span className="text-ink-300">{display.label}</span>
                    <span className="ml-auto text-meta text-ink-500">
                      {parts.length === 0 ? "—" : parts.map(([k, n]) => `${k} ${n}`).join(" · ")}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </Section>
      )}

      {/* what this session grew into — provenance-cited items */}
      <Section label={`graduated from this session (${graduated.length})`}>
        {graduated.length === 0 ? (
          <div className="text-meta text-ink-600">nothing graduated yet — approve proposals via review</div>
        ) : (
          <div className="flex flex-col">
            {graduated.map((it) => (
              <ItemRow
                key={`${it.faculty}-${it.id}`}
                kind={it.kind}
                title={it.title}
                timestamp={it.updated_at ?? it.created_at}
                onClick={() => useExplorer.getState().openPreviewPath(facultyItemPath(it.faculty as FacultyKey, it.id))}
                titleAttr={facultyItemPath(it.faculty as FacultyKey, it.id)}
              />
            ))}
          </div>
        )}
      </Section>

      {warnings.length > 0 && (
        <Section label="warnings">
          {warnings.map((w) => (
            <div key={w} className="text-meta text-warn">⚠ {w}</div>
          ))}
        </Section>
      )}
    </div>
  );
}
