// §1 Needs you — the actionable section: per-faculty pending groups, the
// Review CTA (lives HERE, not in the footer), and drift/CLI warnings.
// Quiet "all caught up" when nothing needs the human.
import type { FacultyOverviewEntry, ZuzuuStatus } from "@zuzuu-web/protocol";
import { Button } from "../components/ui";
import { useRightPanel } from "../state/right-panel";
import { useReviewOpen } from "../state/review";
import { MetricChip, Section, facultyDisplay } from "./kit";
import { needsYouGroups, pendingTotal } from "./sections";

export function NeedsYou({
  faculties,
  status,
  zuzuuBin,
}: {
  faculties: FacultyOverviewEntry[];
  status: ZuzuuStatus | undefined;
  zuzuuBin: boolean;
}) {
  const openFaculty = useRightPanel((s) => s.openFaculty);
  const openReview = useReviewOpen((s) => s.setOpen);
  const groups = needsYouGroups(faculties);
  const total = pendingTotal(faculties);
  const drift = status?.drift?.dirty ?? false;
  const calm = groups.length === 0 && !drift && zuzuuBin;

  return (
    <Section
      label="needs you"
      trailing={
        <>
          {/* the ⟡ generation chip — moved here from the footer */}
          <MetricChip label="⟡" value={status?.activeGeneration ?? "no gen"} title="active generation" />
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
            const display = facultyDisplay(g.id, faculties.find((f) => f.id === g.id));
            return (
              <button
                key={g.id}
                onClick={() => openFaculty(g.id as Parameters<typeof openFaculty>[0])}
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
