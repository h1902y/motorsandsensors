import { Overlay, Dialog, DialogHeader, Button, prompt } from "../components/ui";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

const tilde = (p: string) => p.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~");

/**
 * Obsidian-style folder picker: browse the filesystem from ~, pick a folder
 * as the workspace, open a recent one, or create a new folder. Selecting one
 * switches the daemon and reloads via the parent's onPick.
 */
export function VaultPicker({
  recent,
  currentRoot,
  onClose,
  onPick,
}: {
  recent: string[];
  currentRoot?: string;
  onClose: () => void;
  onPick: (path: string) => void;
}) {
  const [path, setPath] = useState<string | undefined>(undefined);

  const browse = useQuery({
    queryKey: ["browse", path ?? "~"],
    queryFn: () => api.browse(path),
  });
  const here = browse.data?.path;

  const newFolder = async () => {
    if (!here) return;
    const name = await prompt({ title: "New folder", placeholder: "created here, then opened", okLabel: "Create" });
    if (!name) return;
    try {
      const res = await api.browseMkdir(here, name);
      onPick(res.path);
    } catch (err) {
      window.alert((err as Error).message);
    }
  };

  return (
    <Overlay onClose={onClose}>
      <Dialog width="lg" className="flex h-[60vh] flex-col !max-w-xl">
        <DialogHeader title="Open a folder as workspace" onClose={onClose} />

        {recent.filter((r) => r !== currentRoot).length > 0 && (
          <div className="border-b border-border px-2 py-1.5">
            <div className="px-1 py-0.5 text-meta uppercase tracking-wider text-ink-500">Recent</div>
            <div className="flex flex-wrap gap-1">
              {recent.filter((r) => r !== currentRoot).slice(0, 6).map((r) => (
                <button
                  key={r}
                  onClick={() => onPick(r)}
                  title={r}
                  className="max-w-full truncate rounded border border-border px-2 py-0.5 text-meta text-ink-300 hover:border-accent-dim hover:text-ink-100"
                >
                  {tilde(r)}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* breadcrumb / current path */}
        <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-ui">
          <button
            onClick={() => browse.data?.parent && setPath(browse.data.parent)}
            disabled={!browse.data?.parent}
            className="rounded px-1 text-ink-400 enabled:hover:text-ink-100 disabled:opacity-30"
            title="Up"
          >
            ↑
          </button>
          <span className="truncate text-ink-300" title={here}>{here ? tilde(here) : "…"}</span>
        </div>

        {/* directory list */}
        <div className="min-h-0 flex-1 overflow-auto py-1">
          {browse.isLoading && <div className="px-3 py-2 text-ui text-ink-500">loading…</div>}
          {browse.error && <div className="px-3 py-2 text-ui text-danger">{(browse.error as Error).message}</div>}
          {browse.data?.dirs.length === 0 && <div className="px-3 py-2 text-ui text-ink-500">no subfolders</div>}
          {browse.data?.dirs.map((d) => (
            <div
              key={d.path}
              className="group flex cursor-default items-center gap-2 px-3 py-1 text-ui hover:bg-hover"
              onClick={() => setPath(d.path)}
              onDoubleClick={() => onPick(d.path)}
            >
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 text-accent-dim" fill="currentColor">
                <path d="M1.5 3.5A1.5 1.5 0 013 2h3l1.5 1.5H13A1.5 1.5 0 0114.5 5v7A1.5 1.5 0 0113 13.5H3A1.5 1.5 0 011.5 12v-8.5z" />
              </svg>
              <span className="truncate text-ink-100">{d.name}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onPick(d.path);
                }}
                className="ml-auto hidden rounded border border-border px-2 py-0.5 text-meta text-accent group-hover:block hover:bg-hover"
              >
                open
              </button>
            </div>
          ))}
        </div>

        {/* footer actions */}
        <div className="flex items-center gap-2 border-t border-border px-3 py-2">
          <Button variant="ghost" onClick={() => void newFolder()}>
            New folder…
          </Button>
          <Button variant="primary" className="ml-auto" onClick={() => here && onPick(here)} disabled={!here}>
            Open this folder
          </Button>
        </div>
      </Dialog>
    </Overlay>
  );
}
