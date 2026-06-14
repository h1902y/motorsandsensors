// The status bar, calm (app-shell brief): a connection StatusDot · the
// session-git indicator · the agent progression pill · a quiet ⌘K hint. The
// workspace/recents switcher moved entirely into the sidebar's single
// workspace dropdown (one directory control), so the footer is status-only.
import { useQuery } from "@tanstack/react-query";
import { useConnection } from "../state/connection";
import { Bar, Kbd, StatusDot } from "../components/ui";
import { SessionIndicator } from "../components/SessionIndicator";
import { zuzuuApi } from "../lib/zuzuu-api";
import { pendingTotal } from "../panel/sections";

/** Ambient "Your agent" progression pill — calm, always-on evidence of growth.
 *  Only renders when there is a zuzuu home; metrics appear only when present. */
function AgentProgressionPill({ zuzuuHome }: { zuzuuHome: boolean }) {
  const status = useQuery({
    queryKey: ["zuzuu", "status"],
    queryFn: zuzuuApi.status,
    refetchInterval: 8000,
    enabled: zuzuuHome,
  });
  const overview = useQuery({
    queryKey: ["zuzuu", "overview"],
    queryFn: zuzuuApi.overview,
    refetchInterval: 8000,
    enabled: zuzuuHome,
  });

  if (!zuzuuHome) return null;

  // whole-brain checkpoint count — a checkpoint IS the composed whole-agent
  // generation, so "Gen N" honestly reflects the minted checkpoint number.
  const checkpoints = status.data?.checkpoints ?? null;
  // total knowledge items (first approximation of "facts")
  const knowledgeEntry = overview.data?.modules.find((m) => m.id === "knowledge");
  const totalFacts = knowledgeEntry?.counts.items ?? null;
  // total pending proposals across all modules
  const totalPending = overview.data?.modules ? pendingTotal(overview.data.modules) : null;

  // nothing loaded yet → don't render a skeleton
  if (checkpoints === null && totalFacts === null && totalPending === null) return null;

  const hasPending = (totalPending ?? 0) > 0;

  const parts: string[] = [];
  // Only present "vN" when there is at least one whole-brain snapshot —
  // never imply a version from module counts.
  if (checkpoints !== null && checkpoints > 0) parts.push(`v${checkpoints}`);
  if (totalFacts !== null) parts.push(`${totalFacts} fact${totalFacts !== 1 ? "s" : ""}`);

  return (
    <span
      className="flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-meta text-ink-500"
      style={{ background: "color-mix(in oklab, var(--color-ink-600) 8%, transparent)" }}
      title="Your agent's current state — snapshots saved, facts known, proposals awaiting review"
    >
      <span className="wc-sans text-ink-400">Your agent:</span>
      {parts.length > 0 && (
        <span className="wc-sans text-ink-300">{parts.join(" · ")}</span>
      )}
      {hasPending && (
        <>
          <span aria-hidden className="text-ink-600">·</span>
          <span
            className="wc-sans font-medium tabular-nums"
            style={{ color: "color-mix(in oklab, var(--color-warn) 82%, white)" }}
          >
            {totalPending} pending
          </span>
        </>
      )}
    </span>
  );
}

export function Footer({
  zuzuuHome,
  onOpenPalette,
}: {
  zuzuuHome: boolean;
  onOpenPalette: () => void;
}) {
  const conn = useConnection();

  const connTone = conn.state === "connected" ? "ok" : conn.state === "reconnecting" ? "warn" : "bad";
  const connLabel =
    conn.state === "connected" ? "Connected" : conn.state === "reconnecting" ? "Reconnecting…" : "Disconnected";

  return (
    <Bar border="t" surface="surface" className="relative !gap-2.5 text-meta text-ink-500">
      {/* calm connection status */}
      <span className="flex shrink-0 items-center gap-1.5" title={`daemon ${conn.state}`}>
        <StatusDot tone={connTone} pulse={conn.state === "reconnecting"} />
        <span className="wc-sans text-ink-400">{connLabel}</span>
      </span>

      <span aria-hidden className="text-ink-600">·</span>

      {/* session-git indicator (restyled context-only; its own quiet popover) */}
      <SessionIndicator enabled={zuzuuHome} />

      {/* ambient agent progression pill — calm always-on evidence of growth */}
      <AgentProgressionPill zuzuuHome={zuzuuHome} />

      <button
        onClick={onOpenPalette}
        className="wc-sans ml-auto flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] px-1 text-ink-400 transition-colors hover:text-ink-100"
        title="Command palette"
      >
        <span>Commands</span>
        <Kbd>⌘K</Kbd>
      </button>
    </Bar>
  );
}
