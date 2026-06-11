import type { ProposalSummary } from "@zuzuu-web/protocol";

/** One pending proposal, read-only (approval happens via the zuzuu CLI). */
export function ProposalRow({ data }: { data: ProposalSummary }) {
  return (
    <div className="flex items-baseline gap-2 border-b border-border py-1.5 text-ui last:border-0">
      <span className="shrink-0 text-meta text-ink-500">{data.faculty}</span>
      <span className="truncate text-ink-300">{data.title}</span>
    </div>
  );
}
