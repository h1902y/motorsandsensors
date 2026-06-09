import { useEffect, useMemo, useRef } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { shellQuote, type ListResponse } from "@webcode/protocol";
import { api } from "../lib/api";
import { useExplorer } from "../state/explorer";
import { useSessions } from "../state/sessions";
import { termRegistry } from "../term/registry";

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
  const { expanded, selected, toggle, select, openPreview } = useExplorer();
  const createSession = useSessions((s) => s.create);
  const activeId = useSessions((s) => s.activeId);
  const activeCwd = useSessions((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeId);
    return tab?.cwdLive && !tab.cwdLive.outside ? tab.cwdLive.cwd : undefined;
  });
  const workspace = useQuery({ queryKey: ["workspace"], queryFn: api.workspace });
  const scrollRef = useRef<HTMLDivElement>(null);

  const dirPaths = useMemo(() => ["", ...expanded].sort(), [expanded]);

  const queries = useQueries({
    queries: dirPaths.map((path) => ({
      queryKey: ["dir", path],
      queryFn: () => api.listDir(path),
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
  const onNewFolder = async () => {
    const name = window.prompt("New folder name:");
    if (!name) return;
    await api.mkdir(join(selectedDir, name));
    void refreshDir(selectedDir);
  };

  const onRename = async (row: Row) => {
    const name = window.prompt("Rename to:", row.name);
    if (!name || name === row.name) return;
    await api.rename(row.path, join(parentOf(row.path), name));
    void refreshDir(parentOf(row.path));
  };

  const onDelete = async (row: Row) => {
    if (!window.confirm(`Delete ${row.name}${row.isDir ? " and its contents" : ""}?`)) return;
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

  const copyPath = (row: Row) => void navigator.clipboard.writeText(absOf(row.path));

  // scroll to selection when revealPath (status bar / search) selects a row
  useEffect(() => {
    if (!selected) return;
    const index = rows.findIndex((r) => r.path === selected);
    if (index >= 0) virtualizer.scrollToIndex(index, { align: "auto" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, rows.length]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-ink-700 px-2 py-1.5 text-ink-300">
        <span className="mr-auto truncate text-[11px] uppercase tracking-wider">Files</span>
        <ToolbarButton title="New folder" onClick={onNewFolder} d="M8 4v8M4 8h8" />
        <ToolbarButton title="Refresh" onClick={() => queryClient.invalidateQueries({ queryKey: ["dir"] })} d="M13 8a5 5 0 11-1.5-3.5M13 3v2.5h-2.5" />
      </div>
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
              >
                {row.isDir ? (
                  <Chevron open={row.expanded} />
                ) : (
                  <span className="w-3 shrink-0" />
                )}
                <EntryIcon row={row} />
                <span className="truncate text-[12.5px] text-ink-100">
                  {row.name}
                  {row.isSymlink && <span className="ml-1 text-ink-500">⤳</span>}
                </span>
                {activeCwd !== undefined && activeCwd === row.path && (
                  <span
                    title="active terminal is here"
                    className="ml-1 h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                  />
                )}
                <span className="ml-auto hidden shrink-0 items-center gap-1 group-hover:flex">
                  {row.isDir && (
                    <>
                      <RowButton title="cd here (active terminal)" onClick={() => cdHere(row)} d="M2 8h9m0 0L8 5m3 3l-3 3M13 3v10" />
                      <RowButton title="Open terminal here" onClick={() => void createSession(row.path)} d="M3 4l4 4-4 4M8 12h5" />
                    </>
                  )}
                  <RowButton title="Copy path" onClick={() => copyPath(row)} d="M6 6h7v7H6zM3 10V3h7" />
                  <RowButton title="Reveal in Finder" onClick={() => void api.openLocal(row.path, true)} d="M2 5h4l1.5 1.5H14V12a1 1 0 01-1 1H3a1 1 0 01-1-1V5zM8 8.5v3m0 0l-1.5-1.5M8 11.5L9.5 10" />
                  <RowButton title="Open with default app" onClick={() => void api.openLocal(row.path)} d="M6 3H3v10h10v-3M9 3h4v4M13 3L7 9" />
                  <RowButton title="Rename" onClick={() => void onRename(row)} d="M11 3l2 2-7 7H4v-2l7-7z" />
                  <RowButton title="Delete" onClick={() => void onDelete(row)} d="M4 5h8m-7 0v7m3-7v7m3-7v7M6 5V3h4v2" danger />
                </span>
              </div>
            );
          })}
        </div>
        {rows.length === 0 && (
          <div className="px-3 py-2 text-[12px] text-ink-500">empty workspace</div>
        )}
      </div>
    </div>
  );
}

function ToolbarButton({ title, onClick, d }: { title: string; onClick: () => void; d: string }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="rounded p-1 text-ink-300 hover:bg-ink-700 hover:text-ink-100"
    >
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
        <path d={d} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

function RowButton({
  title,
  onClick,
  d,
  danger,
}: {
  title: string;
  onClick: () => void;
  d: string;
  danger?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`rounded p-0.5 ${danger ? "text-ink-500 hover:text-danger" : "text-ink-500 hover:text-ink-100"}`}
    >
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.3">
        <path d={d} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
