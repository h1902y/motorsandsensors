// §1 Needs you — the actionable section: per-module pending groups, the
// Review CTA (lives HERE, not in the footer), and drift/CLI warnings.
// Quiet "all caught up" when nothing needs the human.
import type { ModuleOverviewEntry, ZuzuuStatus } from "@zuzuu-web/protocol";
import { Button } from "../components/ui";
import { useRightPanel } from "../state/right-panel";
import { useReviewOpen } from "../state/review";
import { MetricChip, Section, moduleDisplay } from "./kit";
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
        <div className="flex flex-col">
          {groups.map((g) => {
            const display = moduleDisplay(g.id, modules.find((f) => f.id === g.id));
            return (
              <button
                key={g.id}
                onClick={() => openModule(g.id as Parameters<typeof openModule>[0])}
                className="flex w-full items-center gap-2 border-b border-border py-1.5 text-left text-ui transition-colors last:border-0 hover:bg-hover"
                title={`Open ${g.title}`}
              >
                <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 text-ink-500" fill="none" stroke="currentColor" strokeWidth="1.4">
                  <path d={display.icon} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="text-ink-100">{g.title}</span>
                <span className="text-status-pending">
                  · {g.pending} to review
                </span>
                <span className="ml-auto text-ink-600">›</span>
              </button>
            );
          })}
        </div>
      )}
      {calm && <div className="py-1 text-meta text-ink-600">all caught up</div>}
    </Section>
  );
}
