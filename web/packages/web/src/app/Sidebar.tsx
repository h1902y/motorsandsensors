// The left rail: a canonical-height header (workspace dropdown + a search icon
// that expands to an inline filter input) over the file tree. Search filters
// the tree IN PLACE (the tree stays visible — see FileTree). The workspace
// dropdown is the one directory control: New file, Go to parent, Recent, Add
// folder. Reuses existing handlers; no new daemon APIs (parent = switchVault to
// the root's dirname).
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ListResponse } from "@zuzuu-web/protocol";
import { api } from "../lib/api";
import { useExplorer } from "../state/explorer";
import { FileTree } from "../explorer/FileTree";
import { Bar, IconButton, cx } from "../components/ui";
import { capRecents, tilde } from "../onboarding/vault-picker-logic";
import { useWorkspaceConfigQuery, useWorkspaceQuery } from "./queries";
import { switchVault } from "./vault";

const parentOf = (p: string) => p.replace(/\/+$/, "").split("/").slice(0, -1).join("/");

const ICON = {
  search: "M10.5 10.5L14 14M7 12A5 5 0 117 2a5 5 0 010 10z",
  close: "M4 4l8 8M12 4l-8 8",
};

// ── one menu row inside the workspace dropdown ──────────────────────────
function MenuRow({ iconPath, label, hint, onClick, disabled }: {
  iconPath: string; label: string; hint?: string; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="wc-sans flex w-full items-center gap-2 px-3 py-1.5 text-left text-ui text-ink-200 transition-colors hover:bg-hover hover:text-ink-100 disabled:opacity-40 disabled:hover:bg-transparent"
    >
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 text-ink-400" fill="none" stroke="currentColor" strokeWidth="1.4">
        <path d={iconPath} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && <span className="ml-auto shrink-0 text-meta text-ink-500">{hint}</span>}
    </button>
  );
}

// ── the workspace dropdown trigger + popover (the directory control) ─────
function WorkspaceDropdown({ onNewFile }: { onNewFile: () => void }) {
  const queryClient = useQueryClient();
  const workspace = useWorkspaceQuery();
  const wsConfig = useWorkspaceConfigQuery();
  const [open, setOpen] = useState(false);
  const root = workspace.data?.root ?? "";
  const parent = parentOf(root);
  const recents = capRecents(wsConfig.data?.recent ?? [], root, 6);

  const run = (fn: () => void) => { setOpen(false); fn(); };
  const pick = (path: string) => run(() => void switchVault(queryClient, path));
  const goParent = () => parent && pick(parent);
  const addFolder = () => run(() => window.dispatchEvent(new Event("zuzuu-web:open-vault-picker")));

  return (
    <div className="relative min-w-0 flex-1">
      <button
        onClick={() => setOpen((v) => !v)}
        title={root}
        className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-1.5 py-1 text-left transition-colors hover:bg-hover"
      >
        <span aria-hidden className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] bg-hover text-ink-200">
          <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.4">
            <path d="M1.5 4A1.5 1.5 0 013 2.5h3l1.5 1.5H13A1.5 1.5 0 0114.5 5.5v6A1.5 1.5 0 0113 13H3a1.5 1.5 0 01-1.5-1.5z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="wc-sans min-w-0 flex-1 truncate text-ui font-medium text-ink-100">{workspace.data?.name ?? "…"}</span>
        <svg viewBox="0 0 16 16" className={cx("h-3 w-3 shrink-0 text-ink-500 transition-transform", open && "rotate-180")} fill="none" stroke="currentColor" strokeWidth="1.4">
          <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            style={{ boxShadow: "var(--shadow-menu)" }}
            className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[70vh] overflow-y-auto rounded-[var(--radius-ui)] border border-border bg-elevated py-1"
          >
            <div className="px-3 pb-1 pt-1">
              <div className="wc-eyebrow">Workspace</div>
              <div className="wc-sans mt-0.5 truncate text-ui text-ink-100" title={root}>{workspace.data?.name ?? "…"}</div>
            </div>
            <div className="mt-1 border-t border-border pt-1">
              <MenuRow iconPath="M4 1.5h5L13 5.5v9a1 1 0 01-1 1H4a1 1 0 01-1-1v-12a1 1 0 011-1zM9 2v4h4" label="New file" onClick={() => run(onNewFile)} />
            </div>
            <div className="mt-1 border-t border-border pt-1">
              <MenuRow
                iconPath="M8 12.5V3.5M4 7l4-3.5L12 7"
                label={parent ? `Go to ${parent.split("/").pop() || "/"}…` : "Go to parent folder"}
                hint="parent"
                onClick={goParent}
                disabled={!parent}
              />
            </div>
            {recents.length > 0 && (
              <div className="mt-1 border-t border-border pt-1">
                <div className="wc-eyebrow px-3 py-0.5">Recent</div>
                {recents.map((r) => (
                  <button
                    key={r}
                    onClick={() => pick(r)}
                    title={r}
                    className="wc-sans block w-full truncate px-3 py-1.5 text-left text-ui text-ink-300 transition-colors hover:bg-hover hover:text-ink-100"
                  >
                    {tilde(r)}
                  </button>
                ))}
              </div>
            )}
            <div className="mt-1 border-t border-border pt-1">
              <MenuRow iconPath="M8 3.5v9M3.5 8h9" label="Add folder…" hint="⌘⇧O" onClick={addFolder} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function Sidebar() {
  const queryClient = useQueryClient();
  const searchOpen = useExplorer((s) => s.searchOpen);
  const openSearch = useExplorer((s) => s.openSearch);
  const closeSearch = useExplorer((s) => s.closeSearch);
  const searchQuery = useExplorer((s) => s.searchQuery);
  const setSearchQuery = useExplorer((s) => s.setSearchQuery);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (searchOpen) inputRef.current?.focus(); }, [searchOpen]);

  // New file in the selected dir (or root) → inline-rename (no upfront prompt).
  const newFile = () => {
    const sel = useExplorer.getState().selected;
    const dir = sel ? (sel.includes(".") ? sel.split("/").slice(0, -1).join("/") : sel) : "";
    const list = queryClient.getQueryData<ListResponse>(["dir", dir]);
    const taken = new Set((list?.entries ?? []).map((e) => e.name));
    let name = "untitled.md";
    for (let i = 1; taken.has(name); i++) name = `untitled-${i}.md`;
    const path = dir ? `${dir}/${name}` : name;
    void api.writeFile(path, "").then(async () => {
      if (dir) useExplorer.getState().revealPath(`${dir}/x`);
      await queryClient.invalidateQueries({ queryKey: ["dir", dir] });
      useExplorer.getState().select(path);
      useExplorer.getState().setRenaming(path);
    });
  };

  return (
    <div className="flex h-full flex-col">
      <Bar border="b" surface="surface" className="!gap-1.5">
        {searchOpen ? (
          <>
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 text-ink-500" fill="none" stroke="currentColor" strokeWidth="1.4">
              <path d={ICON.search} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <input
              ref={inputRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") closeSearch(); }}
              placeholder="Filter files…"
              className="wc-sans min-w-0 flex-1 bg-transparent text-ui text-ink-100 outline-none placeholder:text-ink-600"
            />
            <IconButton title="Close search (Esc)" iconPath={ICON.close} onClick={closeSearch} />
          </>
        ) : (
          <>
            <WorkspaceDropdown onNewFile={newFile} />
            <IconButton title="Search files (⌘F)" iconPath={ICON.search} onClick={() => openSearch()} />
          </>
        )}
      </Bar>
      <div className="min-h-0 flex-1">
        <FileTree />
      </div>
    </div>
  );
}
