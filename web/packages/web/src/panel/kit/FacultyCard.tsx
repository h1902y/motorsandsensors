import type { FacultyItem, FacultyKey, ProposalSummary } from "@zuzuu-web/protocol";
import { cx } from "../../components/ui";
import { ItemRow } from "./ItemRow";
import { FACULTY_META, cardStatus, latestUpdate, relativeTime } from "./kit";

const STATUS_BAR: Record<ReturnType<typeof cardStatus>, string> = {
  ok: "bg-status-ok",
  pending: "bg-status-pending",
  empty: "bg-status-empty",
};

const PREVIEW_MAX = 3;

/** One faculty's dashboard card — the verified 6-element anatomy:
 *  ① 3px top status bar (pending amber > ok green > empty gray)
 *  ② row: faculty icon · name · count · chevron (decorative)
 *  ③ meta line ("updated 2h ago · N pending")
 *  ④ up to 3 item mini-rows (pending proposals first, then items)
 *  ⑤ "view all N ›"
 *  ⑥ the WHOLE card is the click target (hover bg) → drill-in. */
export function FacultyCard({
  facultyKey,
  count,
  pending,
  items,
  proposals,
  onOpen,
}: {
  facultyKey: FacultyKey;
  count: number;
  pending: number;
  items: FacultyItem[];
  proposals: ProposalSummary[];
  onOpen: () => void;
}) {
  const meta = FACULTY_META[facultyKey];
  const status = cardStatus(count, pending);
  const updated = relativeTime(latestUpdate(items));
  const metaParts = [
    ...(updated ? [`updated ${updated}`] : []),
    ...(pending > 0 ? [`${pending} pending`] : []),
  ];
  const previewProposals = proposals.slice(0, PREVIEW_MAX);
  const previewItems = items.slice(0, Math.max(0, PREVIEW_MAX - previewProposals.length));

  return (
    <button
      onClick={onOpen}
      className="wc-focus group w-full overflow-hidden rounded-ui border border-border bg-surface text-left transition-colors hover:bg-hover"
      title={`Open ${meta.label}`}
    >
      <div className={cx("h-[3px] w-full", STATUS_BAR[status])} />
      <div className="flex flex-col gap-1.5 p-card">
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0 text-ink-300" fill="none" stroke="currentColor" strokeWidth="1.4">
            <path d={meta.icon} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-ui font-medium text-ink-100">{meta.label}</span>
          <span className="text-meta text-ink-500">{count}</span>
          {/* decorative — the whole card is the click target */}
          <svg viewBox="0 0 16 16" className="ml-auto h-3.5 w-3.5 shrink-0 text-ink-600 transition-colors group-hover:text-ink-300" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
            <path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        {metaParts.length > 0 && (
          <div className={cx("text-meta", pending > 0 ? "text-status-pending" : "text-ink-500")}>
            {metaParts.join(" · ")}
          </div>
        )}
        {(previewProposals.length > 0 || previewItems.length > 0) && (
          <div className="flex flex-col">
            {previewProposals.map((p) => (
              <ItemRow key={`p-${p.id}`} kind="proposal" title={p.title} status="pending" compact />
            ))}
            {previewItems.map((it) => (
              <ItemRow
                key={it.id}
                kind={it.kind}
                title={it.title}
                status={it.status === "archived" ? "archived" : undefined}
                timestamp={it.updated_at ?? it.created_at}
                compact
              />
            ))}
          </div>
        )}
        {count > PREVIEW_MAX && (
          <div className="text-meta text-ink-500 transition-colors group-hover:text-accent">
            view all {count} ›
          </div>
        )}
      </div>
    </button>
  );
}
