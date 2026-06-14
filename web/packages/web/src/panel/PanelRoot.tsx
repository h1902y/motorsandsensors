// The panel root (IA v3) — three sections, one scroll:
//   §1 Needs you   — pending groups + the Review CTA + drift/CLI banners
//   §2 Sessions    — active pinned (Session brief beneath) + recent rows
//   §3 Modules   — 3-col card grid (Copy.ai model) + pulse strip
// Data: ONE batched overview read (one daemon-side CLI spawn) + the
// sessions list + status; drill-ins fetch their own detail.
import { useQuery } from "@tanstack/react-query";
import { zuzuuApi } from "../lib/zuzuu-api";
import { useRightPanel } from "../state/right-panel";
import { MetricChip, MODULE_ORDER, ModuleTile, Section, moduleDisplay } from "./kit";
import { NeedsYou } from "./NeedsYou";
import { SessionsSection } from "./SessionsSection";
import { GenerationsTimeline } from "./GenerationsTimeline";
import { pendingTotal } from "./sections";

export function PanelRoot({ zuzuuBin }: { zuzuuBin: boolean }) {
  const openModule = useRightPanel((s) => s.openModule);
  const overview = useQuery({ queryKey: ["zuzuu", "overview"], queryFn: zuzuuApi.overview, refetchInterval: 8000 });
  const status = useQuery({ queryKey: ["zuzuu", "status"], queryFn: zuzuuApi.status, refetchInterval: 8000 });
  const sessions = useQuery({ queryKey: ["zuzuu", "sessions"], queryFn: zuzuuApi.sessions, refetchInterval: 8000 });

  // overview order, with the built-in order as the spine (declarative
  // modules the CLI reports beyond the five list after them)
  const entries = overview.data?.modules ?? [];
  const ids = [
    ...MODULE_ORDER.filter((k) => entries.length === 0 || entries.some((e) => e.id === k)),
    ...entries.map((e) => e.id).filter((id) => !(MODULE_ORDER as string[]).includes(id)),
  ];

  // ── pulse strip metrics ────────────────────────────────────────────────
  const totalSessions = sessions.data?.sessions.length ?? 0;
  const totalPending = pendingTotal(entries);
  // count modules with a pinned generation
  const pinnedGens = status.data?.generations
    ? Object.values(status.data.generations).filter(Boolean).length
    : 0;
  // guardrail denials/pending — pending.guardrails from status, or the module entry
  const guardrailPending = status.data?.pending?.["guardrails"] ?? entries.find((e) => e.id === "guardrails")?.counts.pending ?? 0;

  return (
    <div className="flex flex-col p-3.5">
      <div className="pb-5">
        <NeedsYou modules={entries} status={status.data} zuzuuBin={zuzuuBin} />
      </div>
      <div className="border-t border-border/70 py-5">
        <SessionsSection />
      </div>
      <div className="border-t border-border/70 pt-5">
      <Section label="modules">
        {/* pulse strip — compact stat row above the card grid */}
        <div className="mb-1 flex flex-wrap items-center gap-1.5">
          <MetricChip
            label="sessions"
            value={String(totalSessions)}
            title="total captured sessions"
          />
          <MetricChip
            label="pending"
            value={String(totalPending)}
            tone={totalPending > 0 ? "pending" : "default"}
            title="proposals awaiting your review across all modules"
          />
          <MetricChip
            label="versions"
            value={pinnedGens > 0 ? String(pinnedGens) : "none"}
            title="modules on their latest version"
          />
          {guardrailPending > 0 && (
            <MetricChip
              label="guardrails"
              value={`${guardrailPending} pending`}
              tone="pending"
              title="guardrail proposals pending review"
            />
          )}
        </div>

        {/* 3-col card grid (Copy.ai model) */}
        <div className="grid grid-cols-3 gap-2">
          {ids.map((id, i) => {
            const entry = entries.find((e) => e.id === id);
            const gen = status.data?.generations?.[id] ?? null;
            return (
              <div key={id} className="wc-rise-in" style={{ animationDelay: `${i * 28}ms` }}>
                <ModuleTile
                  id={id}
                  display={moduleDisplay(id, entry)}
                  count={entry?.counts.items ?? 0}
                  pending={entry?.counts.pending ?? 0}
                  generation={gen}
                  onOpen={() => openModule(id as Parameters<typeof openModule>[0])}
                />
              </div>
            );
          })}
          {/* ghost card — 6th slot to complete 3-col rhythm; secondary, no-op */}
          <div className="wc-rise-in" style={{ animationDelay: `${ids.length * 28}ms` }}>
            <GhostCard />
          </div>
        </div>
        <GenerationsTimeline />
      </Section>
      </div>
    </div>
  );
}

/** A dashed ghost card occupying the 6th grid slot. Completes the 3-col
 *  rhythm and gives a quiet affordance — rendered as secondary, never nav. */
function GhostCard() {
  return (
    <div
      className={[
        "flex w-full flex-col items-start gap-3 rounded-[var(--radius-dialog)]",
        "border border-dashed border-border/60 px-5 pb-5 pt-5",
        "text-left",
      ].join(" ")}
      aria-hidden
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-dialog)] border border-dashed border-border/50">
        <svg viewBox="0 0 16 16" className="h-5 w-5 text-ink-600" fill="none" stroke="currentColor" strokeWidth="1.35">
          <path d="M8 3v10M3 8h10" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <div className="flex flex-col gap-1">
        <span className="wc-sans text-title font-semibold text-ink-600">Explore</span>
        <span className="wc-sans text-ui text-ink-600">More modules coming as your agent learns.</span>
      </div>
    </div>
  );
}
