import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { zuzuuApi } from "../lib/zuzuu-api";
import { launchInTerminal } from "../lib/agent-launch";
import { Button } from "../components/ui";
import { StatusHeader } from "./StatusHeader";
import { HomeCtas } from "./HomeCtas";
import { FacultyCard } from "./FacultyCard";
import { FacultyDetail } from "./FacultyDetail";
import { GenerationsTimeline } from "./GenerationsTimeline";
import { SessionsList } from "./SessionsList";
import { DigestPanel } from "./DigestPanel";

/** The Home surface: the zuzuu faculties dashboard (observe + review), or the
 *  set-up-zuzuu onboarding card when this project has no home yet. */
export function FacultiesView() {
  const [active, setActive] = useState<string | null>(null);
  const faculties = useQuery({ queryKey: ["zuzuu", "faculties"], queryFn: zuzuuApi.faculties, refetchInterval: 4000 });
  const health = useQuery({ queryKey: ["zuzuu", "health"], queryFn: zuzuuApi.health, refetchInterval: 8000 });

  if (health.data?.home === false) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-auto p-5">
        <OnboardingCard zuzuuBin={health.data.zuzuuBin} />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto p-5">
      <StatusHeader />
      <HomeCtas />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {faculties.data?.faculties.map((f) => (
          <FacultyCard key={f.key} data={f} active={f.key === active} onSelect={() => setActive(active === f.key ? null : f.key)} />
        ))}
      </div>
      {active && <FacultyDetail facultyKey={active} />}
      <GenerationsTimeline />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <SessionsList />
        <DigestPanel />
      </div>
    </div>
  );
}

/** No-home onboarding: one card that sets up the zuzuu home in a terminal —
 *  or, with no CLI on PATH, the install banner instead of dead buttons. */
function OnboardingCard({ zuzuuBin }: { zuzuuBin: boolean }) {
  return (
    <div className="mx-auto mt-12 w-full max-w-md rounded-ui border border-border bg-surface p-6">
      <div className="text-base font-medium text-ink-100">This project has no zuzuu home yet</div>
      <p className="mt-2 text-ui leading-relaxed text-ink-300">
        zuzuu sets up a hidden <code className="text-accent-dim">.zuzuu/</code> home in this project
        (like <code className="text-accent-dim">.git</code>) where your agent&apos;s faculties —
        knowledge, memory, actions, instructions, guardrails — live and grow from real sessions.
      </p>
      {zuzuuBin ? (
        <div className="mt-5 flex flex-col items-start gap-3">
          <Button variant="primary" onClick={() => void launchInTerminal("zuzuu init")}>
            Set up zuzuu
          </Button>
          <div className="text-meta text-ink-500">
            then{" "}
            <button
              className="text-accent-dim underline decoration-dotted underline-offset-2 hover:text-accent"
              onClick={() => void launchInTerminal("zuzuu enable")}
            >
              Enable live capture
            </button>{" "}
            to observe sessions as they happen
          </div>
        </div>
      ) : (
        <div className="mt-5 rounded-[var(--radius-sm)] border border-warn/40 bg-[color-mix(in_oklab,var(--color-warn)_10%,transparent)] px-3 py-2 text-ui text-warn">
          zuzuu CLI required — <code>npm i -g @zuzuucodes/cli</code>
        </div>
      )}
    </div>
  );
}
