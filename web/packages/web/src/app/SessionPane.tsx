// The center session pane: agent-session tabs, the always-mounted terminals,
// the load-time center cards (recovery / setup) and the bottom session
// composer — the start surface ("Start a session with…" + host chips).
import { useRef } from "react";
import { useSessions } from "../state/sessions";
import { TermView } from "../term/TermView";
import { Bar, Tab, TabBar, IconButton, StatusDot } from "../components/ui";
import { RecoveryCard, SetupZuzuuCard } from "../components/SessionCards";
import { SessionComposer } from "../components/SessionComposer";
import { centerCard } from "../lib/session-cards";
import { agentTabTitle } from "../faculties/host-launch";
import { useSessionGitQuery, useZuzuuHealthQuery } from "./queries";

export function SessionPane() {
  const { tabs, activeId, loaded: sessionsLoaded, close, setActive } = useSessions();
  const zuzuuHealth = useZuzuuHealthQuery();
  const zuzuuHome = zuzuuHealth.data?.home === true;
  // session-git status for the recovery card (shares the footer indicator's cache)
  const sessionGit = useSessionGitQuery(zuzuuHome);
  const composerRef = useRef<HTMLDivElement>(null);
  const focusComposer = () => composerRef.current?.focus();

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
      {/* terminals — all kept mounted so sessions survive tab switches */}
      <div className="relative min-h-0 flex-1">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className="absolute inset-0"
            style={{ visibility: tab.id === activeId ? "visible" : "hidden" }}
          >
            <TermView
              sessionId={tab.id}
              active={tab.id === activeId}
              sessionType={tab.type}
              host={tab.host}
              onStartNew={focusComposer}
              onCloseTab={() => void close(tab.id)}
            />
          </div>
        ))}
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
