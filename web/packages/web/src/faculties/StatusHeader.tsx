import { useQuery } from "@tanstack/react-query";
import { zuzuuApi } from "../lib/zuzuu-api";
import { Button, StatusDot } from "../components/ui";
import { useReviewOpen } from "../state/review";
import { pendingReviewCount } from "./review-queue";

/** The dashboard's top line: active generation · pending total · drift · the
 *  Review entry point, plus the no-home and CLI-absent notices. */
export function StatusHeader() {
  const status = useQuery({ queryKey: ["zuzuu", "status"], queryFn: zuzuuApi.status, refetchInterval: 4000 });
  const health = useQuery({ queryKey: ["zuzuu", "health"], queryFn: zuzuuApi.health, refetchInterval: 8000 });
  const evalQ = useQuery({ queryKey: ["zuzuu", "eval"], queryFn: zuzuuApi.evalRanked, refetchInterval: 8000 });
  const actionsQ = useQuery({ queryKey: ["zuzuu", "faculty", "actions"], queryFn: () => zuzuuApi.faculty("actions"), refetchInterval: 8000 });
  const openReview = useReviewOpen((s) => s.setOpen);
  // the same combined queue the ceremony walks (eval-ranked + action inbox, deduped)
  const reviewCount = pendingReviewCount(evalQ.data?.ranked ?? [], actionsQ.data?.proposals ?? []);

  if (status.data && status.data.home === false) {
    return (
      <div className="rounded-ui border border-border bg-surface p-4 text-ui text-ink-300">
        No zuzuu home here — run <code className="text-accent">zuzuu init</code> in this project.
      </div>
    );
  }

  const pendingTotal = status.data ? Object.values(status.data.pending).reduce((a, b) => a + b, 0) : 0;
  const drift = status.data?.drift?.dirty ?? false;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-3 text-ui">
        <StatusDot tone={drift ? "warn" : "ok"} title={drift ? "drift detected" : "in sync"} />
        <span className="font-medium text-ink-100">
          {status.data?.activeGeneration ?? "no generation yet"}
        </span>
        <span className="text-ink-500">·</span>
        <span className="text-ink-300">{pendingTotal} pending your approval</span>
        {drift && <span className="text-warn">· ⚠ drift (run zuzuu doctor)</span>}
        {reviewCount > 0 && (
          <Button size="sm" variant="primary" className="ml-auto" onClick={() => openReview(true)}>
            Review {reviewCount}
          </Button>
        )}
      </div>
      {health.data && health.data.zuzuuBin === false && (
        <div className="text-meta text-ink-500">showing file data only (zuzuu CLI not found on PATH)</div>
      )}
    </div>
  );
}
