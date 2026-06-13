// §1 Needs you — the actionable section: per-module pending groups, the
// Review CTA (lives HERE, not in the footer), and drift/CLI warnings.
// Quiet "all caught up" when nothing needs the human.
import type { ModuleOverviewEntry, ZuzuuStatus } from "@zuzuu-web/protocol";
import { Button, Count } from "../components/ui";
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
        <div className="flex flex-wrap gap-1.5">
          {groups.map((g) => {
            const display = moduleDisplay(g.id, modules.find((f) => f.id === g.id));
            const hue = moduleHue(g.id);
            return (
              <button
                key={g.id}
                onClick={() => openModule(g.id as Parameters<typeof openModule>[0])}
                className="group flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-border bg-surface px-2 py-1 text-left transition-colors hover:border-border-strong hover:bg-hover"
                title={`Open ${g.title} — ${g.pending} pending`}
              >
                {/* Module icon chip */}
                <span
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px]"
                  style={{
                    background: `color-mix(in oklab, ${hue} 14%, transparent)`,
                    boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${hue} 22%, transparent)`,
                  }}
                >
                  <svg viewBox="0 0 16 16" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: hue }}>
                    <path d={display.icon} strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                {/* Module name */}
                <span className="wc-sans text-meta font-medium text-ink-200">{g.title}</span>
                {/* Count — amber only when pending>0 (always true here, but explicit) */}
                {g.pending > 0 && (
                  <span
                    className="inline-flex min-w-4 items-center justify-center rounded-full px-1.5 text-meta font-medium tabular-nums"
                    style={{
                      background: "color-mix(in oklab, var(--color-warn) 14%, transparent)",
                      color: "color-mix(in oklab, var(--color-warn) 82%, white)",
                    }}
                  >
                    {g.pending}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      {groups.length > 0 && (
        <button
          className="wc-sans mt-0.5 text-left text-meta text-ink-500 transition-colors hover:text-ink-200"
          onClick={() => openReview(true)}
        >
          Review all {total} →
        </button>
      )}
      {calm && <div className="py-1 text-meta text-ink-600">all caught up</div>}
    </Section>
  );
}
