import { StatusPill, cx } from "../../components/ui";
import { moduleHue, type ModuleDisplay } from "./kit";
import { versionLabel } from "./vocab";

/** One module in the §3 grid — Copy.ai card model: large hue icon chip,
 *  faculty name as the primary sans hero, one-line description (teach),
 *  item count as a calm secondary line, amber StatusPill only when pending>0,
 *  neutral "vN" version chip when a version exists. The whole card is the click
 *  target; hover lifts it via the existing motion tokens. No hue on the card
 *  background — hue lives only on the icon chip. */
export function ModuleTile({
  id,
  display,
  count,
  pending,
  generation,
  onOpen,
}: {
  id: string;
  display: ModuleDisplay;
  count: number;
  pending: number;
  /** active generation id for this module (e.g. "gen_006"), if any */
  generation?: string | null;
  onOpen: () => void;
}) {
  const hue = moduleHue(id);
  // Short readable version label: "gen_006" → "v6", "gen_1" → "v1"
  const genLabel = generation ? versionLabel(generation) : null;

  return (
    <button
      onClick={onOpen}
      style={{ ["--hue" as string]: hue }}
      className={cx(
        "wc-focus group relative flex w-full flex-col items-start gap-3 overflow-hidden",
        "rounded-[var(--radius-dialog)] border border-border bg-surface px-5 pb-5 pt-5 text-left",
        "transition-[transform,border-color,box-shadow] duration-150 ease-out",
        "hover:-translate-y-0.5 hover:border-[color-mix(in_oklab,var(--hue)_45%,var(--color-border))]",
        "hover:shadow-[0_6px_20px_-10px_color-mix(in_oklab,var(--hue)_70%,transparent)]",
      )}
      title={pending > 0 ? `Open ${display.label} — ${pending} pending review` : `Open ${display.label}`}
    >
      {/* icon chip: large, hue-tinted, no hue wash on the card itself */}
      <span
        className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-dialog)] transition-colors duration-150"
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

      {/* name + description */}
      <div className="flex w-full min-w-0 flex-col gap-1">
        <span className="wc-sans text-title font-semibold text-ink-100">{display.label}</span>
        <span className="wc-sans line-clamp-2 text-ui text-ink-500">{display.teach}</span>
      </div>

      {/* secondary line: count + status pills */}
      <div className="flex w-full flex-wrap items-center gap-1.5">
        <span className="wc-sans text-meta text-ink-500">
          {count === 0 ? "empty" : `${count} ${count === 1 ? "item" : "items"}`}
        </span>
        {pending > 0 && (
          <StatusPill tone="warn">{pending} pending</StatusPill>
        )}
        {genLabel && (
          <StatusPill tone="neutral">{genLabel}</StatusPill>
        )}
      </div>
    </button>
  );
}
