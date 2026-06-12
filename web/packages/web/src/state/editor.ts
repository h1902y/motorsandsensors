import { create } from "zustand";
import { api } from "../lib/api";

export interface OpenFile {
  path: string;
  name: string;
  size?: number;
  /** a git diff tab (HEAD vs working) rather than an editable file */
  diff?: boolean;
}

interface Buffer {
  /** on-disk content at last load/save */
  original: string;
  /** current editor content */
  value: string;
  dirty: boolean;
  saving: boolean;
  loading: boolean;
  error?: string;
}

interface EditorState {
  openFiles: OpenFile[];
  activePath: string | null;
  buffers: Record<string, Buffer>;
  /** markdown tabs default to preview=false (edit); toggled per path */
  mdPreview: Record<string, boolean>;

  open: (file: OpenFile) => void;
  close: (path: string) => void;
  setActive: (path: string) => void;
  setValue: (path: string, value: string) => void;
  save: (path: string) => Promise<void>;
  saveActive: () => void;
  toggleMdPreview: (path: string) => void;
  reload: (path: string) => void;
  /** drop all open files/buffers (e.g. on vault switch) */
  resetAll: () => void;
}

function tabId(f: OpenFile): string {
  return f.diff ? `diff:${f.path}` : f.path;
}

export const useEditor = create<EditorState>((set, get) => ({
  openFiles: [],
  activePath: null,
  buffers: {},
  mdPreview: {},

  open: (file) => {
    const id = tabId(file);
    const exists = get().openFiles.some((f) => tabId(f) === id);
    set((s) => ({
      openFiles: exists ? s.openFiles : [...s.openFiles, file],
      activePath: id,
    }));
    if (!exists && !file.diff && !get().buffers[id]) {
      void loadBuffer(id, file.path, set);
    }
  },

  close: (path) => {
    const buf = get().buffers[path];
    if (buf?.dirty && !window.confirm("Discard unsaved changes?")) return;
    set((s) => {
      const openFiles = s.openFiles.filter((f) => tabId(f) !== path);
      const activePath =
        s.activePath === path
          ? (openFiles[openFiles.length - 1] ? tabId(openFiles[openFiles.length - 1]!) : null)
          : s.activePath;
      const buffers = { ...s.buffers };
      delete buffers[path];
      return { openFiles, activePath, buffers };
    });
  },

  setActive: (path) => set({ activePath: path }),

  setValue: (path, value) =>
    set((s) => {
      const buf = s.buffers[path];
      if (!buf) return s;
      return {
        buffers: { ...s.buffers, [path]: { ...buf, value, dirty: value !== buf.original } },
      };
    }),

  save: async (path) => {
    const buf = get().buffers[path];
    if (!buf || !buf.dirty || buf.saving) return;
    set((s) => ({ buffers: { ...s.buffers, [path]: { ...buf, saving: true } } }));
    try {
      await api.writeFile(path, buf.value);
      set((s) => {
        const b = s.buffers[path];
        return b
          ? { buffers: { ...s.buffers, [path]: { ...b, original: b.value, dirty: false, saving: false } } }
          : s;
      });
    } catch (err) {
      set((s) => {
        const b = s.buffers[path];
        return b
          ? { buffers: { ...s.buffers, [path]: { ...b, saving: false, error: (err as Error).message } } }
          : s;
      });
    }
  },

  saveActive: () => {
    const active = get().activePath;
    if (active && !active.startsWith("diff:")) void get().save(active);
  },

  toggleMdPreview: (path) =>
    set((s) => ({ mdPreview: { ...s.mdPreview, [path]: !s.mdPreview[path] } })),

  reload: (path) => {
    const buf = get().buffers[path];
    if (buf && !buf.dirty) void loadBuffer(path, path, set);
  },

  resetAll: () => set({ openFiles: [], activePath: null, buffers: {}, mdPreview: {} }),
}));

async function loadBuffer(
  id: string,
  path: string,
  set: (fn: (s: EditorState) => Partial<EditorState>) => void,
): Promise<void> {
  set((s) => ({
    buffers: {
      ...s.buffers,
      [id]: { original: "", value: "", dirty: false, saving: false, loading: true },
    },
  }));
  try {
    const text = await api.readFile(path);
    set((s) => ({
      buffers: { ...s.buffers, [id]: { original: text, value: text, dirty: false, saving: false, loading: false } },
    }));
  } catch (err) {
    set((s) => ({
      buffers: {
        ...s.buffers,
        [id]: { original: "", value: "", dirty: false, saving: false, loading: false, error: (err as Error).message },
      },
    }));
  }
}

export const editorTabId = tabId;
