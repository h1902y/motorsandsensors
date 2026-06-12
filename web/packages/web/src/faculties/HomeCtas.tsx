import { useQuery } from "@tanstack/react-query";
import { zuzuuApi } from "../lib/zuzuu-api";
import { Button } from "../components/ui";
import { useReviewOpen } from "../state/review";
import { useView } from "../state/view";
import { pendingReviewCount } from "./review-queue";
import { StartAgentButton } from "./StartAgentButton";

/** The Home surface's primary actions: start a wrapped agent session in a
 *  fresh terminal, enter the review ceremony, or drop into the workbench. */
export function HomeCtas() {
  const evalQ = useQuery({ queryKey: ["zuzuu", "eval"], queryFn: zuzuuApi.evalRanked, refetchInterval: 8000 });
  const actionsQ = useQuery({ queryKey: ["zuzuu", "faculty", "actions"], queryFn: () => zuzuuApi.faculty("actions"), refetchInterval: 8000 });
  const openReview = useReviewOpen((s) => s.setOpen);
  const setView = useView((s) => s.setMode);

  // same combined count as StatusHeader's Review badge
  const reviewCount = pendingReviewCount(evalQ.data?.ranked ?? [], actionsQ.data?.proposals ?? []);

  return (
    <div className="flex items-center gap-2">
      <StartAgentButton />
      {reviewCount > 0 && (
        <Button onClick={() => openReview(true)}>
          Review {reviewCount} proposal{reviewCount === 1 ? "" : "s"}
        </Button>
      )}
      <Button variant="ghost" onClick={() => setView("ide")}>
        Open workbench
      </Button>
    </div>
  );
}
