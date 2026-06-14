import { useEffect, useMemo, useRef, useState } from "react";
import { Command } from "cmdk";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Workflow } from "@zuzuu-web/protocol";
import { api } from "../lib/api";
import { useSessions } from "../state/sessions";
import { useExplorer } from "../state/explorer";
import { useBlocks } from "../state/blocks";
import { termRegistry } from "../term/registry";
import { Overlay, CoachMark, Kbd } from "../components/ui";
import { kindIcon, MODULE_ORDER, MODULE_META } from "../panel/kit/kit";
import { useRightPanel } from "../state/right-panel";
import { DIGEST_PATH } from "../panel/module-paths";

/**
 * ⌘K blended command-first palette:
 *   - Grouped by kind, quiet uppercase cmdk group labels
 *   - Two-line rows (primary label + muted description)
 *   - Leading kind-icon per row (16×16 SVG stroke, never font-mono)
 *   - Right-aligned Kbd shortcut hints on top actions
 *   - Persistent footer legend (↑↓ · ↵ · esc)
 *   - Never-blank open state: Recent sessions + Suggested actions
 *   - One-time coach-mark (localStorage key `zuzuu:palette-coachmark-dismissed`)
 */

const COACH_KEY = "zuzuu:palette-coachmark-dismissed";

// ── tiny icon path constants ──────────────────────────────────────────
const ICON = {
  search:  "M7 13A6 6 0 107 1a6 6 0 000 12M13 13l-2.5-2.5",
  run:     "M3 4l3.5 4L3 12M8.5 12H13",
  flow:    "M9 1.5L3.5 9H7l-.5 5.5L12 7H8.5L9 1.5",
  term:    "M2.5 3.5h11v9h-11zM5 6.5l2.5 2-2.5 2",
  vault:   "M8 2l4.5 1.8v3.5c0 3-1.9 5.1-4.5 6.2-2.6-1.1-4.5-3.2-4.5-6.2V3.8L8 2",
  rec:     "M8 5a3 3 0 110 6 3 3 0 010-6M2.5 8a5.5 5.5 0 1011 0 5.5 5.5 0 00-11 0M8 8v.01",
  fs:      "M8 2.5v11M2.5 8h11",
  digest:  "M4 2.5v11M4 3.5h7.5L9.5 6l2 2.5H4",
} as const;

/** Small leading icon for a palette row — 16×16 stroke, never mono. */
function RowIcon({ path, color }: { path: string; color?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 shrink-0"
      fill="none"
      stroke={color ?? "currentColor"}
      strokeWidth="1.4"
      aria-hidden
    >
      <path d={path} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Optional small colored chip — used only on rows belonging to a module
 * module (knowledge / memory / actions / instructions / guardrails).
 * The chip is the *only* place module hue appears; it is a small marker,
 * not a card fill or text color.
 */
function ModuleChip({ moduleId }: { moduleId: string }) {
  const meta = MODULE_META[moduleId as keyof typeof MODULE_META];
  if (!meta) return null;
  // Map moduleId to CSS variable for the hue swatch dot
  const hueVar = `var(--color-module-${moduleId})`;
  return (
    <span
      className="mr-1.5 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full"
      style={{ backgroundColor: hueVar }}
      title={meta.label}
      aria-label={meta.label}
    />
  );
}

/** Two-line palette row item. */
function Item({
  children,
  value,
  onSelect,
}: {
  children: React.ReactNode;
  value?: string;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] px-2 py-2 text-ink-100 data-[selected=true]:bg-hover"
    >
      {children}
    </Command.Item>
  );
}

/** Primary label + optional muted description (two-line row body). */
function RowBody({
  label,
  desc,
  shortcut,
}: {
  label: React.ReactNode;
  desc?: string;
  shortcut?: string[];
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <div className="min-w-0 flex-1">
        <div className="truncate text-body text-ink-100">{label}</div>
        {desc && (
          <div className="truncate text-meta text-ink-500">{desc}</div>
        )}
      </div>
      {shortcut && shortcut.length > 0 && (
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {shortcut.map((k) => (
            <Kbd key={k}>{k}</Kbd>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Coach-mark state helpers ──────────────────────────────────────────

function isCoachDismissed(): boolean {
  try {
    return localStorage.getItem(COACH_KEY) === "1";
  } catch {
    return true; // if localStorage is unavailable, skip
  }
}

function dismissCoach(): void {
  try {
    localStorage.setItem(COACH_KEY, "1");
  } catch {
    // ignore
  }
}

// ── Suggested actions (static, no API) ───────────────────────────────

interface SuggestedAction {
  id: string;
  label: string;
  desc: string;
  icon: string;
  shortcut?: string[];
  run: () => void;
}

export function CommandPalette({
  open,
  mode = "all",
  onClose,
  onRunWorkflow,
}: {
  open: boolean;
  /** "history" opens directly into run-recent-command (⌘R) */
  mode?: "all" | "history";
  onClose: () => void;
  onRunWorkflow: (wf: Workflow) => void;
}) {
  const [searchValue, setSearchValue] = useState("");
  const [coachDismissed, setCoachDismissed] = useState(true);
  const [hasOpened, setHasOpened] = useState(false);
  const queryClient = useQueryClient();
  const openPreviewPath = useExplorer((s) => s.openPreviewPath);
  const openSearch = useExplorer((s) => s.openSearch);
  const openModule = useRightPanel((s) => s.openModule);
  const blockHistory = useBlocks((s) => s.history);
  const { tabs, activeId, setActive, create } = useSessions();

  const files = useQuery({
    queryKey: ["files"],
    queryFn: api.listFiles,
    enabled: open && mode === "all",
    staleTime: 30_000,
  });
  const workflows = useQuery({
    queryKey: ["workflows"],
    queryFn: api.listWorkflows,
    enabled: open && mode === "all",
    staleTime: 10_000,
  });
  const shellHist = useQuery({
    queryKey: ["history"],
    queryFn: api.history,
    enabled: open,
    staleTime: 15_000,
  });

  // session blocks first (most relevant), then shell-history file, deduped
  const history = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const c of [...blockHistory, ...(shellHist.data?.commands ?? [])]) {
      const t = c.trim();
      if (t && !seen.has(t)) {
        seen.add(t);
        out.push(t);
      }
    }
    return out;
  }, [blockHistory, shellHist.data]);

  // Alt held at selection time → insert-without-run for recent commands
  const altRef = useRef(false);

  // On first open, check if coach-mark has been dismissed
  useEffect(() => {
    if (open && !hasOpened) {
      setHasOpened(true);
      setCoachDismissed(isCoachDismissed());
    }
  }, [open, hasOpened]);

  useEffect(() => {
    if (!open) setSearchValue("");
  }, [open]);

  if (!open) return null;

  const historyOnly = mode === "history";

  const run = (fn: () => void) => {
    fn();
    onClose();
  };
  const sendToTerminal = (cmd: string) =>
    termRegistry.get(activeId)?.sendInput(`\x15${cmd}\r`);
  const insertToTerminal = (cmd: string) =>
    termRegistry.get(activeId)?.sendInput(`\x15${cmd}`);

  // ── Never-blank suggested actions ───────────────────────────────────
  // Shown when query is empty. These are static UX affordances — no API.
  const suggestedActions: SuggestedAction[] = [
    {
      id: "digest",
      label: "Open today's digest",
      desc: "Your session-start brief — instructions, pending proposals, knowledge",
      icon: ICON.digest,
      run: () => openPreviewPath(DIGEST_PATH),
    },
    {
      id: "switch-vault",
      label: "Switch vault…",
      desc: "Open a different project folder in the workbench",
      icon: ICON.vault,
      shortcut: ["⌘", "⇧O"],
      run: () => window.dispatchEvent(new Event("zuzuu-web:open-vault-picker")),
    },
    {
      id: "new-session",
      label: "New terminal session",
      desc: "Open a fresh PTY in a new tab",
      icon: ICON.term,
      run: () => void create(),
    },
    {
      id: "save-recording",
      label: "Save session recording (.cast)",
      desc: "Export the current terminal session as an asciicast file",
      icon: ICON.rec,
      run: () => window.dispatchEvent(new Event("zuzuu-web:save-recording")),
    },
    {
      id: "refresh-files",
      label: "Refresh files",
      desc: "Re-scan the workspace file tree",
      icon: ICON.fs,
      run: () => {
        void queryClient.invalidateQueries({ queryKey: ["dir"] });
        void queryClient.invalidateQueries({ queryKey: ["files"] });
      },
    },
  ];

  // Recent sessions (the tabs already in state) — shown in never-blank state
  const recentSessions = tabs.slice(0, 5);

  // Determine whether to show the never-blank state
  const isEmpty = searchValue.trim().length === 0;

  return (
    <Overlay onClose={onClose} align="top">
      {/* Coach-mark — first-open only, positioned above the dialog */}
      {!coachDismissed && !historyOnly && (
        <div className="mb-2 w-full max-w-xl">
          <CoachMark
            step={1}
            total={1}
            onDismiss={() => {
              dismissCoach();
              setCoachDismissed(true);
            }}
          >
            Press <Kbd>⌘K</Kbd> anytime to run any <span className="text-ink-100">zz command</span> — try typing a module name.
          </CoachMark>
        </div>
      )}

      <Command
        label="Command palette"
        className="w-full max-w-xl overflow-hidden rounded-[var(--radius-dialog)] border border-border bg-elevated"
        style={{ boxShadow: "var(--shadow-dialog)" }}
        onClick={(e) => e.stopPropagation()}
        loop
      >
        {/* ── Input ── */}
        <Command.Input
          autoFocus
          value={searchValue}
          onValueChange={setSearchValue}
          onKeyDown={(e) => (altRef.current = e.altKey)}
          placeholder={
            historyOnly
              ? "Run a recent command… (Alt+Enter inserts without running)"
              : "Type a command or search…"
          }
          className="w-full border-b border-border bg-transparent px-4 py-3 text-body text-ink-100 placeholder:text-ink-500 focus:outline-none"
        />

        {/* ── Results ── */}
        <Command.List className="max-h-[50vh] overflow-auto p-1.5">
          <Command.Empty className="px-3 py-6 text-center text-ui text-ink-500">
            No matches — try a module name, file, or command
          </Command.Empty>

          {/* ── Never-blank: recent sessions + suggested actions (empty query) ── */}
          {!historyOnly && isEmpty && recentSessions.length > 0 && (
            <Command.Group heading="Recent sessions">
              {recentSessions.map((t) => (
                <Item
                  key={`s-${t.id}`}
                  value={`session ${t.title} ${t.id}`}
                  onSelect={() => run(() => setActive(t.id))}
                >
                  <RowIcon path={ICON.term} />
                  <RowBody
                    label={t.title}
                    desc={t.id === activeId ? "Active session" : undefined}
                  />
                </Item>
              ))}
            </Command.Group>
          )}

          {!historyOnly && isEmpty && (
            <Command.Group heading="Suggested">
              {suggestedActions.map((a) => (
                <Item key={a.id} value={`suggested ${a.id} ${a.label}`} onSelect={() => run(a.run)}>
                  <RowIcon path={a.icon} />
                  <RowBody label={a.label} desc={a.desc} shortcut={a.shortcut} />
                </Item>
              ))}
            </Command.Group>
          )}

          {/* ── Module shortcuts (empty query, never-blank) ── */}
          {!historyOnly && isEmpty && (
            <Command.Group heading="Go to module">
              {MODULE_ORDER.map((moduleId) => {
                const meta = MODULE_META[moduleId];
                return (
                  <Item
                    key={`mod-${moduleId}`}
                    value={`module ${moduleId} ${meta.label}`}
                    onSelect={() => run(() => openModule(moduleId))}
                  >
                    <ModuleChip moduleId={moduleId} />
                    <RowIcon path={meta.icon} />
                    <RowBody label={meta.label} desc={meta.teach} />
                  </Item>
                );
              })}
            </Command.Group>
          )}

          {/* ── Filtered: search shortcut ── */}
          {!historyOnly && !isEmpty && searchValue.trim().length >= 2 && (
            <Command.Group heading="Search">
              <Item onSelect={() => run(() => openSearch(searchValue.trim()))}>
                <RowIcon path={ICON.search} />
                <RowBody label={`"${searchValue.trim()}" in workspace`} desc="Full-text search across all files" />
              </Item>
            </Command.Group>
          )}

          {/* ── History / recent commands ── */}
          {history.length > 0 && (
            <Command.Group heading={historyOnly ? "Recent commands" : "History"}>
              {history.slice(0, historyOnly ? 200 : 8).map((cmd, i) => (
                <Item
                  key={`h-${i}`}
                  value={`history ${cmd}`}
                  onSelect={() =>
                    run(() =>
                      altRef.current ? insertToTerminal(cmd) : sendToTerminal(cmd),
                    )
                  }
                >
                  <RowIcon path={ICON.run} />
                  <RowBody
                    label={<span className="wc-mono">{cmd}</span>}
                    desc={
                      historyOnly
                        ? "Alt+Enter to insert without running"
                        : undefined
                    }
                  />
                </Item>
              ))}
            </Command.Group>
          )}

          {/* ── Workflows ── */}
          {!historyOnly && (workflows.data?.workflows.length ?? 0) > 0 && (
            <Command.Group heading="Workflows">
              {workflows.data!.workflows.map((wf) => (
                <Item
                  key={`w-${wf.name}`}
                  value={`workflow ${wf.name} ${wf.command}`}
                  onSelect={() => run(() => onRunWorkflow(wf))}
                >
                  <RowIcon path={ICON.flow} />
                  <RowBody
                    label={wf.name}
                    desc={wf.description ?? wf.command}
                  />
                </Item>
              ))}
            </Command.Group>
          )}

          {/* ── Files ── */}
          {!historyOnly && (
            <Command.Group heading="Files">
              {(files.data?.files ?? []).slice(0, 500).map((f) => (
                <Item
                  key={`f-${f}`}
                  value={`file ${f}`}
                  onSelect={() => run(() => openPreviewPath(f))}
                >
                  <RowIcon path={kindIcon("fact")} />
                  <RowBody label={f} />
                </Item>
              ))}
            </Command.Group>
          )}

          {/* ── Sessions ── (filtered mode: show all, not just top 5) */}
          {!historyOnly && !isEmpty && (
            <Command.Group heading="Sessions">
              {tabs.map((t) => (
                <Item
                  key={`s-${t.id}`}
                  value={`session ${t.title} ${t.id}`}
                  onSelect={() => run(() => setActive(t.id))}
                >
                  <RowIcon path={ICON.term} />
                  <RowBody
                    label={t.title}
                    desc={t.id === activeId ? "Active session" : undefined}
                  />
                </Item>
              ))}
              <Item value="new terminal session" onSelect={() => run(() => void create())}>
                <RowIcon path={ICON.term} />
                <RowBody label="New terminal session" desc="Open a fresh PTY in a new tab" />
              </Item>
            </Command.Group>
          )}

          {/* ── Workspace actions ── (filtered mode only — appear in Suggested when empty) */}
          {!historyOnly && !isEmpty && (
            <Command.Group heading="Workspace">
              <Item
                value="switch vault workspace open folder"
                onSelect={() =>
                  run(() => window.dispatchEvent(new Event("zuzuu-web:open-vault-picker")))
                }
              >
                <RowIcon path={ICON.vault} />
                <RowBody
                  label="Switch vault…"
                  desc="Open a different project folder"
                  shortcut={["⌘", "⇧O"]}
                />
              </Item>
              <Item
                value="save session recording cast asciicast"
                onSelect={() =>
                  run(() => window.dispatchEvent(new Event("zuzuu-web:save-recording")))
                }
              >
                <RowIcon path={ICON.rec} />
                <RowBody
                  label="Save session recording (.cast)"
                  desc="Export terminal as asciicast file"
                />
              </Item>
              <Item
                value="refresh files reload tree"
                onSelect={() =>
                  run(() => {
                    void queryClient.invalidateQueries({ queryKey: ["dir"] });
                    void queryClient.invalidateQueries({ queryKey: ["files"] });
                  })
                }
              >
                <RowIcon path={ICON.fs} />
                <RowBody label="Refresh files" desc="Re-scan the workspace file tree" />
              </Item>
            </Command.Group>
          )}
        </Command.List>

        {/* ── Persistent footer legend ── */}
        <div className="flex items-center gap-3 border-t border-border px-3 py-2">
          <span className="flex items-center gap-1 text-meta text-ink-500">
            <Kbd>↑</Kbd><Kbd>↓</Kbd> navigate
          </span>
          <span className="flex items-center gap-1 text-meta text-ink-500">
            <Kbd>↵</Kbd> run
          </span>
          <span className="flex items-center gap-1 text-meta text-ink-500">
            <Kbd>esc</Kbd> close
          </span>
        </div>
      </Command>
    </Overlay>
  );
}
