// The right panel's mode store + the editor-store subscription that enforces
// the layout rules (one surface, two modes):
//   - opening a file (tree, search hit, ⌘K, faculty item — every path routes
//     through the editor store) forces mode 'files'
//   - closing the LAST editor tab forces mode 'faculties'
//   - the `‹ faculties` affordance flips mode WITHOUT touching editor tabs;
//     while tabs exist, faculty mode shows a `files ›` return chip (showFiles)
// Faculty mode itself is the panel root (drill null) with two slide-in
// drill-ins: a faculty's view (card click) or a session's detail (row
// click). Every return to faculty mode lands on the panel ROOT (drill
// cleared — deliberately simple).
import { create } from "zustand";
import type { FacultyKey } from "@zuzuu-web/protocol";
import { useEditor } from "./editor";

export type RightPanelMode = "files" | "faculties";

/** What slides over the panel root: a faculty view or a session detail. */
export type PanelDrill =
  | { kind: "faculty"; key: FacultyKey }
  | { kind: "session"; id: string };

interface RightPanelState {
  mode: RightPanelMode;
  /** the drill-in showing over the panel root; null = the root */
  drill: PanelDrill | null;
  /** the `files ›` return chip — only meaningful while editor tabs exist */
  showFiles: () => void;
  /** the `‹ faculties` affordance — editor tabs stay open; panel root */
  showFaculties: () => void;
  /** card click → that faculty's drill-in */
  openFaculty: (key: FacultyKey) => void;
  /** session row click → that session's detail */
  openSession: (id: string) => void;
  /** back chevron → the panel root */
  closeDrill: () => void;
}

export const useRightPanel = create<RightPanelState>((set) => ({
  mode: "faculties",
  drill: null,
  showFiles: () =>
    set((s) => (useEditor.getState().openFiles.length > 0 ? { mode: "files" } : s)),
  showFaculties: () => set({ mode: "faculties", drill: null }),
  openFaculty: (key) => set({ mode: "faculties", drill: { kind: "faculty", key } }),
  openSession: (id) => set({ mode: "faculties", drill: { kind: "session", id } }),
  closeDrill: () => set({ drill: null }),
}));

// One wiring point for "opening a file forces files mode": every open path
// (FileTree, search, ⌘K, terminal links, faculty clicks) lands in the editor
// store, so we watch it instead of patching N call sites. A re-focus of an
// already-open tab (activePath change) counts as opening too.
useEditor.subscribe((s, prev) => {
  if (s.openFiles.length === 0) {
    if (prev.openFiles.length > 0) useRightPanel.setState({ mode: "faculties", drill: null });
    return;
  }
  if (s.openFiles.length > prev.openFiles.length || s.activePath !== prev.activePath) {
    useRightPanel.setState({ mode: "files" });
  }
});
