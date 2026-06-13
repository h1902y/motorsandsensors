import { useState } from "react";
import type { ProposalSummary } from "@zuzuu-web/protocol";
import { Button } from "../components/ui";
import { confidencePill } from "../modules/proposal-evidence";
import { ProposalDetail } from "./ProposalDetail";

const TONE_TEXT = {
  success: "text-[color-mix(in_oklab,var(--color-success)_82%,white)]",
  warning: "text-[color-mix(in_oklab,var(--color-pending)_82%,white)]",
  neutral: "text-ink-500",
} as const;

/** One pending proposal: collapsed = title + confidence pill; click → expands
 *  inline to the shared WHAT/WHY/WHAT-HAPPENS detail with Approve/Reject right
 *  there (not hover-only icons). The same mutations as the review ceremony. */
export function ProposalRow({
  data,
  onApprove,
  onReject,
  isAction = false,
  busy = false,
  approving = false,
}: {
  data: ProposalSummary;
  onApprove?: () => void;
  onReject?: () => void;
  isAction?: boolean;
  busy?: boolean;
  /** true while this proposal's approval is in flight — plays the dissolve */
  approving?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const pill = confidencePill(data.confidence, data.score);

  return (
    <div className={`border-b border-border last:border-0 ${approving ? "wc-approve-out" : ""}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 py-1.5 text-left text-ui"
      >
        <span className="shrink-0 text-meta text-ink-600">{open ? "▾" : "▸"}</span>
        <span className="wc-sans min-w-0 flex-1 truncate text-ink-200">{data.title}</span>
        {!isAction && (
          <span className={`shrink-0 text-meta ${TONE_TEXT[pill.tone]}`} title={`score ${data.score ?? "?"}`}>
            {pill.level}
          </span>
        )}
        {isAction && <span className="shrink-0 text-meta text-ink-600">action</span>}
      </button>
      {open && (
        <div className="pb-3 pl-5 pr-1">
          <ProposalDetail
            data={{
              id: data.id,
              module: data.module,
              title: data.title,
              kind: data.kind,
              preview: data.preview,
              score: data.score,
              confidence: data.confidence,
              rationale: data.rationale,
              signals: data.signals,
              evidence: data.evidence,
              isAction,
            }}
          />
          {(onApprove || onReject) && (
            <div className="mt-3 flex items-center gap-2">
              {onApprove && (
                <Button variant="primary" disabled={busy} onClick={onApprove}>Approve</Button>
              )}
              {/* Reject is text-only, de-emphasized — never a red slab */}
              {onReject && (
                <Button variant="danger" disabled={busy} onClick={onReject} className="!border-0 !bg-transparent px-1">
                  Reject
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
