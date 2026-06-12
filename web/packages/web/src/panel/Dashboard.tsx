import { useQueries, useQuery } from "@tanstack/react-query";
import type { FacultyDetail } from "@zuzuu-web/protocol";
import { zuzuuApi } from "../lib/zuzuu-api";
import { Button } from "../components/ui";
import { useRightPanel } from "../state/right-panel";
import { useReviewOpen } from "../state/review";
import { pendingReviewCount } from "../faculties/review-queue";
import { FACULTY_ORDER, FacultyCard, MetricChip } from "./kit";
import { DigestPanel } from "./DigestPanel";
import { GenerationsTimeline } from "./GenerationsTimeline";
import { SessionsList } from "./SessionsList";

/** The faculty surface's resting state — the panel IS the dashboard, the
 *  five FacultyCards ARE the navigation (no tabs): a metric-chip header
 *  (gen · pending · drift), the collapsible digest row, the generations
 *  strip, latest sessions, then the cards. Card click → drill-in. */
export function Dashboard({ zuzuuBin }: { zuzuuBin: boolean }) {
  const openFaculty = useRightPanel((s) => s.openFaculty);
  const openReview = useReviewOpen((s) => s.setOpen);

  const status = useQuery({ queryKey: ["zuzuu", "status"], queryFn: zuzuuApi.status, refetchInterval: 4000 });
  const faculties = useQuery({ queryKey: ["zuzuu", "faculties"], queryFn: zuzuuApi.faculties, refetchInterval: 8000 });
  const evalQ = useQuery({ queryKey: ["zuzuu", "eval"], queryFn: zuzuuApi.evalRanked, refetchInterval: 8000 });
  // item previews per faculty — parallel, shared keys with the drill-in views
  const details = useQueries({
    queries: FACULTY_ORDER.map((key) => ({
      queryKey: ["zuzuu", "faculty", key],
      queryFn: () => zuzuuApi.faculty(key),
      refetchInterval: 8000,
    })),
  });
  const detailOf = (i: number): FacultyDetail | undefined => details[i]?.data;

  const actionsDetail = detailOf(FACULTY_ORDER.indexOf("actions"));
  const reviewCount = pendingReviewCount(evalQ.data?.ranked ?? [], actionsDetail?.proposals ?? []);
  const pendingTotal = status.data ? Object.values(status.data.pending).reduce((a, b) => a + b, 0) : 0;
  const drift = status.data?.drift?.dirty ?? false;

  return (
    <div className="flex flex-col gap-4 p-3">
      {!zuzuuBin && (
        <div className="rounded-[var(--radius-sm)] border border-warn/40 bg-[color-mix(in_oklab,var(--color-warn)_10%,transparent)] px-3 py-2 text-ui text-warn">
          zuzuu CLI required — <code>npm i -g @zuzuucodes/cli</code>
        </div>
      )}

      {/* header zone: gen · pending · drift + the review entry point */}
      <div className="flex flex-wrap items-center gap-1.5">
        <MetricChip label="⚡" value={status.data?.activeGeneration ?? "no gen"} title="active generation" />
        <MetricChip
          label="pending"
          value={String(pendingTotal)}
          tone={pendingTotal > 0 ? "pending" : "default"}
          title="proposals awaiting your review"
        />
        {drift && <MetricChip label="⚠" value="drift" tone="pending" title="drift detected — run zuzuu doctor" />}
        {reviewCount > 0 && (
          <Button size="sm" variant="primary" className="ml-auto" onClick={() => openReview(true)}>
            Review {reviewCount}
          </Button>
        )}
      </div>

      <DigestPanel compact collapsible />
      <GenerationsTimeline />
      <SessionsList limit={3} />

      {/* the five faculties — the cards ARE the navigation */}
      <div className="flex flex-col gap-2">
        {FACULTY_ORDER.map((key, i) => {
          const summary = faculties.data?.faculties.find((f) => f.key === key);
          const detail = detailOf(i);
          return (
            <FacultyCard
              key={key}
              facultyKey={key}
              count={summary?.count ?? detail?.items.length ?? 0}
              pending={summary?.pending ?? detail?.proposals.length ?? 0}
              items={detail?.items ?? []}
              proposals={detail?.proposals ?? []}
              onOpen={() => openFaculty(key)}
            />
          );
        })}
      </div>
    </div>
  );
}
