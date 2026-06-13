import { cx } from "../../components/ui";
import { moduleHue, type ModuleDisplay } from "./kit";

/** One module in the §3 grid — a compact tile: a large hue-carrying icon over
 *  name (sans) + count (mono), with an amber pending dot when proposals await
 *  review. Shorter than before (the user asked for "cards slightly smaller,
 *  icons bigger"); the whole tile is the click target → that module's drill-in.
 *  Hover lifts the tile and warms a soft glow in the module's own hue. */
export function ModuleTile({
  id,
  display,
  count,
  pending,
  onOpen,
}: {
  id: string;
  display: ModuleDisplay;
  count: number;
  pending: number;
  onOpen: () => void;
}) {
  const hue = moduleHue(id);
  return (
    <button
      onClick={onOpen}
      style={{ ["--hue" as string]: hue }}
      className={cx(
        "wc-focus group relative flex w-full flex-col items-start gap-2 overflow-hidden rounded-ui",
        "border border-border bg-surface px-3 pb-2.5 pt-3 text-left",
        "transition-[transform,border-color,box-shadow] duration-150 ease-out",
        "hover:-translate-y-0.5 hover:border-[color-mix(in_oklab,var(--hue)_45%,var(--color-border))]",
        "hover:shadow-[0_6px_20px_-10px_color-mix(in_oklab,var(--hue)_70%,transparent)]",
      )}
      title={pending > 0 ? `Open ${display.label} — ${pending} pending review` : `Open ${display.label}`}
    >
      {/* a faint hue wash that warms on hover — the tile's identity tint */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
        style={{ background: "radial-gradient(120% 90% at 12% 0%, color-mix(in oklab, var(--hue) 14%, transparent), transparent 60%)" }}
      />
      {pending > 0 && (
        <span
          className="wc-pulse-once absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-status-pending shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-status-pending)_18%,transparent)]"
          aria-label={`${pending} pending`}
        />
      )}
      {/* the icon: enlarged, tinted to the module hue, in a soft hue chip */}
      <span
        className="relative flex h-9 w-9 items-center justify-center rounded-[10px] transition-colors duration-150"
        style={{
          background: "color-mix(in oklab, var(--hue) 13%, transparent)",
          boxShadow: "inset 0 0 0 1px color-mix(in oklab, var(--hue) 22%, transparent)",
        }}
      >
        <svg
          viewBox="0 0 16 16"
          className="h-[22px] w-[22px]"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.35"
          style={{ color: "var(--hue)" }}
        >
          <path d={display.icon} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="relative flex w-full items-baseline justify-between gap-2">
        <span className="wc-sans text-title font-semibold text-ink-100">{display.label}</span>
        <span className={cx("font-mono text-meta tabular-nums", count > 0 ? "text-ink-500" : "text-ink-600")}>
          {count === 0 ? "empty" : count}
        </span>
      </span>
    </button>
  );
}
