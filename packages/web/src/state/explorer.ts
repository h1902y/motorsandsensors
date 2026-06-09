import { create } from "zustand";
import { fsEvents } from "../lib/fs-events";

export interface PreviewTarget {
  path: string;
  name: string;
  /** unknown when opened from a terminal link or search result */
  size?: number;
}

export type SidebarMode = "files" | "search";

interface ExplorerState {
  /** workspace-relative paths of expanded dirs ("" = root, always expanded) */
  expanded: Set<string>;
  selected: string | null;
  preview: PreviewTarget | null;
  sidebarMode: SidebarMode;
  setSidebarMode: (mode: SidebarMode) => void;
  toggle: (path: string) => void;
  collapseAll: () => void;
  select: (path: string | null) => void;
  openPreview: (target: PreviewTarget) => void;
  /** open by workspace-relative path alone (terminal links, search hits) */
  openPreviewPath: (path: string) => void;
  closePreview: () => void;
  /** expand all ancestors of a path and select it in the tree */
  revealPath: (path: string) => void;
}

export const useExplorer = create<ExplorerState>((set) => ({
  expanded: new Set<string>(),
  selected: null,
  preview: null,
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

  openPreview: (target) => set({ preview: target }),

  openPreviewPath: (path) =>
    set({ preview: { path, name: path.split("/").pop() ?? path } }),

  closePreview: () => set({ preview: null }),

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
}));
