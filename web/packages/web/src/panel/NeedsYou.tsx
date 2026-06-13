// §1 Needs you — the actionable section: per-module pending groups, the
// Review CTA (lives HERE, not in the footer), and drift/CLI warnings.
// Quiet "all caught up" when nothing needs the human.
import type { ModuleOverviewEntry, ZuzuuStatus } from "@zuzuu-web/protocol";
import { Button } from "../components/ui";
import { useRightPanel } from "../state/right-panel";
import { useReviewOpen } from "../state/review";
import { MetricChip, Section, moduleDisplay, moduleHue } from "./kit";
import { needsYouGroups, pendingTotal } from "./sections";

export function NeedsYou({
  modules,
  status,
  zuzuuBin,
}: {
  modules: ModuleOverviewEntry[];
  status: ZuzuuStatus | undefined;
  zuzuuBin: boolean;
}) {
  const openModule = useRightPanel((s) => s.openModule);
  const openReview = useReviewOpen((s) => s.setOpen);
  const groups = needsYouGroups(modules);
  const total = pendingTotal(modules);
  const drift = status?.drift?.dirty ?? false;
  const calm = groups.length === 0 && !drift && zuzuuBin;
  // per-module generations now: count how many modules have a pinned generation
  const pinnedModules = status?.generations ? Object.values(status.generations).filter(Boolean).length : 0;
  const genValue = pinnedModules > 0 ? `${pinnedModules} pinned` : "no gen";

  return (
    <Section
      label="needs you"
      trailing={
        <>
          {/* the ⟡ generation chip — per-module generations pinned */}
          <MetricChip label="⟡" value={genValue} title="modules with a pinned generation" />
          {total > 0 && (
            <Button size="sm" variant="primary" onClick={() => openReview(true)}>
              Review {total}
            </Button>
          )}
        </>
      }
    >
      {!zuzuuBin && (
        <div className="rounded-ui border border-warn/40 bg-[color-mix(in_oklab,var(--color-warn)_10%,transparent)] px-3 py-2 text-ui text-warn">
          zuzuu CLI required — <code>npm i -g @zuzuucodes/cli</code>
        </div>
      )}
      {drift && (
        <div className="rounded-ui border border-warn/40 bg-[color-mix(in_oklab,var(--color-warn)_10%,transparent)] px-3 py-2 text-ui text-warn">
          drift detected — run <code>zuzuu doctor</code>
        </div>
      )}
      {groups.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {groups.map((g) => {
            const display = moduleDisplay(g.id, modules.find((f) => f.id === g.id));
            return (
              <button
                key={g.id}
                onClick={() => openModule(g.id as Parameters<typeof openModule>[0])}
                className="group flex w-full items-center gap-2.5 rounded-ui border border-border bg-surface px-2.5 py-2 text-left text-ui transition-colors hover:border-border-strong hover:bg-hover"
                title={`Open ${g.title}`}
              >
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px]"
                  style={{
                    background: `color-mix(in oklab, ${moduleHue(g.id)} 14%, transparent)`,
                    boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${moduleHue(g.id)} 22%, transparent)`,
                  }}
                >
                  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" style={{ color: moduleHue(g.id) }}>
                    <path d={display.icon} strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <span className="wc-sans font-medium text-ink-100">{g.title}</span>
                <span className="text-status-pending">{g.pending} to review</span>
                <span className="ml-auto text-ink-600 transition-transform group-hover:translate-x-0.5">›</span>
              </button>
            );
          })}
        </div>
      )}
      {calm && <div className="py-1 text-meta text-ink-600">all caught up</div>}
    </Section>
  );
}
