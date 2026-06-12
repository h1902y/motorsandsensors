import type { ConnState } from "./state/connection";

/**
 * Thin top strip shown while the daemon is unreachable. Non-blocking — the
 * panels stay mounted and content visible; WS sockets reconnect on their own
 * and the health poll clears this on recovery.
 */
export function DisconnectedBanner({ state }: { state: ConnState }) {
  if (state === "connected") return null;
  const disconnected = state === "disconnected";
  return (
    <div
      className={`flex shrink-0 items-center justify-center gap-2 py-0.5 text-meta ${
        disconnected ? "bg-danger/90 text-ink-950" : "bg-warn/90 text-ink-950"
      }`}
    >
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-app/70" />
      {disconnected ? "Lost connection to the zuzuu-web daemon — retrying…" : "Reconnecting…"}
      {disconnected && (
        <button
          onClick={() => window.location.reload()}
          className="rounded-[var(--radius-sm)] bg-ink-950/20 px-1.5 font-medium hover:bg-ink-950/35"
        >
          Reconnect
        </button>
      )}
    </div>
  );
}
