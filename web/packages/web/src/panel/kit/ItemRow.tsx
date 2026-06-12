import { cx } from "../../components/ui";
import { kindIcon, relativeTime } from "./kit";

/** The universal envelope-item row: kind icon · title (truncate) · status
 *  badge (pending = amber, archived = gray) · relative timestamp. The WHOLE
 *  row is the click target; without onClick it renders as a static preview
 *  (so cards can nest it inside their own click target). */
export function ItemRow({
  kind,
  title,
  status,
  timestamp,
  onClick,
  compact = false,
  titleAttr,
}: {
  kind: string | undefined;
  title: string;
  /** active | archived | pending (pending = a proposal awaiting review) */
  status?: string | undefined;
  /** ISO timestamp (updated_at ?? created_at) */
  timestamp?: string | null | undefined;
  onClick?: (() => void) | undefined;
  compact?: boolean;
  titleAttr?: string | undefined;
}) {
  const rel = relativeTime(timestamp);
  const inner = (
    <>
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 text-ink-500" fill="none" stroke="currentColor" strokeWidth="1.4">
        <path d={kindIcon(kind)} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="min-w-0 truncate text-ink-300">{title}</span>
      {status === "pending" && (
        <span className="shrink-0 rounded-full bg-[color-mix(in_oklab,var(--color-status-pending)_16%,transparent)] px-1.5 text-meta leading-4 text-status-pending">
          pending
        </span>
      )}
      {status === "archived" && (
        <span className="shrink-0 rounded-full bg-hover px-1.5 text-meta leading-4 text-ink-500">archived</span>
      )}
      {rel && <span className="ml-auto shrink-0 text-meta text-ink-600">{rel}</span>}
    </>
  );
  const layout = cx(
    "flex w-full min-w-0 items-center gap-2 text-left text-ui",
    compact ? "py-0.5" : "border-b border-border py-1 last:border-0",
  );
  if (!onClick) return <div className={layout} title={titleAttr}>{inner}</div>;
  return (
    <button onClick={onClick} className={cx(layout, "transition-colors hover:bg-hover")} title={titleAttr}>
      {inner}
    </button>
  );
}
