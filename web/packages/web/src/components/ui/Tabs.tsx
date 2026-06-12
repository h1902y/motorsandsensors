import type { ReactNode } from "react";
import { cx } from "./primitives";

/** Horizontal tab strip living inside a Bar (sidebar modes, terminal/editor tabs). */
export function TabBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("flex h-full items-stretch", className)}>{children}</div>;
}

export function Tab({
  active,
  onClick,
  onClose,
  dirty,
  leading,
  trailing,
  title,
  children,
  className,
}: {
  active: boolean;
  onClick: () => void;
  onClose?: () => void;
  /** show a dirty dot in place of the × until hovered */
  dirty?: boolean;
  leading?: ReactNode;
  /** small controls rendered before the close button (e.g. a preview toggle) */
  trailing?: ReactNode;
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cx(
        "group/tab relative flex max-w-52 items-center gap-1.5 px-3 text-ui transition-colors",
        active
          ? "bg-app text-ink-100"
          : "text-ink-400 hover:bg-hover hover:text-ink-200",
        className,
      )}
    >
      {/* active underline */}
      {active && <span className="absolute inset-x-0 -bottom-px h-px bg-accent" />}
      {leading}
      <span className="truncate">{children}</span>
      {trailing}
      {onClose && (
        <span
          role="button"
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-[var(--radius-sm)] text-ink-500 hover:bg-elevated hover:text-ink-100"
        >
          {dirty ? (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-ink-300 group-hover/tab:hidden" />
              <span className="hidden text-meta group-hover/tab:inline">×</span>
            </>
          ) : (
            <span className="text-meta">×</span>
          )}
        </span>
      )}
    </button>
  );
}

/** A pill-style mode switch (Files / Search / Git) filling a Bar. */
export function ModeTabs<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex h-full items-stretch">
      {options.map((mode) => (
        <button
          key={mode}
          onClick={() => onChange(mode)}
          className={cx(
            "relative px-2.5 text-meta uppercase tracking-wider transition-colors",
            value === mode ? "text-ink-100" : "text-ink-500 hover:text-ink-300",
          )}
        >
          {value === mode && <span className="absolute inset-x-1.5 -bottom-px h-px bg-accent" />}
          {mode}
        </button>
      ))}
    </div>
  );
}
