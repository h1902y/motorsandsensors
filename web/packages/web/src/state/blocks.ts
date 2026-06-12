import { create } from "zustand";
import type { Block } from "../term/blocks";

interface BlocksState {
  /** blocks per session id */
  bySession: Record<string, Block[]>;
  /** recent commands (most-recent-first, deduped) for the palette */
  history: string[];
  setBlocks: (sessionId: string, blocks: Block[]) => void;
  addCommand: (command: string) => void;
  clear: (sessionId: string) => void;
  resetAll: () => void;
}

const HISTORY_MAX = 200;

export const useBlocks = create<BlocksState>((set) => ({
  bySession: {},
  history: [],

  setBlocks: (sessionId, blocks) =>
    set((s) => ({ bySession: { ...s.bySession, [sessionId]: blocks } })),

  addCommand: (command) =>
    set((s) => {
      const cmd = command.trim();
      if (!cmd) return s;
      const history = [cmd, ...s.history.filter((c) => c !== cmd)].slice(0, HISTORY_MAX);
      return { history };
    }),

  clear: (sessionId) =>
    set((s) => {
      const bySession = { ...s.bySession };
      delete bySession[sessionId];
      return { bySession };
    }),

  resetAll: () => set({ bySession: {}, history: [] }),
}));
