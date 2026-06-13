// The status bar, calm (app-shell brief): a connection StatusDot · the
// workspace name (still the recents switcher) · the session-git indicator ·
// agent progression pill · a quiet ⌘K hint. The dense mono ❯_ mark, the
// live-stats tooltip and the help menu were retired here — review lives in
// the panel's "Needs you" section, help in the palette.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useConnection } from "../state/connection";
import { Bar, Kbd, StatusDot, cx } from "../components/ui";
import { SessionIndicator } from "../components/SessionIndicator";
import { capRecents, tilde } from "../onboarding/vault-picker-logic";
import { useWorkspaceConfigQuery, useWorkspaceQuery } from "./queries";
import { zuzuuApi } from "../lib/zuzuu-api";
import { pendingTotal } from "../panel/sections";
import { switchVault } from "./vault";

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
  // Only present "Gen N" when there is at least one whole-brain checkpoint —
  // never imply a generation from module counts.
  if (checkpoints !== null && checkpoints > 0) parts.push(`Gen ${checkpoints}`);
  if (totalFacts !== null) parts.push(`${totalFacts} fact${totalFacts !== 1 ? "s" : ""}`);

  return (
    <span
      className="flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-meta text-ink-500"
      style={{ background: "color-mix(in oklab, var(--color-ink-600) 8%, transparent)" }}
      title="Your agent's current state — checkpoints minted, facts known, proposals awaiting review"
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
  onOpenVaultPicker,
}: {
  zuzuuHome: boolean;
  onOpenPalette: () => void;
  onOpenVaultPicker: () => void;
}) {
  const queryClient = useQueryClient();
  const conn = useConnection();
  const workspace = useWorkspaceQuery();
  const wsConfig = useWorkspaceConfigQuery();

  const [vaultMenuOpen, setVaultMenuOpen] = useState(false);
  const vaultRecents = capRecents(wsConfig.data?.recent ?? [], workspace.data?.root, 5);

  const pickVault = (path: string) => {
    setVaultMenuOpen(false);
    void switchVault(queryClient, path);
  };

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

      {/* workspace name → recents switcher (Browse stays; restyled calm) */}
      <div className="relative shrink-0">
        <button
          onClick={() => setVaultMenuOpen((v) => !v)}
          className="wc-sans flex max-w-72 items-center gap-1 truncate rounded-[var(--radius-sm)] px-1 text-ink-300 transition-colors hover:text-ink-100"
          title={workspace.data?.root}
        >
          <span className="truncate">{workspace.data?.name ?? "…"}</span>
          <svg viewBox="0 0 16 16" className={cx("h-2.5 w-2.5 shrink-0 transition-transform", vaultMenuOpen && "rotate-180")} fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {vaultMenuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setVaultMenuOpen(false)} />
            <div
              style={{ boxShadow: "var(--shadow-menu)" }}
              className="absolute bottom-full left-0 z-50 mb-1 max-h-[60vh] w-64 overflow-y-auto rounded-[var(--radius-ui)] border border-border bg-elevated py-1"
            >
              <button
                onClick={() => {
                  setVaultMenuOpen(false);
                  onOpenVaultPicker();
                }}
                className="wc-sans flex w-full items-center px-3 py-1.5 text-left text-ui text-ink-100 transition-colors hover:bg-hover"
              >
                Browse… <span className="ml-auto text-ink-500">⌘⇧O</span>
              </button>
              {vaultRecents.length > 0 && (
                <div className="mt-1 border-t border-border pt-1">
                  <div className="wc-eyebrow px-3 py-0.5">Recent</div>
                  {vaultRecents.map((r) => (
                    <button
                      key={r}
                      onClick={() => pickVault(r)}
                      className="wc-sans block w-full truncate px-3 py-1.5 text-left text-ui text-ink-300 transition-colors hover:bg-hover hover:text-ink-100"
                      title={r}
                    >
                      {tilde(r)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

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
