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
type ButtonVariant = "primary" | "ghost" | "subtle" | "danger";
type ButtonSize = "sm" | "md";

const BTN_BASE =
  "wc-focus inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-sm)] font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap";
const BTN_VARIANT: Record<ButtonVariant, string> = {
  primary: "border border-accent-dim bg-[color-mix(in_oklab,var(--color-accent)_14%,transparent)] text-accent hover:bg-[color-mix(in_oklab,var(--color-accent)_22%,transparent)]",
  ghost: "text-ink-300 hover:bg-hover hover:text-ink-100",
  subtle: "border border-border text-ink-200 hover:border-border-strong hover:text-ink-100",
  danger: "text-danger hover:bg-[color-mix(in_oklab,var(--color-danger)_16%,transparent)]",
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
