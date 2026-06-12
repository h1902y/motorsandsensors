import { cx } from "../../components/ui";

/** A small inline metric: label · value · optional delta (dashboard header). */
export function MetricChip({
  label,
  value,
  delta,
  tone = "default",
  title,
}: {
  label: string;
  value: string;
  delta?: string;
  tone?: "default" | "ok" | "pending";
  title?: string;
}) {
  const valueColor =
    tone === "ok" ? "text-status-ok" : tone === "pending" ? "text-status-pending" : "text-ink-100";
  return (
    <span
      title={title}
      className="inline-flex items-baseline gap-1 rounded-ui border border-border bg-surface px-2 py-0.5 text-meta"
    >
      <span className="text-ink-500">{label}</span>
      <span className={cx("font-medium", valueColor)}>{value}</span>
      {delta && <span className="text-ink-500">{delta}</span>}
    </span>
  );
}
