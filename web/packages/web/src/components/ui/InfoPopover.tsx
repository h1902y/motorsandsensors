// A small ⓘ button that toggles a calm popover (title + body). Dismiss on
// outside-click or Esc. For teaching the evolution-engine nouns in place.
import { useEffect, useState, type ReactNode } from "react";
import { cx } from "./primitives";

export function InfoDot({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <span className={cx("relative inline-flex", className)}>
      <button
        type="button"
        aria-label={`What is ${title}?`}
        onClick={() => setOpen((v) => !v)}
        className="wc-focus flex h-4 w-4 items-center justify-center rounded-full text-ink-500 transition-colors hover:text-ink-200"
      >
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
          <circle cx="8" cy="8" r="6" /><path d="M8 7.5v3M8 5.4v.1" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <>
          <span className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <span
            role="tooltip"
            className="absolute left-1/2 top-full z-50 mt-1 w-64 -translate-x-1/2 rounded-[var(--radius-ui)] border border-border bg-elevated p-3 text-left shadow-[var(--shadow-menu)]"
          >
            <span className="wc-sans block text-ui font-medium text-ink-100">{title}</span>
            <span className="wc-sans mt-1 block text-meta leading-relaxed text-ink-400">{children}</span>
          </span>
        </>
      )}
    </span>
  );
}
