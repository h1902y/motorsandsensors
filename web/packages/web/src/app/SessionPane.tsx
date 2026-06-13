// The center session pane. Each session is rendered as a CONVERSATION first:
// a calm transcript of one-line receipts (the default tab) with the live
// xterm terminal demoted to a sibling "Terminal" tab in the same work pane.
// Also: the agent-session tab strip, the load-time center cards (recovery /
// setup) and the bottom session composer ("Start a session with…").
import { useRef, useState } from "react";
import { useSessions } from "../state/sessions";
import { TermView } from "../term/TermView";
import { Bar, Tab, TabBar, IconButton, StatusDot } from "../components/ui";
import { RecoveryCard, SetupZuzuuCard, SessionTranscript } from "../components/SessionCards";
import { SessionComposer } from "../components/SessionComposer";
import { centerCard } from "../lib/session-cards";
import { agentTabTitle } from "../modules/host-launch";
import { useSessionGitQuery, useZuzuuHealthQuery } from "./queries";

/** Which sub-surface of a session's work pane is showing. */
type WorkTab = "conversation" | "terminal";

export function SessionPane() {
  const { tabs, activeId, loaded: sessionsLoaded, close, setActive } = useSessions();
  const zuzuuHealth = useZuzuuHealthQuery();
  const zuzuuHome = zuzuuHealth.data?.home === true;
  // session-git status for the recovery card (shares the footer indicator's cache)
  const sessionGit = useSessionGitQuery(zuzuuHome);
  const composerRef = useRef<HTMLDivElement>(null);
  const focusComposer = () => composerRef.current?.focus();

  // per-session work-pane tab — conversation is the hero default; the terminal
  // is on-demand. Tracked per id so switching sessions keeps each one's view.
  const [workTab, setWorkTab] = useState<Record<string, WorkTab>>({});
  const tabOf = (id: string): WorkTab => workTab[id] ?? "conversation";
  const setTabOf = (id: string, t: WorkTab) => setWorkTab((m) => ({ ...m, [id]: t }));

  // hold the boot-time card until health + session-git have answered once, so
  // a leftover branch renders recovery directly instead of flashing the rest state
  const bootUnknown =
    tabs.length === 0 && (zuzuuHealth.isPending || (zuzuuHome && sessionGit.isPending));
  const card =
    sessionsLoaded && !bootUnknown ? centerCard(tabs.length, sessionGit.data) : { kind: "none" as const };
  // onboarding owns the empty pane until a zuzuu home exists
  const showSetup =
    sessionsLoaded && !bootUnknown && tabs.length === 0 && zuzuuHealth.data?.home === false;

  return (
    <div className="flex h-full min-w-0 flex-col">
      <Bar border="b" surface="surface" className="!gap-0 overflow-x-auto !px-0">
        <TabBar>
          {tabs.map((tab) => {
            // agent tabs carry the host's display name; shells keep the live title
            const label = tab.type === "agent" ? agentTabTitle(tab.host) : tab.title;
            return (
              <Tab
                key={tab.id}
                active={tab.id === activeId}
                onClick={() => setActive(tab.id)}
                onClose={() => void close(tab.id)}
                title={tab.cwdLive ? `${label} · ${tab.cwdLive.cwd}` : label}
                leading={<StatusDot tone={tab.alive ? "ok" : "idle"} />}
              >
                {label}
              </Tab>
            );
          })}
        </TabBar>
        <IconButton
          title="New agent session — pick a host below"
          iconPath="M8 3v10M3 8h10"
          className="mx-1"
          onClick={focusComposer}
        />
      </Bar>
      {/* the work pane — one per session, all kept mounted so the terminals
          (and their PTYs) survive session switches and work-tab switches */}
      <div className="relative min-h-0 flex-1">
        {tabs.map((tab) => {
          const active = tab.id === activeId;
          const view = tabOf(tab.id);
          return (
            <div
              key={tab.id}
              className="absolute inset-0 flex min-h-0 flex-col"
              style={{ visibility: active ? "visible" : "hidden" }}
            >
              {/* work-pane sub-tabs: Conversation (the hero) | Terminal (raw) */}
              <Bar border="b" surface="app" className="!px-0">
                <TabBar>
                  <Tab
                    active={view === "conversation"}
                    onClick={() => setTabOf(tab.id, "conversation")}
                  >
                    Conversation
                  </Tab>
                  <Tab
                    active={view === "terminal"}
                    onClick={() => setTabOf(tab.id, "terminal")}
                    leading={<StatusDot tone={tab.alive ? "ok" : "idle"} />}
                  >
                    Terminal
                  </Tab>
                </TabBar>
              </Bar>
              <div className="relative min-h-0 flex-1">
                {/* Conversation — the receipts transcript (default surface) */}
                <div
                  className="absolute inset-0"
                  style={{ visibility: view === "conversation" ? "visible" : "hidden" }}
                >
                  <SessionTranscript sessionId={tab.id} alive={tab.alive} />
                </div>
                {/* Terminal — the SAME TermView, only relocated into this tab
                    panel. Kept always-mounted (visibility toggle, never
                    unmounted) so the PTY / WebSocket / flow-control are
                    untouched. */}
                <div
                  className="absolute inset-0"
                  style={{ visibility: active && view === "terminal" ? "visible" : "hidden" }}
                >
                  <TermView
                    sessionId={tab.id}
                    active={active && view === "terminal"}
                    sessionType={tab.type}
                    host={tab.host}
                    onStartNew={focusComposer}
                    onCloseTab={() => void close(tab.id)}
                  />
                </div>
              </div>
            </div>
          );
        })}
        {/* the calm resting state — nothing but the mark above the composer */}
        {tabs.length === 0 && card.kind === "none" && !showSetup && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="select-none text-2xl text-ink-600">❯_</span>
          </div>
        )}
        {/* load-time center cards: recovery (leftover session branch) and
            setup (no zuzuu home yet) keep their center placement */}
        {(card.kind === "recovery" || showSetup) && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-app/90 p-6">
            {card.kind === "recovery" ? (
              <RecoveryCard branch={card.branch} checkpoints={card.checkpoints} />
            ) : (
              <SetupZuzuuCard zuzuuBin={zuzuuHealth.data?.zuzuuBin ?? false} />
            )}
          </div>
        )}
      </div>
      {/* the composer — the one way to start a session (hosts only) */}
      {zuzuuHome && <SessionComposer ref={composerRef} />}
    </div>
  );
}
