import type { ProposalSummary } from "@zuzuu-web/protocol";
import { IconButton } from "../components/ui";

/** One pending proposal, with optional inline approve/reject actions. */
export function ProposalRow({
  data,
  onApprove,
  onReject,
}: {
  data: ProposalSummary;
  onApprove?: () => void;
  onReject?: () => void;
}) {
  return (
    <div className="group flex items-center gap-2 border-b border-border py-1 text-ui last:border-0">
      <span className="shrink-0 text-meta text-ink-500">{data.faculty}</span>
      <span className="truncate text-ink-300">{data.title}</span>
      {(onApprove || onReject) && (
        <span className="ml-auto flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          {onApprove && (
            <IconButton title="Approve" iconPath="M3 8.5l3.5 3.5L13 4.5" className="hover:!text-accent" onClick={onApprove} />
          )}
          {onReject && (
            <IconButton title="Reject" iconPath="M4 4l8 8m0-8l-8 8" className="hover:!text-danger" onClick={onReject} />
          )}
        </span>
      )}
    </div>
  );
}
