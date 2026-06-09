import { create } from "zustand";
import type { CwdPayload, SessionInfo } from "@webcode/protocol";
import { api } from "../lib/api";

export type SessionTab = SessionInfo & {
  /** live workspace-relative cwd from the daemon's poller */
  cwdLive?: CwdPayload;
};

interface SessionsState {
  tabs: SessionTab[];
  activeId: string | null;
  loaded: boolean;
  init: () => Promise<void>;
  create: (cwd?: string) => Promise<void>;
  close: (id: string) => Promise<void>;
  setActive: (id: string) => void;
  setTitle: (id: string, title: string) => void;
  setCwd: (id: string, cwd: CwdPayload) => void;
  markExited: (id: string) => void;
}

export const useSessions = create<SessionsState>((set, get) => ({
  tabs: [],
  activeId: null,
  loaded: false,

  init: async () => {
    if (get().loaded) return;
    let tabs = await api.listSessions();
    if (tabs.length === 0) {
      tabs = [await api.createSession()];
    }
    set({ tabs, activeId: tabs[tabs.length - 1]?.id ?? null, loaded: true });
  },

  create: async (cwd) => {
    const session = await api.createSession(cwd ? { cwd } : {});
    set((s) => ({ tabs: [...s.tabs, session], activeId: session.id }));
  },

  close: async (id) => {
    await api.closeSession(id).catch(() => {});
    set((s) => {
      const tabs = s.tabs.filter((t) => t.id !== id);
      const activeId =
        s.activeId === id ? (tabs[tabs.length - 1]?.id ?? null) : s.activeId;
      return { tabs, activeId };
    });
  },

  setActive: (id) => set({ activeId: id }),

  setTitle: (id, title) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, title } : t)),
    })),

  setCwd: (id, cwd) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, cwdLive: cwd } : t)),
    })),

  markExited: (id) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, alive: false } : t)),
    })),
}));
