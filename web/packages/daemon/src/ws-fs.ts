import { watch, type FSWatcher } from "chokidar";
import type { WebSocket } from "ws";
import type { FsClientMessage, FsServerMessage } from "@zuzuu-web/protocol";
import { resolveSafe } from "./safe-path.js";

const DEBOUNCE_MS = 120;
const MAX_WATCHES = 200;

/**
 * The explorer watches only the directories it currently has expanded —
 * non-recursive, one watcher each — so fd usage stays bounded no matter how
 * big the workspace is. Events are debounced per directory and the client
 * just refetches that directory's listing.
 */
export function handleFsSocket(ws: WebSocket, root: string): void {
  const watchers = new Map<string, FSWatcher>();
  const pending = new Map<string, NodeJS.Timeout>();

  const notify = (relPath: string) => {
    clearTimeout(pending.get(relPath));
    pending.set(
      relPath,
      setTimeout(() => {
        pending.delete(relPath);
        if (ws.readyState === ws.OPEN) {
          const msg: FsServerMessage = { type: "changed", path: relPath };
          ws.send(JSON.stringify(msg));
        }
      }, DEBOUNCE_MS),
    );
  };

  ws.on("message", (raw) => {
    void (async () => {
      let msg: FsClientMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type === "watch") {
        if (watchers.has(msg.path) || watchers.size >= MAX_WATCHES) return;
        let abs: string;
        try {
          abs = await resolveSafe(root, msg.path);
        } catch {
          return;
        }
        const watcher = watch(abs, {
          depth: 0,
          ignoreInitial: true,
          followSymlinks: false,
        });
        watcher.on("all", () => notify(msg.path));
        watcher.on("error", () => {});
        watchers.set(msg.path, watcher);
      } else if (msg.type === "unwatch") {
        const watcher = watchers.get(msg.path);
        if (watcher) {
          watchers.delete(msg.path);
          void watcher.close();
        }
      }
    })();
  });

  ws.on("close", () => {
    for (const timer of pending.values()) clearTimeout(timer);
    pending.clear();
    for (const watcher of watchers.values()) void watcher.close();
    watchers.clear();
  });
}
