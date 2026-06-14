// Single-active-tab enforcement (same browser): when a newer tab loads the
// workspace, older tabs are "superseded" and show a calm takeover overlay
// (reload to reclaim). The daemon already hands the newest tab the live
// terminal socket (close code 4000); this makes that handoff explicit instead
// of leaving the old tab with a silently-dead terminal. Cross-browser tabs
// don't share a BroadcastChannel — that rarer case just sees the terminal go
// "closed" without the overlay.
import { create } from "zustand";

interface TakeoverState {
  superseded: boolean;
}

export const useTakeover = create<TakeoverState>(() => ({ superseded: false }));

const CHANNEL = "zuzuu-web:tabs";
// unique per page load; a reload gets a fresh id so it re-claims the workspace
const TAB_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
let channel: BroadcastChannel | null = null;

/** Call once at app start. Announces this tab; any older tab that hears a
 *  newer claim supersedes itself. Newest loader wins; reload re-claims. */
export function initTabGuard(): void {
  if (channel || typeof BroadcastChannel === "undefined") return;
  channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (e: MessageEvent) => {
    const m = e.data as { type?: string; tabId?: string } | null;
    // BroadcastChannel never echoes to the sender; the id check is belt-and-braces
    if (m?.type === "claim" && m.tabId !== TAB_ID) {
      useTakeover.setState({ superseded: true });
    }
  };
  channel.postMessage({ type: "claim", tabId: TAB_ID });
}
