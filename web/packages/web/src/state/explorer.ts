import { create } from "zustand";
import { fsEvents } from "../lib/fs-events";
import { useEditor } from "../state/editor";

export interface PreviewTarget {
  path: string;
  name: string;
  /** unknown when opened from a terminal link or search result */
  size?: number;
}

export type SidebarMode = "files" | "search" | "git" | "agent";

interface ExplorerState {
  /** workspace-relative paths of expanded dirs ("" = root, always expanded) */
  expanded: Set<string>;
  selected: string | null;
  /** path of the tree row currently being inline-renamed */
  renaming: string | null;
  setRenaming: (path: string | null) => void;
  sidebarMode: SidebarMode;
  setSidebarMode: (mode: SidebarMode) => void;
  toggle: (path: string) => void;
  collapseAll: () => void;
  select: (path: string | null) => void;
  /** open a file in the editor pane (editable or viewer per type) */
  openPreview: (target: PreviewTarget) => void;
  /** open by workspace-relative path alone (terminal links, search hits) */
  openPreviewPath: (path: string) => void;
  /** expand all ancestors of a path and select it in the tree */
  revealPath: (path: string) => void;
  /** collapse + deselect everything (e.g. on vault switch) */
  resetAll: () => void;
}

export const useExplorer = create<ExplorerState>((set) => ({
  expanded: new Set<string>(),
  selected: null,
  renaming: null,
  setRenaming: (renaming) => set({ renaming }),
  sidebarMode: "files",
  setSidebarMode: (mode) => set({ sidebarMode: mode }),

  toggle: (path) =>
    set((s) => {
      const expanded = new Set(s.expanded);
      if (expanded.has(path)) {
        expanded.delete(path);
        fsEvents.unwatch(path);
      } else {
        expanded.add(path);
        fsEvents.watch(path);
      }
      return { expanded };
    }),

  collapseAll: () =>
    set((s) => {
      for (const path of s.expanded) fsEvents.unwatch(path);
      return { expanded: new Set<string>() };
    }),

  select: (path) => set({ selected: path }),

  openPreview: (target) => useEditor.getState().open(target),

  openPreviewPath: (path) =>
    useEditor.getState().open({ path, name: path.split("/").pop() ?? path }),

  revealPath: (path) =>
    set((s) => {
      const expanded = new Set(s.expanded);
      const parts = path.split("/").slice(0, -1);
      let acc = "";
      for (const part of parts) {
        acc = acc ? `${acc}/${part}` : part;
        if (!expanded.has(acc)) {
          expanded.add(acc);
          fsEvents.watch(acc);
        }
      }
      return { expanded, selected: path };
    }),

  resetAll: () => set({ expanded: new Set<string>(), selected: null }),
}));
