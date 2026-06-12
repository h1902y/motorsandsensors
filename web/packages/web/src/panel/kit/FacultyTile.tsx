import { cx } from "../../components/ui";
import type { FacultyDisplay } from "./kit";

/** One faculty in the §3 grid — a compact square card: icon · name · count,
 *  with an amber pending dot when proposals await review. The WHOLE tile is
 *  the click target → that faculty's drill-in. */
export function FacultyTile({
  display,
  count,
  pending,
  onOpen,
}: {
  display: FacultyDisplay;
  count: number;
  pending: number;
  onOpen: () => void;
}) {
  return (
    <button
      onClick={onOpen}
      className="wc-focus group relative flex aspect-square w-full flex-col items-center justify-center gap-1.5 rounded-ui border border-border bg-surface p-card text-center transition-colors hover:border-border-strong hover:bg-hover"
      title={pending > 0 ? `Open ${display.label} — ${pending} pending review` : `Open ${display.label}`}
    >
      {pending > 0 && (
        <span
          className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-status-pending"
          aria-label={`${pending} pending`}
        />
      )}
      <svg
        viewBox="0 0 16 16"
        className="h-5 w-5 text-ink-300 transition-colors group-hover:text-ink-100"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      >
        <path d={display.icon} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="text-ui font-medium text-ink-100">{display.label}</span>
      <span className={cx("text-meta", count > 0 ? "text-ink-500" : "text-ink-600")}>
        {count === 0 ? "empty" : count}
      </span>
    </button>
  );
}
