import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { zuzuuApi } from "../lib/zuzuu-api";
import { launchInTerminal } from "../lib/agent-launch";
import { Button, MenuPopover, type MenuItem } from "../components/ui";
import { useReviewOpen } from "../state/review";
import { useView } from "../state/view";
import { pendingReviewCount } from "./review-queue";
import { buildHostRows } from "./host-launch";

/** The Home surface's primary actions: start a wrapped agent session in a
 *  fresh terminal, enter the review ceremony, or drop into the workbench. */
export function HomeCtas() {
  const hostsQ = useQuery({ queryKey: ["zuzuu", "hosts"], queryFn: zuzuuApi.hosts, refetchInterval: 8000 });
  const evalQ = useQuery({ queryKey: ["zuzuu", "eval"], queryFn: zuzuuApi.evalRanked, refetchInterval: 8000 });
  const actionsQ = useQuery({ queryKey: ["zuzuu", "faculty", "actions"], queryFn: () => zuzuuApi.faculty("actions"), refetchInterval: 8000 });
  const openReview = useReviewOpen((s) => s.setOpen);
  const setView = useView((s) => s.setMode);
  const [hostsOpen, setHostsOpen] = useState(false);

  // same combined count as StatusHeader's Review badge
  const reviewCount = pendingReviewCount(evalQ.data?.ranked ?? [], actionsQ.data?.proposals ?? []);

  const hostItems: MenuItem[] = buildHostRows(hostsQ.data?.hosts ?? []).map((row) => ({
    label: row.label,
    disabled: !row.detected,
    hint: row.detected ? undefined : "not installed",
    onClick: () => void launchInTerminal(row.command),
  }));

  return (
    <div className="flex items-center gap-2">
      <div className="relative">
        <Button variant="primary" onClick={() => setHostsOpen((v) => !v)}>
          Start agent session <span className="opacity-70">▾</span>
        </Button>
        {hostsOpen && <MenuPopover items={hostItems} align="left" onClose={() => setHostsOpen(false)} />}
      </div>
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
