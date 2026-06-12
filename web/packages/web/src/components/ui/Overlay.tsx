import { useEffect, type ReactNode } from "react";
import { cx } from "./primitives";

/**
 * The single standardized floating-surface system. Every dialog and the
 * command palette render through Overlay + Dialog so backdrop, surface,
 * curvature, border, and elevation are identical everywhere.
 */
export function Overlay({
  onClose,
  children,
  align = "center",
  className,
  z = 70,
}: {
  onClose: () => void;
  children: ReactNode;
  /** vertical placement of the dialog within the viewport */
  align?: "center" | "top";
  className?: string;
  /** stacking — raise for dialogs that must sit above other overlays */
  z?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{ zIndex: z }}
      className={cx(
        "fixed inset-0 flex justify-center bg-black/65 backdrop-blur-[3px]",
        align === "top" ? "items-start pt-[12vh]" : "items-center",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** The standardized card surface: one bg, one hairline, one curvature, one shadow. */
export function Dialog({
  children,
  className,
  width = "md",
}: {
  children: ReactNode;
  className?: string;
  width?: "sm" | "md" | "lg";
}) {
  const w = width === "sm" ? "max-w-md" : width === "lg" ? "max-w-2xl" : "max-w-lg";
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{ boxShadow: "var(--shadow-dialog)" }}
      className={cx(
        "w-full overflow-hidden rounded-[var(--radius-dialog)] border border-border bg-elevated",
        w,
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Optional dialog header row (title + optional close). */
export function DialogHeader({ title, onClose }: { title: ReactNode; onClose?: () => void }) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
      <span className="text-body font-semibold text-ink-100">{title}</span>
      {onClose && (
        <button onClick={onClose} className="ml-auto rounded-[var(--radius-sm)] p-1 text-ink-500 hover:text-ink-100" title="Close">
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M4 4l8 8m0-8l-8 8" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  );
}
