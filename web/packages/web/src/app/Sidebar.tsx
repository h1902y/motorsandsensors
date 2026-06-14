// The left rail, simplified: ONE workspace dropdown header (the single
// directory control — new file/folder, search, go-to-parent, recents, browse)
// over the file tree / search panel. Modules live in the right panel, so the
// sidebar is purely the file workspace. Restyle/consolidate only — every
// handler is the existing one: the explorer search toggle, the create-and-
// rename flow, and switchVault. No new daemon APIs (parent = switchVault to
// the root's dirname; child cd stays the tree's double-click).
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ListResponse } from "@zuzuu-web/protocol";
import { api } from "../lib/api";
import { useExplorer } from "../state/explorer";
import { FileTree } from "../explorer/FileTree";
import { SearchPanel } from "../explorer/SearchPanel";
import { cx } from "../components/ui";
import { capRecents, tilde } from "../onboarding/vault-picker-logic";
import { useWorkspaceConfigQuery, useWorkspaceQuery } from "./queries";
import { switchVault } from "./vault";

const parentOf = (p: string) => p.replace(/\/+$/, "").split("/").slice(0, -1).join("/");

// ── a single menu row inside the workspace dropdown ─────────────────────
function MenuRow({
  iconPath,
  label,
  hint,
  onClick,
  disabled,
}: {
  iconPath: string;
  label: string;
  hint?: string;
  onClick: () => void;
  disabled?: boolean;
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

// ── the workspace dropdown: the one directory control ───────────────────
function WorkspaceHeader({
  onNewFile,
  onNewFolder,
  onSearch,
}: {
  onNewFile: () => void;
  onNewFolder: () => void;
  onSearch: () => void;
}) {
  const queryClient = useQueryClient();
  const workspace = useWorkspaceQuery();
  const wsConfig = useWorkspaceConfigQuery();
  const [open, setOpen] = useState(false);
  const root = workspace.data?.root ?? "";
  const parent = parentOf(root);
  const recents = capRecents(wsConfig.data?.recent ?? [], root, 6);

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };
  const pick = (path: string) => run(() => void switchVault(queryClient, path));
  const goParent = () => parent && pick(parent);
  const addFolder = () => run(() => window.dispatchEvent(new Event("zuzuu-web:open-vault-picker")));

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title={root}
        className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left transition-colors hover:bg-hover"
      >
        <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] bg-hover text-ink-200">
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
            <path d="M1.5 4A1.5 1.5 0 013 2.5h3l1.5 1.5H13A1.5 1.5 0 0114.5 5.5v6A1.5 1.5 0 0113 13H3a1.5 1.5 0 01-1.5-1.5z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="wc-sans min-w-0 flex-1 truncate text-ui font-medium text-ink-100">
          {workspace.data?.name ?? "…"}
        </span>
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
            {/* identity */}
            <div className="px-3 pb-1 pt-1">
              <div className="wc-eyebrow">Workspace</div>
              <div className="wc-sans mt-0.5 truncate text-ui text-ink-100" title={root}>{workspace.data?.name ?? "…"}</div>
            </div>

            {/* create + search */}
            <div className="mt-1 border-t border-border pt-1">
              <MenuRow iconPath="M4 1.5h5L13 5.5v9a1 1 0 01-1 1H4a1 1 0 01-1-1v-12a1 1 0 011-1zM9 2v4h4" label="New file" onClick={() => run(onNewFile)} />
              <MenuRow iconPath="M1.5 3.5A1.5 1.5 0 013 2h3l1.5 1.5H13A1.5 1.5 0 0114.5 5v7A1.5 1.5 0 0113 13.5H3A1.5 1.5 0 011.5 12z" label="New folder" onClick={() => run(onNewFolder)} />
              <MenuRow iconPath="M10.5 10.5L14 14M7 12A5 5 0 117 2a5 5 0 010 10z" label="Search workspace" hint="⌘F" onClick={() => run(onSearch)} />
            </div>

            {/* navigate up */}
            <div className="mt-1 border-t border-border pt-1">
              <MenuRow
                iconPath="M8 12.5V3.5M4 7l4-3.5L12 7"
                label={parent ? `Go to ${parent.split("/").pop() || "/"}…` : "Go to parent folder"}
                hint="parent"
                onClick={goParent}
                disabled={!parent}
              />
            </div>

            {/* recents + browse */}
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

  // Create a file or folder in the selected dir (or workspace root) with a
  // default name, then drop the tree row straight into inline-rename so the
  // user edits the name + extension in place (no upfront prompt).
  const targetDir = () => {
    const sel = useExplorer.getState().selected;
    return sel ? (sel.includes(".") ? sel.split("/").slice(0, -1).join("/") : sel) : "";
  };
  const uniqueName = (dir: string, base: string, ext: string) => {
    const list = queryClient.getQueryData<ListResponse>(["dir", dir]);
    const taken = new Set((list?.entries ?? []).map((e) => e.name));
    let name = `${base}${ext}`;
    for (let i = 1; taken.has(name); i++) name = `${base}-${i}${ext}`;
    return name;
  };
  const createAndRename = async (dir: string, name: string, mk: (path: string) => Promise<unknown>) => {
    const path = dir ? `${dir}/${name}` : name;
    await mk(path);
    if (dir) useExplorer.getState().revealPath(`${dir}/x`); // expand the dir
    await queryClient.invalidateQueries({ queryKey: ["dir", dir] });
    useExplorer.getState().select(path);
    useExplorer.getState().setRenaming(path);
  };
  const newFile = () => {
    const dir = targetDir();
    return createAndRename(dir, uniqueName(dir, "untitled", ".md"), (p) => api.writeFile(p, ""));
  };
  const newFolder = () => {
    const dir = targetDir();
    return createAndRename(dir, uniqueName(dir, "untitled", ""), (p) => api.mkdir(p));
  };

  return (
    <div className="flex h-full flex-col">
      <div className="px-2 pt-2">
        <WorkspaceHeader onNewFile={() => void newFile()} onNewFolder={() => void newFolder()} onSearch={() => openSearch()} />
      </div>
      <div className="mt-2 min-h-0 flex-1 border-t border-border pt-1">
        {searchOpen ? <SearchPanel /> : <FileTree />}
      </div>
    </div>
  );
}
