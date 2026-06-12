import { create } from "zustand";

interface WorkflowDraftState {
  /** non-null while the "save as workflow" modal is open */
  command: string | null;
  open: (command: string) => void;
  close: () => void;
}

/** Holds the command being turned into a workflow (modal lives in App). */
export const useWorkflowDraft = create<WorkflowDraftState>((set) => ({
  command: null,
  open: (command) => set({ command }),
  close: () => set({ command: null }),
}));
