// One session's detail — narrative trace timeline with a summary-first KPI
// header, then a timeline of signal receipts (what the session did), then
// "graduated from this session" items, then warnings.
//
// Trace/span data: the wire type (SessionInspectResponse) carries only
// aggregate span counts (spans, tools, duration) — no per-span tree. We build
// the narrative timeline from the per-module signal counts instead: each
// module's signal breakdown (commands:3, decisions:1, …) becomes a typed
// Receipt row. A span tree toggle is reserved for when richer data lands.
//
// Inspector rail: selecting a signal category (module row) opens a per-entry
// PropertyRow rail on the right, animated with wc-panel-enter.
import { useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import type { ModuleItem, ModuleKey } from "@zuzuu-web/protocol";
import { isCliAbsent, describeZuzuuError, zuzuuApi } from "../lib/zuzuu-api";
import { useExplorer } from "../state/explorer";
import { useRightPanel } from "../state/right-panel";
import { Receipt, PropertyRow, StatusPill, HeroNumber, Segmented, Spinner, cx } from "../components/ui";
import { MODULE_ORDER, ItemRow, moduleDisplay } from "./kit";
import { moduleItemPath } from "./module-paths";
import { fmtDuration, graduatedFromSession, sessionStateMeta, shortSessionId } from "./sections";

// ── icon paths (supplement KIND_ICONS for signal categories) ──────────────

const SIGNAL_CATEGORY_ICONS: Record<string, string> = {
  commands: "M3 4l3.5 4L3 12M8.5 12H13",          // terminal-prompt
  facts: "M8 2.5a5.5 5.5 0 110 11 5.5 5.5 0 010-11M8 5.5v.5M8 8v3", // info
  decisions: "M4 13.5V8a4 4 0 014-4h4.5M10 1.5L13 4l-3 2.5", // fork
  entities: "M8 2l5 2.5v7L8 14l-5-2.5v-7L8 2M3 4.5L8 7l5-2.5M8 7v7", // cube
  episodes: "M8 2.5a5.5 5.5 0 110 11 5.5 5.5 0 010-11M8 5v3.2l2.2 1.6", // clock
  runbooks: "M4 2.5h8.5v11H5.5A1.5 1.5 0 014 12V2.5M4 10.5h8.5", // book
  scripts: "M5.5 4L2.5 8l3 4M10.5 4l3 4-3 4", // code
  steerings: "M4 2.5v11M4 3.5h7.5L9.5 6l2 2.5H4", // flag
  amendments: "M3 13l.7-2.8 7.5-7.5a1.1 1.1 0 011.6 0l.5.5a1.1 1.1 0 010 1.6L5.8 12.3 3 13", // pencil
  rules: "M8 2l4.5 1.8v3.5c0 3-1.9 5.1-4.5 6.2-2.6-1.1-4.5-3.2-4.5-6.2V3.8L8 2", // shield
};
const DEFAULT_SIGNAL_ICON = "M4.5 2.5h5L12 5v8.5H4.5v-11M9 2.5V5.5H12"; // doc

function signalIcon(key: string): string {
  // try exact match, then singular
  return SIGNAL_CATEGORY_ICONS[key] ?? SIGNAL_CATEGORY_ICONS[key.replace(/s$/, "")] ?? DEFAULT_SIGNAL_ICON;
}

// ── view modes ────────────────────────────────────────────────────────────

type ViewMode = "timeline" | "overview";

// ── inspector rail (per-module signal detail) ─────────────────────────────

function InspectorRail({
  module,
  counts,
  sessionId,
  onClose,
}: {
  module: string;
  counts: Record<string, number>;
  sessionId: string;
  onClose: () => void;
}) {
  const display = moduleDisplay(module);
  const parts = Object.entries(counts).filter(([, n]) => n > 0);
  return (
    <div className="wc-panel-enter flex flex-col gap-1 rounded-[var(--radius-ui)] border border-border bg-elevated p-3">
      <div className="flex items-center gap-2 pb-1">
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 text-ink-400" fill="none" stroke="currentColor" strokeWidth="1.4">
          <path d={display.icon} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="wc-sans text-ui font-medium text-ink-100">{display.label}</span>
        <button
          onClick={onClose}
          className="ml-auto text-meta text-ink-500 transition-colors hover:text-ink-200"
          title="Close inspector"
        >
          ✕
        </button>
      </div>
      <div className="flex flex-col divide-y divide-border">
        {parts.length === 0 ? (
          <span className="text-meta text-ink-600 py-1">no signals mined</span>
        ) : (
          parts.map(([k, n]) => (
            <PropertyRow key={k} label={k}>
              <span className="wc-mono text-ink-200">{n}</span>
            </PropertyRow>
          ))
        )}
      </div>
      <div className="pt-1">
        <PropertyRow label="session">
          <span className="wc-mono text-ink-500">{shortSessionId(sessionId)}</span>
        </PropertyRow>
      </div>
    </div>
  );
}

// ── narrative timeline receipt for a module signal group ──────────────────

function SignalReceipt({
  module,
  counts,
  onSelect,
  selected,
}: {
  module: string;
  counts: Record<string, number>;
  onSelect: () => void;
  selected: boolean;
}) {
  const display = moduleDisplay(module);
  const parts = Object.entries(counts).filter(([, n]) => n > 0);
  const total = parts.reduce((s, [, n]) => s + n, 0);
  const summary = parts.map(([k, n]) => `${n} ${k}`).join(" · ") || "—";

  return (
    <div
      className={cx(
        "rounded-[var(--radius-ui)] transition-colors",
        selected && "bg-hover",
      )}
    >
      <Receipt
        icon={display.icon}
        label={
          <span>
            <span className="wc-sans text-ink-100">{display.label}</span>
            <span className="wc-sans ml-1.5 text-ink-500">
              — {total} signal{total !== 1 ? "s" : ""}
            </span>
          </span>
        }
        meta={undefined}
      >
        {/* expandable detail rows */}
        <div className="flex flex-col gap-0.5 pt-1">
          {parts.length === 0 ? (
            <div className="text-meta text-ink-600">no signals</div>
          ) : (
            parts.map(([k, n]) => (
              <div key={k} className="flex items-center gap-2">
                <svg viewBox="0 0 16 16" className="h-3 w-3 shrink-0 text-ink-500" fill="none" stroke="currentColor" strokeWidth="1.4">
                  <path d={signalIcon(k)} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="wc-sans text-meta text-ink-400">{k}</span>
                <span className="wc-mono ml-auto text-meta text-ink-300">{n}</span>
              </div>
            ))
          )}
          <button
            onClick={onSelect}
            className="wc-sans mt-1 self-start text-meta text-ink-500 transition-colors hover:text-accent"
          >
            {selected ? "Close inspector ›" : "Inspect ›"}
          </button>
        </div>
      </Receipt>
    </div>
  );
}

// ── KPI header ─────────────────────────────────────────────────────────────

function KpiHeader({
  spans,
  tools,
  duration,
  errors,
}: {
  spans: number | null;
  tools: number | null;
  duration: number | null;
  errors: number | undefined;
}) {
  const durStr = fmtDuration(duration) ?? "—";
  return (
    <div className="flex flex-wrap items-end gap-4 py-2">
      {duration != null && (
        <div className="flex flex-col gap-0.5">
          <HeroNumber value={<span className="wc-mono">{durStr}</span>} />
          <span className="wc-sans text-meta text-ink-500">duration</span>
        </div>
      )}
      {tools != null && (
        <div className="flex flex-col gap-0.5">
          <HeroNumber value={<span className="wc-mono">{tools}</span>} />
          <span className="wc-sans text-meta text-ink-500">tool calls</span>
        </div>
      )}
      {spans != null && (
        <div className="flex flex-col gap-0.5">
          <HeroNumber value={<span className="wc-mono">{spans}</span>} />
          <span className="wc-sans text-meta text-ink-500">spans</span>
        </div>
      )}
      {errors != null && errors > 0 && (
        <div className="flex flex-col gap-0.5">
          <HeroNumber value={<span className="wc-mono text-error">{errors}</span>} />
          <span className="wc-sans text-meta text-ink-500">errors</span>
        </div>
      )}
    </div>
  );
}

// ── main component ─────────────────────────────────────────────────────────

export function SessionDetail({ sessionId }: { sessionId: string }) {
  const closeDrill = useRightPanel((s) => s.closeDrill);
  const [viewMode, setViewMode] = useState<ViewMode>("timeline");
  const [inspectorModule, setInspectorModule] = useState<string | null>(null);

  const inspect = useQuery({
    queryKey: ["zuzuu", "session-inspect", sessionId],
    queryFn: () => zuzuuApi.sessionInspect(sessionId),
    refetchInterval: 8000,
    retry: false,
  });

  // header fallback while inspect loads/fails — the list is already cached
  const list = useQuery({ queryKey: ["zuzuu", "sessions"], queryFn: zuzuuApi.sessions, refetchInterval: 6000 });
  const session = inspect.data?.session ?? list.data?.sessions.find((s) => s.id === sessionId);

  // graduated-from-session: filter the module details' items by provenance
  const details = useQueries({
    queries: MODULE_ORDER.map((key) => ({
      queryKey: ["zuzuu", "module", key],
      queryFn: () => zuzuuApi.module(key),
      staleTime: 8000,
    })),
  });
  const allItems: ModuleItem[] = details.flatMap((d) => d.data?.items ?? []);
  const graduated = graduatedFromSession(allItems, sessionId);

  const meta = sessionStateMeta(session?.state);
  const pillTone = meta.tone === "ok" ? "ok" : meta.tone === "warn" ? "warn" : meta.tone === "danger" ? "bad" : "neutral";

  const trace = inspect.data?.trace;
  const signals = Object.entries(inspect.data?.signals ?? {});
  const warnings = inspect.data?.warnings ?? [];

  // derive if a span tree could exist — currently we only have aggregates
  // The wire type gives us spans/tools/duration but no individual span records.
  // We render: KPI header → narrative signal timeline (per module) → graduated.
  // A "waterfall" tab is stubbed for when richer data arrives.
  const hasSignals = signals.length > 0;

  return (
    <div className="wc-slide-in flex flex-col gap-4 p-3">
      {/* back nav + session identity */}
      <div className="flex items-center gap-2">
        <button
          onClick={closeDrill}
          className="wc-sans text-meta text-ink-500 transition-colors hover:text-accent"
          title="Back to the panel"
        >
          ‹ Sessions
        </button>
        <div className="ml-auto flex min-w-0 items-center gap-2">
          <StatusPill tone={pillTone as "ok" | "warn" | "bad" | "neutral" | "info"}>{meta.label}</StatusPill>
          <span className="wc-sans truncate text-ui font-medium text-ink-100">
            {session?.host ?? "session"}
          </span>
          <span className="wc-mono text-meta text-ink-600">{shortSessionId(sessionId)}</span>
        </div>
      </div>

      {/* KPI summary header — summary-first per design */}
      {(trace ?? session) && (
        <KpiHeader
          spans={trace?.spans ?? null}
          tools={trace?.tools ?? session?.counts?.tools ?? null}
          duration={trace?.duration ?? session?.durationMs ?? null}
          errors={session?.counts?.errors}
        />
      )}

      {/* git context if available */}
      {session?.git?.branch && (
        <div className="flex items-center gap-2 text-meta text-ink-500">
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.4">
            <path d="M4 2.5v11M4 3.5h7.5L9.5 6l2 2.5H4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="wc-sans">branch</span>
          <span className="wc-mono text-ink-300">{session.git.branch}</span>
          {session.git.commit && (
            <span className="wc-mono text-ink-600">{session.git.commit.slice(0, 7)}</span>
          )}
        </div>
      )}

      {/* CLI-absent / error notice */}
      {inspect.error != null && (
        <div className="rounded-[var(--radius-ui)] border border-warn/40 bg-[color-mix(in_oklab,var(--color-warn)_10%,transparent)] px-3 py-2 text-meta text-warn">
          {isCliAbsent(inspect.error)
            ? "trace inspection needs the zuzuu CLI — npm i -g @zuzuucodes/cli"
            : describeZuzuuError(inspect.error)}
        </div>
      )}

      {/* loading state */}
      {inspect.isLoading && (
        <div className="flex items-center gap-2 text-meta text-ink-500">
          <Spinner />
          <span className="wc-sans">loading trace…</span>
        </div>
      )}

      {/* narrative timeline / signals section */}
      {inspect.data && (
        <div className="flex flex-col gap-2">
          {/* section header + view-mode segmented control */}
          <div className="flex items-center gap-2">
            <span className="wc-eyebrow flex-1">activity</span>
            {/* waterfall toggle — secondary (stubbed; shows count-only until per-span data exists) */}
            <Segmented
              options={[
                { value: "timeline", label: "Timeline" },
                { value: "overview", label: "Overview" },
              ]}
              value={viewMode}
              onChange={(v) => {
                setViewMode(v as ViewMode);
                setInspectorModule(null);
              }}
            />
          </div>

          {viewMode === "timeline" && (
            <div className="flex flex-col gap-1">
              {!hasSignals ? (
                <div className="wc-sans py-1 text-meta text-ink-600">no signals mined</div>
              ) : (
                signals.map(([module, counts]) => (
                  <SignalReceipt
                    key={module}
                    module={module}
                    counts={counts}
                    selected={inspectorModule === module}
                    onSelect={() =>
                      setInspectorModule((cur) => (cur === module ? null : module))
                    }
                  />
                ))
              )}

              {/* per-module inspector rail — wc-panel-enter, revealed per selection */}
              {inspectorModule && inspect.data.signals[inspectorModule] && (
                <InspectorRail
                  module={inspectorModule}
                  counts={inspect.data.signals[inspectorModule]!}
                  sessionId={sessionId}
                  onClose={() => setInspectorModule(null)}
                />
              )}
            </div>
          )}

          {viewMode === "overview" && (
            <div className="flex flex-col divide-y divide-border rounded-[var(--radius-ui)] border border-border">
              {!hasSignals ? (
                <div className="wc-sans px-2 py-2 text-meta text-ink-600">no signals mined</div>
              ) : (
                signals.map(([module, counts]) => {
                  const display = moduleDisplay(module);
                  const parts = Object.entries(counts).filter(([, n]) => n > 0);
                  return (
                    <div key={module} className="flex items-center gap-2 px-2 py-1.5 text-ui">
                      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 text-ink-500" fill="none" stroke="currentColor" strokeWidth="1.4">
                        <path d={display.icon} strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span className="wc-sans text-ink-300">{display.label}</span>
                      <span className="wc-mono ml-auto text-meta text-ink-500">
                        {parts.length === 0 ? "—" : parts.map(([k, n]) => `${k} ${n}`).join(" · ")}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      )}

      {/* what this session grew into — provenance-cited items */}
      <div className="flex flex-col gap-2">
        <div className="wc-eyebrow">
          graduated from this session
          {graduated.length > 0 && (
            <span className="ml-1.5 text-ink-600">({graduated.length})</span>
          )}
        </div>
        {graduated.length === 0 ? (
          <div className="wc-sans text-meta text-ink-600">nothing graduated yet — approve proposals via review</div>
        ) : (
          <div className="flex flex-col rounded-[var(--radius-ui)] border border-border overflow-hidden">
            {graduated.map((it) => (
              <ItemRow
                key={`${it.module}-${it.id}`}
                kind={it.kind}
                title={it.title}
                timestamp={it.updated_at ?? it.created_at}
                onClick={() => useExplorer.getState().openPreviewPath(moduleItemPath(it.module as ModuleKey, it.id))}
                titleAttr={moduleItemPath(it.module as ModuleKey, it.id)}
              />
            ))}
          </div>
        )}
      </div>

      {warnings.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="wc-eyebrow">warnings</div>
          {warnings.map((w) => (
            <div key={w} className="wc-sans text-meta text-warn">⚠ {w}</div>
          ))}
        </div>
      )}
    </div>
  );
}
