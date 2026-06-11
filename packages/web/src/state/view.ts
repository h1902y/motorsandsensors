import { create } from "zustand";

export type ViewMode = "ide" | "faculties";

interface ViewState {
  mode: ViewMode;
  setMode: (m: ViewMode) => void;
}

/** Top-level view: the IDE (terminal/editor/files) or the zuzuu faculties dashboard. */
export const useView = create<ViewState>((set) => ({
  mode: "ide",
  setMode: (mode) => set({ mode }),
}));
