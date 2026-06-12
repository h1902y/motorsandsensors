import { useQuery } from "@tanstack/react-query";
import { zuzuuApi } from "../lib/zuzuu-api";
import { Button, StatusDot } from "../components/ui";
import { useReviewOpen } from "../state/review";
import { pendingReviewCount } from "../faculties/review-queue";

/** The Pulse tab's top line: active generation · pending total · drift · the
 *  Review entry point. (Renders only when a zuzuu home exists.) */
export function StatusHeader() {
  const status = useQuery({ queryKey: ["zuzuu", "status"], queryFn: zuzuuApi.status, refetchInterval: 4000 });
  const evalQ = useQuery({ queryKey: ["zuzuu", "eval"], queryFn: zuzuuApi.evalRanked, refetchInterval: 8000 });
  const actionsQ = useQuery({ queryKey: ["zuzuu", "faculty", "actions"], queryFn: () => zuzuuApi.faculty("actions"), refetchInterval: 8000 });
  const openReview = useReviewOpen((s) => s.setOpen);
  // the same combined queue the ceremony walks (eval-ranked + action inbox, deduped)
  const reviewCount = pendingReviewCount(evalQ.data?.ranked ?? [], actionsQ.data?.proposals ?? []);

  const pendingTotal = status.data ? Object.values(status.data.pending).reduce((a, b) => a + b, 0) : 0;
  const drift = status.data?.drift?.dirty ?? false;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-ui">
      <StatusDot tone={drift ? "warn" : "ok"} title={drift ? "drift detected" : "in sync"} />
      <span className="font-medium text-ink-100">
        {status.data?.activeGeneration ?? "no generation yet"}
      </span>
      <span className="text-ink-500">·</span>
      <span className="text-ink-300">{pendingTotal} pending</span>
      {drift && <span className="text-warn">· ⚠ drift (run zuzuu doctor)</span>}
      {reviewCount > 0 && (
        <Button size="sm" variant="primary" className="ml-auto" onClick={() => openReview(true)}>
          Review {reviewCount}
        </Button>
      )}
    </div>
  );
}
