import { useEffect, useRef, useState } from "react";

export interface MenuItem {
  label: string;
  onClick: () => void;
  /** SVG path data for a 16×16 icon */
  iconPath?: string;
  danger?: boolean;
  /** render a divider above this item */
  separated?: boolean;
  /** greyed and non-clickable (e.g. a host that isn't installed) */
  disabled?: boolean;
  /** right-aligned meta text (e.g. "not installed") */
  hint?: string;
}

/**
 * A single ⋯ overflow button that opens a popover of actions. The same item
 * set can also be opened by right-clicking the host element (see useContextMenu).
 * Closes on outside-click and Escape.
 */
export function ActionMenu({
  items,
  className = "",
  title = "More actions",
  align = "right",
  iconPath,
}: {
  items: MenuItem[];
  className?: string;
  title?: string;
  align?: "left" | "right";
  /** stroked icon path; defaults to the ⋯ dots */
  iconPath?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        title={title}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={`flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-ink-400 hover:bg-hover hover:text-ink-100 ${className}`}
      >
        {iconPath ? (
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d={iconPath} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor">
            <circle cx="3" cy="8" r="1.3" />
            <circle cx="8" cy="8" r="1.3" />
            <circle cx="13" cy="8" r="1.3" />
          </svg>
        )}
      </button>
      {open && <MenuPopover items={items} onClose={() => setOpen(false)} anchor="button" align={align} />}
    </div>
  );
}

/** The floating menu list. `anchor="button"` positions under a ⋯; coords position at a point. */
export function MenuPopover({
  items,
  onClose,
  anchor = "button",
  align = "right",
  x,
  y,
}: {
  items: MenuItem[];
  onClose: () => void;
  anchor?: "button" | "point";
  align?: "left" | "right";
  x?: number;
  y?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const positioned =
    anchor === "point"
      ? ({ position: "fixed", left: x, top: y, boxShadow: "var(--shadow-menu)" } as const)
      : ({ position: "absolute", [align]: 0, top: "100%", boxShadow: "var(--shadow-menu)" } as const);

  return (
    <div
      ref={ref}
      style={positioned}
      onClick={(e) => e.stopPropagation()}
      className="z-[80] mt-1 min-w-44 overflow-hidden rounded-[var(--radius-ui)] border border-border bg-elevated py-1"
    >
      {items.map((item, i) => (
        <div key={item.label}>
          {item.separated && i > 0 && <div className="my-1 border-t border-border" />}
          <button
            disabled={item.disabled}
            onClick={(e) => {
              e.stopPropagation();
              if (item.disabled) return;
              item.onClick();
              onClose();
            }}
            className={`flex w-full items-center gap-2 px-3 py-1 text-left text-ui ${
              item.disabled
                ? "cursor-default text-ink-600"
                : `hover:bg-hover ${item.danger ? "text-danger hover:text-danger" : "text-ink-200 hover:text-ink-100"}`
            }`}
          >
            {item.iconPath ? (
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.4">
                <path d={item.iconPath} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <span className="w-3.5 shrink-0" />
            )}
            {item.label}
            {item.hint && <span className="ml-auto pl-4 text-meta text-ink-600">{item.hint}</span>}
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * Wire right-click on a row to open the same item set as a point-anchored menu.
 * Returns an `onContextMenu` handler and the menu element to render.
 */
export function useContextMenu(items: MenuItem[]) {
  const [pt, setPt] = useState<{ x: number; y: number } | null>(null);
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setPt({ x: e.clientX, y: e.clientY });
  };
  const menu = pt ? (
    <MenuPopover items={items} anchor="point" x={pt.x} y={pt.y} onClose={() => setPt(null)} />
  ) : null;
  return { onContextMenu, menu };
}
