import { useState } from "react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";

/** Tiny classname joiner. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

// ── Bar ───────────────────────────────────────────────────────────────
/** The one canonical 34px bar used by every header, footer, and tab strip. */
export function Bar({
  children,
  border,
  className,
  surface = "surface",
}: {
  children: ReactNode;
  /** which side gets a hairline border */
  border?: "b" | "t" | "none";
  className?: string;
  surface?: "surface" | "app" | "elevated" | "transparent";
}) {
  const bg =
    surface === "app" ? "bg-app" : surface === "elevated" ? "bg-elevated" : surface === "transparent" ? "" : "bg-surface";
  const line = border === "t" ? "border-t border-border" : border === "none" ? "" : "border-b border-border";
  return <div className={cx("wc-bar", bg, line, className)}>{children}</div>;
}

// ── Button ────────────────────────────────────────────────────────────
type ButtonVariant = "primary" | "ghost" | "subtle" | "danger" | "secondary";
type ButtonSize = "sm" | "md";

const BTN_BASE =
  "wc-sans wc-focus inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-sm)] font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap";
const BTN_VARIANT: Record<ButtonVariant, string> = {
  primary: "border border-accent-dim bg-[color-mix(in_oklab,var(--color-accent)_14%,transparent)] text-accent hover:bg-[color-mix(in_oklab,var(--color-accent)_22%,transparent)]",
  ghost: "text-ink-300 hover:bg-hover hover:text-ink-100",
  subtle: "border border-border text-ink-200 hover:border-border-strong hover:text-ink-100",
  danger: "text-danger hover:bg-[color-mix(in_oklab,var(--color-danger)_16%,transparent)]",
  secondary: "border border-border text-ink-200 hover:bg-hover hover:text-ink-100",
};
const BTN_SIZE: Record<ButtonSize, string> = {
  sm: "h-6 px-2 text-meta",
  md: "h-7 px-3 text-ui",
};

export function Button({
  variant = "subtle",
  size = "md",
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button className={cx(BTN_BASE, BTN_VARIANT[variant], BTN_SIZE[size], className)} {...rest} />;
}

/** Icon-only square button with a consistent hit area. */
export function IconButton({
  iconPath,
  active,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { iconPath: string; active?: boolean }) {
  return (
    <button
      className={cx(
        "wc-focus flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] transition-colors",
        active ? "text-accent" : "text-ink-400 hover:bg-hover hover:text-ink-100",
        className,
      )}
      {...rest}
    >
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
        <path d={iconPath} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

// ── Field / Textarea ──────────────────────────────────────────────────
export function Field({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx("wc-input w-full px-2 py-1.5", className)} {...rest} />;
}
export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx("wc-input w-full resize-none px-2 py-1.5", className)} {...rest} />;
}

// ── Segmented (Edit | Preview) ────────────────────────────────────────
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex overflow-hidden rounded-[var(--radius-sm)] border border-border">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "px-2 py-0.5 text-meta transition-colors",
            o.value === value ? "bg-hover text-ink-100" : "text-ink-400 hover:text-ink-200",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Kbd ───────────────────────────────────────────────────────────────
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-[var(--radius-sm)] border border-border bg-elevated px-1.5 py-0.5 font-mono text-meta text-ink-300">
      {children}
    </kbd>
  );
}

// ── StatusDot ─────────────────────────────────────────────────────────
export function StatusDot({
  tone,
  pulse,
  title,
}: {
  tone: "ok" | "warn" | "bad" | "idle";
  pulse?: boolean;
  title?: string;
}) {
  const color = tone === "ok" ? "bg-accent" : tone === "warn" ? "bg-warn" : tone === "bad" ? "bg-danger" : "bg-ink-500";
  return <span title={title} className={cx("h-1.5 w-1.5 shrink-0 rounded-full", color, pulse && "animate-pulse")} />;
}

// ── Spinner ───────────────────────────────────────────────────────────
export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx("h-3.5 w-3.5 animate-spin text-ink-500", className)} viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeOpacity="0.25" />
      <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// ── Receipt — a one-line tool/event record, expandable to detail ───────
export function Receipt({
  icon, label, meta, tone = "default", children,
}: {
  icon: string; label: ReactNode; meta?: ReactNode;
  tone?: "default" | "ok" | "warn" | "bad";
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const dot = tone === "ok" ? "text-success" : tone === "warn" ? "text-warn" : tone === "bad" ? "text-error" : "text-ink-400";
  const headerContent = (
    <>
      <svg viewBox="0 0 16 16" className={cx("h-3.5 w-3.5 shrink-0", dot)} fill="none" stroke="currentColor" strokeWidth="1.4">
        <path d={icon} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="min-w-0 flex-1 truncate text-ui text-ink-100">{label}</span>
      {meta && <span className="wc-mono shrink-0 text-meta text-ink-500">{meta}</span>}
      <svg viewBox="0 0 16 16" className={cx("h-3 w-3 shrink-0 text-ink-500 transition-transform", open && "rotate-90")} fill="none" stroke="currentColor" strokeWidth="1.4">
        <path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </>
  );
  return (
    <div className="rounded-[var(--radius-ui)]">
      {children ? (
        <button
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="wc-focus flex w-full items-center gap-2 rounded-[var(--radius-ui)] px-2 py-1.5 text-left hover:bg-hover"
        >
          {headerContent}
        </button>
      ) : (
        <div className="flex w-full items-center gap-2 px-2 py-1.5 hover:bg-hover">
          <svg viewBox="0 0 16 16" className={cx("h-3.5 w-3.5 shrink-0", dot)} fill="none" stroke="currentColor" strokeWidth="1.4">
            <path d={icon} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="min-w-0 flex-1 truncate text-ui text-ink-100">{label}</span>
          {meta && <span className="wc-mono shrink-0 text-meta text-ink-500">{meta}</span>}
        </div>
      )}
      {open && children && <div className="wc-receipt-expand px-3 pb-2 pl-9">{children}</div>}
    </div>
  );
}

// ── PropertyRow — label · value, for the detail rail ───────────────────
export function PropertyRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="shrink-0 text-meta text-ink-500">{label}</span>
      <span className="min-w-0 truncate text-right text-ui text-ink-200">{children}</span>
    </div>
  );
}

// ── StatusPill / Count ─────────────────────────────────────────────────
const PILL_TONE: Record<string, string> = {
  ok: "text-success bg-[color-mix(in_oklab,var(--color-success)_14%,transparent)]",
  warn: "text-warn bg-[color-mix(in_oklab,var(--color-warn)_14%,transparent)]",
  bad: "text-error bg-[color-mix(in_oklab,var(--color-error)_14%,transparent)]",
  info: "text-info bg-[color-mix(in_oklab,var(--color-info)_14%,transparent)]",
  neutral: "text-ink-300 bg-hover",
};
export function StatusPill({ tone = "neutral", children }: { tone?: keyof typeof PILL_TONE; children: ReactNode }) {
  return <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-meta font-medium", PILL_TONE[tone])}>{children}</span>;
}
export function Count({ children }: { children: ReactNode }) {
  return <span className="inline-flex min-w-4 items-center justify-center rounded-full bg-hover px-1.5 text-meta text-ink-300">{children}</span>;
}

// ── HeroNumber — the one-large-numeral-per-card treatment ──────────────
export function HeroNumber({ value, unit }: { value: ReactNode; unit?: string }) {
  return (
    <div className="flex items-baseline gap-1">
      <span className="text-hero font-semibold tracking-tight text-ink-100 tabular-nums">{value}</span>
      {unit && <span className="text-meta text-ink-500">{unit}</span>}
    </div>
  );
}

// ── ProgressBar ────────────────────────────────────────────────────────
export function ProgressBar({ value, tone = "neutral" }: { value: number; tone?: "neutral" | "ok" | "warn" | "bad" }) {
  const fill = tone === "ok" ? "bg-success" : tone === "warn" ? "bg-warn" : tone === "bad" ? "bg-error" : "bg-ink-500";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-hover">
      <div className={cx("h-full rounded-full transition-[width] duration-500", fill)} style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} />
    </div>
  );
}

// ── Toast — quiet auto-dismissing confirmation ─────────────────────────
export function Toast({ children }: { children: ReactNode }) {
  return (
    <div className="wc-toast-in fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-[var(--radius-ui)] border border-border bg-elevated px-3 py-2 text-ui text-ink-100 shadow-[var(--shadow-menu)]">
      {children}
    </div>
  );
}

// ── CoachMark — anchored, dismissible, N of M ──────────────────────────
export function CoachMark({ step, total, children, onDismiss }: { step: number; total: number; children: ReactNode; onDismiss: () => void }) {
  return (
    <div className="wc-pop-in max-w-xs rounded-[var(--radius-ui)] border border-border bg-elevated p-3 shadow-[var(--shadow-menu)]">
      <div className="text-ui text-ink-100">{children}</div>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-meta text-ink-500">{step} of {total}</span>
        <Button size="sm" variant="ghost" onClick={onDismiss}>Got it</Button>
      </div>
    </div>
  );
}
