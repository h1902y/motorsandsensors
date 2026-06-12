import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
 * Opens on click; closes on item click, outside-click, Escape, or scroll —
 * never on mouseleave. While open the button carries `data-menu-open` so
 * hover-revealed hosts (file-tree rows) can keep it visible.
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
  const btnRef = useRef<HTMLButtonElement>(null);
  return (
    <div className="relative">
      <button
        ref={btnRef}
        title={title}
        data-menu-open={open || undefined}
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
      {open && (
        <MenuPopover items={items} onClose={() => setOpen(false)} anchorEl={btnRef.current} ignore={btnRef} align={align} />
      )}
    </div>
  );
}

const VIEWPORT_PAD = 8;
const ANCHOR_GAP = 4;

/**
 * The floating menu list. Renders into a portal on <body> with fixed
 * positioning so it can never be clipped or painted over by transformed /
 * scrolling ancestors (the virtualized file-tree rows each create a stacking
 * context via translateY — an inline absolute menu loses to later siblings).
 *
 * Anchor either to an element (`anchorEl` — a ⋯ button / dropdown trigger;
 * the menu opens under it, flipping above when out of room) or to a point
 * (`x`/`y` — context menus). Closes on outside-click, Escape, scroll, resize.
 */
export function MenuPopover({
  items,
  onClose,
  align = "right",
  x,
  y,
  anchorEl,
  ignore,
}: {
  items: MenuItem[];
  onClose: () => void;
  align?: "left" | "right";
  /** point anchor (context menus) — viewport coordinates */
  x?: number;
  y?: number;
  /** element anchor — the menu opens under this element */
  anchorEl?: HTMLElement | null;
  /** mousedowns inside this element don't count as outside-clicks (lets the trigger's own click toggle the menu closed) */
  ignore?: React.RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // measure after first paint, then place clamped inside the viewport
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const mw = el.offsetWidth;
    const mh = el.offsetHeight;
    let left: number;
    let top: number;
    if (anchorEl) {
      const r = anchorEl.getBoundingClientRect();
      left = align === "left" ? r.left : r.right - mw;
      top = r.bottom + ANCHOR_GAP;
      // not enough room below → flip above the anchor
      if (top + mh > window.innerHeight - VIEWPORT_PAD) top = r.top - ANCHOR_GAP - mh;
    } else {
      left = x ?? 0;
      top = y ?? 0;
    }
    left = Math.max(VIEWPORT_PAD, Math.min(left, window.innerWidth - VIEWPORT_PAD - mw));
    top = Math.max(VIEWPORT_PAD, Math.min(top, window.innerHeight - VIEWPORT_PAD - mh));
    setPos({ left, top });
  }, [anchorEl, align, x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      if (ignore?.current?.contains(t)) return; // let the trigger's click toggle
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // the menu is fixed-positioned: any scroll underneath would leave it
    // floating at a stale spot — close instead (native-menu behavior)
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && ref.current?.contains(e.target)) return;
      onClose();
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose, ignore]);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={{
        position: "fixed",
        left: pos?.left ?? 0,
        top: pos?.top ?? 0,
        visibility: pos ? undefined : "hidden",
        boxShadow: "var(--shadow-menu)",
      }}
      onClick={(e) => e.stopPropagation()}
      className="z-[80] min-w-44 overflow-hidden rounded-[var(--radius-ui)] border border-border bg-elevated py-1"
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
    </div>,
    document.body,
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
  const menu = pt ? <MenuPopover items={items} x={pt.x} y={pt.y} onClose={() => setPt(null)} /> : null;
  return { onContextMenu, menu };
}
