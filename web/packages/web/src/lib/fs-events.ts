import type { FsServerMessage } from "@zuzuu-web/protocol";
import { wsUrl } from "./api";

type ChangeListener = (path: string) => void;

/**
 * Singleton connection to /ws/fs. Tracks which directories the explorer has
 * expanded and re-subscribes them after a reconnect. The daemon watches each
 * subscribed directory (non-recursively) and pushes "changed" events.
 */
class FsEvents {
  private ws: WebSocket | null = null;
  private readonly watched = new Set<string>();
  private listener: ChangeListener | null = null;
  private retries = 0;
  private started = false;

  start(listener: ChangeListener): void {
    this.listener = listener;
    if (this.started) return;
    this.started = true;
    this.watched.add(""); // root is always visible
    this.connect();
  }

  private connect(): void {
    const ws = new WebSocket(wsUrl("/ws/fs"));
    this.ws = ws;
    ws.onopen = () => {
      this.retries = 0;
      for (const path of this.watched) {
        ws.send(JSON.stringify({ type: "watch", path }));
      }
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as FsServerMessage;
        if (msg.type === "changed") this.listener?.(msg.path);
      } catch {
        // ignore malformed frames
      }
    };
    ws.onclose = () => {
      this.ws = null;
      if (this.retries >= 6) return;
      const delay = Math.min(500 * 2 ** this.retries, 8000);
      this.retries += 1;
      setTimeout(() => this.connect(), delay);
    };
  }

  watch(path: string): void {
    if (this.watched.has(path)) return;
    this.watched.add(path);
    this.send({ type: "watch", path });
  }

  unwatch(path: string): void {
    if (path === "" || !this.watched.delete(path)) return;
    this.send({ type: "unwatch", path });
  }

  private send(msg: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
}

export const fsEvents = new FsEvents();
