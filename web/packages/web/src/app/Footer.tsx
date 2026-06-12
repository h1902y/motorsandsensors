// The status bar, pristine: the ❯_ connection mark · vault name (recents
// menu) · session-git indicator · help ⓘ · ⌘K. Review lives in the panel's
// "Needs you" section, not here.
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useConnection } from "../state/connection";
import { useSessions } from "../state/sessions";
import { Bar, IconButton, MenuPopover, type MenuItem } from "../components/ui";
import { SessionIndicator } from "../components/SessionIndicator";
import { startUtilityRun } from "../lib/agent-launch";
import { capRecents, tilde } from "../onboarding/vault-picker-logic";
import { useFilesQuery, useWorkspaceConfigQuery, useWorkspaceQuery } from "./queries";
import { switchVault } from "./vault";

const WIKI = "https://github.com/h1902y/zuzuu/wiki";

function fmtUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}
const fmtMB = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

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
  const { tabs } = useSessions();
  const workspace = useWorkspaceQuery();
  const wsConfig = useWorkspaceConfigQuery();
  const files = useFilesQuery();

  const [vaultMenuOpen, setVaultMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const helpRef = useRef<HTMLSpanElement>(null);
  const vaultRecents = capRecents(wsConfig.data?.recent ?? [], workspace.data?.root, 5);

  const pickVault = (path: string) => {
    setVaultMenuOpen(false);
    void switchVault(queryClient, path);
  };

  const helpItems: MenuItem[] = [
    {
      label: "What is zuzuu? — run zuzuu explain",
      onClick: () => { setHelpOpen(false); void startUtilityRun(["explain"]); },
    },
    {
      label: "Workbench guide ↗",
      onClick: () => { setHelpOpen(false); window.open(`${WIKI}/Workbench`, "_blank", "noopener"); },
    },
    {
      label: "Faculty Standard ↗",
      onClick: () => { setHelpOpen(false); window.open(`${WIKI}/Faculty-Standard`, "_blank", "noopener"); },
    },
  ];

  return (
    <Bar border="t" surface="surface" className="relative !gap-2.5 text-meta text-ink-500">
      {/* the ❯_ mark carries connection health: calm when connected (live
          stats on hover), warn/red + pulse only while reconnecting/down */}
      <span
        className={`shrink-0 ${
          conn.state === "connected"
            ? "text-accent-dim"
            : conn.state === "reconnecting"
              ? "animate-pulse text-warn"
              : "text-danger"
        }`}
        title={[
          `daemon ${conn.state}`,
          files.data ? `${files.data.files.length}${files.data.truncated ? "+" : ""} files` : null,
          `${tabs.filter((t) => t.alive).length} session(s)`,
          conn.uptimeMs !== null ? `up ${fmtUptime(conn.uptimeMs)}` : null,
          conn.rss !== null ? fmtMB(conn.rss) : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      >
        ❯_
      </span>

      {/* vault name → recents menu (Browse stays; cwd lives in session detail) */}
      <div className="relative shrink-0">
        <button
          onClick={() => setVaultMenuOpen((v) => !v)}
          className="max-w-72 truncate rounded-[var(--radius-sm)] px-1 text-ink-300 hover:text-accent"
          title={workspace.data?.root}
        >
          {workspace.data?.name ?? "…"} ▾
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
                className="block w-full px-3 py-1.5 text-left text-ui text-ink-100 hover:bg-hover"
              >
                Browse… <span className="text-ink-500">⌘⇧O</span>
              </button>
              {vaultRecents.length > 0 && (
                <div className="mt-1 border-t border-border pt-1">
                  <div className="px-3 py-0.5 text-meta uppercase tracking-wider text-ink-500">Recent</div>
                  {vaultRecents.map((r) => (
                    <button
                      key={r}
                      onClick={() => pickVault(r)}
                      className="block w-full truncate px-3 py-1 text-left text-ui text-ink-300 hover:bg-hover hover:text-ink-100"
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

      {/* session-git indicator (the old git-branch item's slot) */}
      <SessionIndicator enabled={zuzuuHome} />

      <span className="ml-auto flex shrink-0 items-center gap-1">
        <span ref={helpRef}>
          <IconButton
            title="Help — what is zuzuu?"
            iconPath="M8 2.5a5.5 5.5 0 110 11 5.5 5.5 0 010-11M6.3 6.2a1.8 1.8 0 113 1.3c-.6.5-1.3.8-1.3 1.7M8 11.2v.3"
            onClick={() => setHelpOpen((v) => !v)}
          />
        </span>
        {helpOpen && (
          <MenuPopover items={helpItems} onClose={() => setHelpOpen(false)} anchorEl={helpRef.current} ignore={helpRef} />
        )}
        <button
          onClick={onOpenPalette}
          className="shrink-0 rounded-[var(--radius-sm)] px-1.5 text-ink-500 hover:text-accent"
          title="Command palette"
        >
          ⌘K
        </button>
      </span>
    </Bar>
  );
}
