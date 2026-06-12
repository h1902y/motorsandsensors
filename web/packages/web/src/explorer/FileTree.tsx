import { useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { shellQuote, type ListResponse } from "@zuzuu-web/protocol";
import { api } from "../lib/api";
import { useExplorer } from "../state/explorer";
import { useSessions } from "../state/sessions";
import { termRegistry } from "../term/registry";
import { ActionMenu, MenuPopover, type MenuItem, prompt, confirm } from "../components/ui";
import { localFileActions } from "../lib/local-actions";

interface Row {
  path: string;
  name: string;
  depth: number;
  isDir: boolean;
  isSymlink: boolean;
  expanded: boolean;
  size: number;
}

const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

function buildRows(
  dirData: Map<string, ListResponse | undefined>,
  expanded: Set<string>,
): Row[] {
  const rows: Row[] = [];
  const walk = (dir: string, depth: number) => {
    const data = dirData.get(dir);
    if (!data) return;
    for (const entry of data.entries) {
      const path = join(dir, entry.name);
      const isDir = entry.kind === "dir" || entry.targetKind === "dir";
      const isExpanded = isDir && expanded.has(path);
      rows.push({
        path,
        name: entry.name,
        depth,
        isDir,
        isSymlink: entry.kind === "symlink",
        expanded: isExpanded,
        size: entry.size,
      });
      if (isExpanded) walk(path, depth + 1);
    }
  };
  walk("", 0);
  return rows;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
      fill="currentColor"
    >
      <path d="M6 4l4 4-4 4V4z" />
    </svg>
  );
}

function EntryIcon({ row }: { row: Row }) {
  if (row.isDir)
    return (
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 text-accent-dim" fill="currentColor">
        <path d="M1.5 3.5A1.5 1.5 0 013 2h3l1.5 1.5H13A1.5 1.5 0 0114.5 5v7A1.5 1.5 0 0113 13.5H3A1.5 1.5 0 011.5 12v-8.5z" />
      </svg>
    );
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 text-ink-500" fill="currentColor">
      <path d="M4 1.5h5L13 5.5v9a1 1 0 01-1 1H4a1 1 0 01-1-1v-12a1 1 0 011-1zM9 2v4h4" fillRule="evenodd" />
    </svg>
  );
}

export function FileTree() {
  const queryClient = useQueryClient();
  const { expanded, selected, toggle, select, openPreview, renaming, setRenaming } = useExplorer();
  const createSession = useSessions((s) => s.create);
  const activeId = useSessions((s) => s.activeId);
  const activeCwd = useSessions((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeId);
    return tab?.cwdLive && !tab.cwdLive.outside ? tab.cwdLive.cwd : undefined;
  });
  const workspace = useQuery({ queryKey: ["workspace"], queryFn: api.workspace });
  const gitStatus = useQuery({ queryKey: ["git", "status"], queryFn: api.gitStatus, refetchInterval: 4000, placeholderData: keepPreviousData });
  const scrollRef = useRef<HTMLDivElement>(null);

  // path → single-letter badge (M/A/D/U), worktree status preferred
  const gitBadges = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of gitStatus.data?.entries ?? []) {
      const letter =
        e.index === "?" ? "U" : e.worktree !== " " ? e.worktree : e.index;
      if (letter && letter !== " ") map.set(e.path, letter);
    }
    return map;
  }, [gitStatus.data]);

  const dirPaths = useMemo(() => ["", ...expanded].sort(), [expanded]);

  const queries = useQueries({
    queries: dirPaths.map((path) => ({
      queryKey: ["dir", path],
      queryFn: () => api.listDir(path),
      placeholderData: keepPreviousData,
    })),
  });

  const dirData = useMemo(() => {
    const map = new Map<string, ListResponse | undefined>();
    dirPaths.forEach((path, i) => map.set(path, queries[i]?.data));
    return map;
  }, [dirPaths, queries]);

  const rows = useMemo(() => buildRows(dirData, expanded), [dirData, expanded]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 24,
    overscan: 20,
  });

  const refreshDir = (dir: string) =>
    queryClient.invalidateQueries({ queryKey: ["dir", dir] });

  const parentOf = (path: string) => path.split("/").slice(0, -1).join("/");

  const selectedDir = useMemo(() => {
    if (!selected) return "";
    const row = rows.find((r) => r.path === selected);
    if (row?.isDir) return selected;
    return parentOf(selected);
  }, [selected, rows]);

  // ── actions ────────────────────────────────────────────────────────
  // start inline rename (an input appears on the row)
  const onRename = (row: Row) => setRenaming(row.path);

  // commit an inline rename / new-file name edit
  const commitRename = async (oldPath: string, newName: string) => {
    setRenaming(null);
    const trimmed = newName.trim();
    const parent = parentOf(oldPath);
    if (!trimmed || trimmed === oldPath.split("/").pop()) return;
    const newPath = join(parent, trimmed);
    await api.rename(oldPath, newPath);
    void refreshDir(parent);
    select(newPath);
  };

  const onDelete = async (row: Row) => {
    const ok = await confirm({
      title: `Delete ${row.name}?`,
      message: row.isDir ? "This folder and its contents will be deleted." : "This file will be deleted.",
      okLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await api.remove([row.path]);
    select(null);
    void refreshDir(parentOf(row.path));
  };

  // ── local-native actions ───────────────────────────────────────────
  const absOf = (rel: string) => {
    const root = workspace.data?.root;
    return root ? (rel ? `${root}/${rel}` : root) : rel;
  };

  /** \x15 (kill-line) clears any half-typed input before injecting cd. */
  const cdHere = (row: Row) => {
    termRegistry.get(activeId)?.sendInput(`\x15cd ${shellQuote(absOf(row.path))}\r`);
  };

  // full action set for a row, shown via the ⋯ menu and right-click
  const rowActions = (row: Row): MenuItem[] => {
    const dirItems: MenuItem[] = row.isDir
      ? [
          { label: "Open terminal here", iconPath: "M3 4l4 4-4 4M8 12h5", onClick: () => void createSession(row.path) },
          { label: "cd here", iconPath: "M2 8h9m0 0L8 5m3 3l-3 3M13 3v10", onClick: () => cdHere(row) },
          { label: "New folder", iconPath: "M8 4v8M4 8h8", onClick: () => void newFolderIn(row.path) },
        ]
      : [];
    return [
      ...dirItems,
      ...localFileActions(row.path, absOf(row.path)).map((it, i) => (i === 0 ? { ...it, separated: dirItems.length > 0 } : it)),
      { label: "Rename", iconPath: "M11 3l2 2-7 7H4v-2l7-7z", onClick: () => void onRename(row), separated: true },
      { label: "Delete", iconPath: "M4 5h8m-7 0v7m3-7v7m3-7v7M6 5V3h4v2", onClick: () => void onDelete(row), danger: true },
    ];
  };

  const newFolderIn = async (dir: string) => {
    const data = dirData.get(dir);
    const taken = new Set((data?.entries ?? []).map((e) => e.name));
    let name = "untitled";
    for (let i = 1; taken.has(name); i++) name = `untitled-${i}`;
    const path = join(dir, name);
    await api.mkdir(path);
    await refreshDir(dir);
    select(path);
    setRenaming(path);
  };

  const [ctxMenu, setCtxMenu] = useState<{ items: MenuItem[]; x: number; y: number } | null>(null);

  // scroll to selection when revealPath (status bar / search) selects a row
  useEffect(() => {
    if (!selected) return;
    const index = rows.findIndex((r) => r.path === selected);
    if (index >= 0) virtualizer.scrollToIndex(index, { align: "auto" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, rows.length]);

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto py-1">
        <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((vi) => {
            const row = rows[vi.index]!;
            const isSelected = selected === row.path;
            return (
              <div
                key={row.path}
                className={`group absolute left-0 top-0 flex w-full cursor-default items-center gap-1.5 px-2 ${
                  isSelected ? "bg-ink-700/70" : "hover:bg-ink-800"
                }`}
                style={{
                  height: vi.size,
                  transform: `translateY(${vi.start}px)`,
                  paddingLeft: 8 + row.depth * 14,
                }}
                onClick={() => {
                  select(row.path);
                  if (row.isDir) toggle(row.path);
                  else openPreview({ path: row.path, name: row.name, size: row.size });
                }}
                onDoubleClick={() => {
                  if (row.isDir) cdHere(row);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setCtxMenu({ items: rowActions(row), x: e.clientX, y: e.clientY });
                }}
              >
                {row.isDir ? (
                  <Chevron open={row.expanded} />
                ) : (
                  <span className="w-3 shrink-0" />
                )}
                <EntryIcon row={row} />
                {renaming === row.path ? (
                  <RenameInput
                    name={row.name}
                    onCommit={(newName) => void commitRename(row.path, newName)}
                    onCancel={() => setRenaming(null)}
                  />
                ) : (
                  <span className={`truncate text-ui ${gitBadges.has(row.path) ? "text-warn" : "text-ink-100"}`}>
                    {row.name}
                    {row.isSymlink && <span className="ml-1 text-ink-500">⤳</span>}
                  </span>
                )}
                {gitBadges.has(row.path) && (
                  <span
                    className={`ml-1 shrink-0 text-meta ${gitBadges.get(row.path) === "D" ? "text-danger" : gitBadges.get(row.path) === "U" ? "text-accent-dim" : "text-warn"}`}
                    title={`git: ${gitBadges.get(row.path)}`}
                  >
                    {gitBadges.get(row.path)}
                  </span>
                )}
                {activeCwd !== undefined && activeCwd === row.path && (
                  <span
                    title="active terminal is here"
                    className="ml-1 h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                  />
                )}
                {/* hover-revealed, but kept visible while its menu is open
                    (the menu itself portals to <body>, so it survives the
                    pointer leaving this row) */}
                <span className="ml-auto hidden shrink-0 group-hover:block has-[[data-menu-open]]:block">
                  <ActionMenu items={rowActions(row)} />
                </span>
              </div>
            );
          })}
        </div>
        {rows.length === 0 && (
          <div className="px-3 py-2 text-ui text-ink-500">empty workspace</div>
        )}
      </div>
      {ctxMenu && (
        <MenuPopover items={ctxMenu.items} x={ctxMenu.x} y={ctxMenu.y} onClose={() => setCtxMenu(null)} />
      )}
    </div>
  );
}

/** Inline name editor for a tree row. Selects the basename (not the extension). */
function RenameInput({
  name,
  onCommit,
  onCancel,
}: {
  name: string;
  onCommit: (newName: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const dot = name.lastIndexOf(".");
    el.setSelectionRange(0, dot > 0 ? dot : name.length); // select basename, keep ext
  }, [name]);
  return (
    <input
      ref={ref}
      defaultValue={name}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={(e) => onCommit(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") onCommit((e.target as HTMLInputElement).value);
        else if (e.key === "Escape") onCancel();
      }}
      className="wc-input min-w-0 flex-1 px-1 py-0 text-ui"
    />
  );
}

