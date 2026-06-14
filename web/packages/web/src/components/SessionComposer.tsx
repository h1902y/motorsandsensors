// The session composer — the chat-style bottom bar that starts agent
// sessions: a quiet host pill (icon + name) opens a dropdown picker;
// the send button morphs to stop while an agent is alive. Enter starts
// the selected host (or focuses an alive session) exactly as before.
import { createPortal } from "react-dom";
import { forwardRef, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { zuzuuApi } from "../lib/zuzuu-api";
import { buildHostRows, composerDefaultHost, hostSpawnSpec, type HostRow } from "../modules/host-launch";
import { startAgentSession } from "../lib/agent-launch";
import { useSessions } from "../state/sessions";
import { Bar, Button, Kbd, Spinner, cx } from "./ui";

// ── host glyph paths (16×16 stroke) — one per host, identity-only ─────────
// These glyphs appear only in the picker and the host pill — not as status.
const HOST_GLYPHS: Record<string, string> = {
  // Claude: A-shape letterform (anthropic-ish)
  claude: "M8 2.5L3 13.5h3l1-2.5h4l1 2.5h3L8 2.5zM5.5 9l2.5-5 2.5 5",
  // Gemini: four-point star / diamond cross
  gemini: "M8 2v5M8 9v5M2 8h5M9 8h5",
  // Codex: code brackets < >
  codex: "M5.5 4L2.5 8l3 4M10.5 4l3 4-3 4",
  // pi: the greek letter π
  pi: "M3.5 5.5H12.5M6.5 5.5v7M10 5.5c0 3.5-.5 5.5-2 7",
  // OpenCode: terminal prompt >_
  opencode: "M3 4l3.5 4L3 12M8.5 12H13",
};

/** One-line description for each host shown in the picker dropdown. */
const HOST_DESC: Record<string, string> = {
  claude: "Anthropic's coding agent — strong reasoning and editing",
  gemini: "Google's CLI agent — multimodal and fast iteration",
  codex: "OpenAI's coding agent — tight IDE integration",
  pi: "pi — the lightweight owned harness (stage 3)",
  "zuzuu code": "OpenCode bundled — always available, no install needed",
};

/** Map a row command to its glyph/desc key. */
function hostKey(command: string): string {
  return command === "zuzuu code" ? "opencode" : command;
}

export function startHostRow(rowCommand: string): void {
  const spec = hostSpawnSpec(rowCommand);
  // Single-active-agent rule lives in startAgentSession: while one is
  // alive, picking a host focuses it instead of spawning a second one.
  if (spec) void startAgentSession(spec).catch((err: Error) => window.alert(err.message));
}

// ── warm suggestion chips — seeded from the module surface ──────────────────
// Shown only in the first-run / resting state (no sessions alive or open).
// Clicking a chip launches the currently-selected host (the same as pressing
// Enter) — they surface the module story without forcing it.
const SUGGESTION_CHIPS = [
  { label: "Recall what you know", title: "Start a session to recall stored knowledge" },
  { label: "Run an action", title: "Start a session to run a saved action or runbook" },
  { label: "Review proposals", title: "Start a session to review pending module proposals" },
] as const;

// ── HostPill ─────────────────────────────────────────────────────────────────
// The quiet pill that summarises the selected host. Clicking opens the picker.
function HostPill({
  label,
  command,
  pillRef,
  expanded,
  onClick,
}: {
  label: string;
  command: string;
  pillRef: React.RefObject<HTMLButtonElement | null>;
  expanded: boolean;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const glyph = HOST_GLYPHS[hostKey(command)];
  return (
    <button
      ref={pillRef}
      onClick={onClick}
      aria-haspopup="menu"
      aria-expanded={expanded}
      title={`Host: ${label} — click to change`}
      className={cx(
        "wc-sans wc-focus flex shrink-0 items-center gap-1.5",
        "rounded-[var(--radius-ui)] border border-border bg-elevated px-2 py-1",
        "text-meta text-ink-200 transition-colors hover:border-border-strong hover:text-ink-100",
      )}
    >
      {glyph && (
        <svg
          viewBox="0 0 16 16"
          className="h-3 w-3 shrink-0 text-ink-400"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
        >
          <path d={glyph} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      <span>{label}</span>
      {/* chevron-down */}
      <svg
        viewBox="0 0 16 16"
        className="h-3 w-3 shrink-0 text-ink-500"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      >
        <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

// ── HostPickerMenu ────────────────────────────────────────────────────────────
// A portal menu that opens above the composer (the bar lives at the bottom).
// Two-line rows: label (+ "not installed" badge) + a one-line description.
// Mirrors MenuPopover's portal/close behavior without reusing it because we
// need the two-line row shape that MenuItem.hint can't express.
function HostPickerMenu({
  rows,
  anchorEl,
  onSelect,
  onClose,
}: {
  rows: HostRow[];
  anchorEl: HTMLElement | null;
  onSelect: (command: string) => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Measure and place the menu above the anchor (the pill button).
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el || !anchorEl) return;
    const anchor = anchorEl.getBoundingClientRect();
    const mw = el.offsetWidth;
    const mh = el.offsetHeight;
    const GAP = 4;
    // Prefer opening above the pill; never go off-screen.
    let top = anchor.top - GAP - mh;
    if (top < 8) top = anchor.bottom + GAP; // flip below if no room above
    // Align left edge of menu with pill, clamp to viewport.
    let left = anchor.left;
    left = Math.max(8, Math.min(left, window.innerWidth - 8 - mw));
    setPos({ left, top });
  }, [anchorEl]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t)) return;
      if (anchorEl?.contains(t)) return; // let the pill's own click toggle
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
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
  }, [anchorEl, onClose]);

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      style={{
        position: "fixed",
        left: pos?.left ?? 0,
        top: pos?.top ?? 0,
        visibility: pos ? undefined : "hidden",
        boxShadow: "var(--shadow-menu)",
      }}
      onClick={(e) => e.stopPropagation()}
      className="wc-pop-in z-[80] w-64 overflow-hidden rounded-[var(--radius-ui)] border border-border bg-elevated py-1"
    >
      <div className="wc-eyebrow px-3 py-1.5">Host</div>
      {rows.map((row) => {
        const glyph = HOST_GLYPHS[hostKey(row.command)];
        const desc = HOST_DESC[row.command] ?? "";
        return (
          <button
            key={row.command}
            role="menuitem"
            aria-disabled={!row.detected || undefined}
            onClick={() => {
              if (!row.detected) return;
              onSelect(row.command);
              onClose();
            }}
            className={cx(
              "flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors",
              row.detected ? "hover:bg-hover" : "cursor-default opacity-50",
            )}
          >
            {glyph ? (
              <svg
                viewBox="0 0 16 16"
                className={cx(
                  "mt-0.5 h-3.5 w-3.5 shrink-0",
                  row.detected ? "text-ink-300" : "text-ink-600",
                )}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
              >
                <path d={glyph} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <span className="mt-0.5 w-3.5 shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <div
                className={cx(
                  "wc-sans text-ui font-medium",
                  row.detected ? "text-ink-100" : "text-ink-500",
                )}
              >
                {row.label}
                {!row.detected && (
                  <span className="ml-1.5 text-meta font-normal text-ink-600">not installed</span>
                )}
              </div>
              {desc && (
                <div className="wc-sans mt-0.5 text-meta leading-relaxed text-ink-500">{desc}</div>
              )}
            </div>
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

// ── SessionComposer ───────────────────────────────────────────────────────────
export const SessionComposer = forwardRef<HTMLDivElement>(function SessionComposer(_props, ref) {
  const hostsQ = useQuery({ queryKey: ["zuzuu", "hosts"], queryFn: zuzuuApi.hosts, refetchInterval: 8000 });
  const rows = buildHostRows(hostsQ.data?.hosts ?? []);
  const dflt = composerDefaultHost(rows);

  // The actively-selected host (defaults to the first detected row).
  const [selectedCommand, setSelectedCommand] = useState<string | null>(null);
  const activeCommand = selectedCommand ?? dflt?.command ?? null;
  const activeRow = rows.find((r) => r.command === activeCommand) ?? dflt;

  // Alive agent session — drives the send→stop morph.
  const { tabs, close } = useSessions();
  const aliveTab = tabs.find((t) => t.type === "agent" && t.alive);
  const isRunning = Boolean(aliveTab);

  // Host-picker state + pill anchor ref.
  const pillRef = useRef<HTMLButtonElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Warm empty state: no tabs open and no session running.
  const showEmptyState = tabs.length === 0 && !isRunning;

  function launchActive() {
    if (activeRow) startHostRow(activeRow.command);
  }

  function handleStop() {
    if (aliveTab) void close(aliveTab.id).catch(() => {});
  }

  return (
    <div
      ref={ref}
      tabIndex={0}
      className="wc-focus outline-none"
      onKeyDown={(e) => {
        if (e.key === "Enter" && !isRunning && activeRow) {
          e.preventDefault();
          launchActive();
        }
      }}
    >
      {/* ── warm empty state ─────────────────────────────────────────────
          A brief greeting + 3 module-seeded suggestion chips. Chips fire
          launchActive() on click — same path as pressing Enter. Shown only
          when there are no open tabs so it disappears once a session starts. */}
      {showEmptyState && (
        <div className="border-t border-border bg-surface px-4 py-3">
          <p className="wc-sans mb-2 text-ui text-ink-400">
            Pick a host and press <Kbd>↵</Kbd> to start a session — your agent is ready.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTION_CHIPS.map((chip) => (
              <button
                key={chip.label}
                title={chip.title}
                onClick={launchActive}
                className={cx(
                  "wc-sans wc-focus inline-flex items-center rounded-full",
                  "border border-border px-2.5 py-0.5 text-meta text-ink-300",
                  "transition-colors hover:border-border-strong hover:text-ink-100",
                )}
              >
                {chip.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── composer bar ────────────────────────────────────────────────── */}
      <Bar border="t" surface="surface" className="!h-auto !min-h-[var(--height-bar)] gap-2 py-1.5">
        {/* host pill — quiet, sans, opens the picker dropdown on click */}
        {activeRow ? (
          <HostPill
            label={activeRow.label}
            command={activeRow.command}
            pillRef={pillRef}
            expanded={pickerOpen}
            onClick={(e) => {
              e.stopPropagation();
              setPickerOpen((v) => !v);
            }}
          />
        ) : (
          /* still loading detected hosts from the daemon */
          <div className="flex items-center gap-1.5 px-2">
            <Spinner />
            <span className="wc-sans text-meta text-ink-500">Loading hosts…</span>
          </div>
        )}

        {/* spacer pushes keyboard hint + action button to the right */}
        <div className="flex-1" />

        {/* keyboard hint — hidden on narrow viewports */}
        {!isRunning && activeRow && (
          <span className="wc-sans hidden shrink-0 items-center gap-1 text-meta text-ink-600 sm:flex">
            <Kbd>↵</Kbd> {activeRow.label}
          </span>
        )}

        {/* send → stop morph:
            • resting: primary "Start" button (accent — the one place accent appears)
            • running: danger "Stop" button closes the alive session tab */}
        {isRunning ? (
          <Button
            variant="danger"
            size="sm"
            onClick={handleStop}
            title="Stop the running session"
            className="shrink-0"
          >
            {/* square stop glyph */}
            <svg viewBox="0 0 16 16" className="h-3 w-3" fill="currentColor">
              <rect x="4" y="4" width="8" height="8" rx="1" />
            </svg>
            Stop
          </Button>
        ) : (
          <Button
            variant="primary"
            size="sm"
            disabled={!activeRow}
            onClick={launchActive}
            title={activeRow ? `Start ${activeRow.label}` : "No host available"}
            className="shrink-0"
          >
            {/* up-arrow send glyph */}
            <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M8 13V3M4 7l4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Start
          </Button>
        )}
      </Bar>

      {/* host picker — portal-rendered above the pill, closes on outside click */}
      {pickerOpen && (
        <HostPickerMenu
          rows={rows}
          anchorEl={pillRef.current}
          onSelect={(command) => {
            setSelectedCommand(command);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
});
