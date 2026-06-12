import { useQuery } from "@tanstack/react-query";
import { zuzuuApi } from "../lib/zuzuu-api";
import { StatusHeader } from "./StatusHeader";
import { DigestPanel } from "./DigestPanel";
import { GenerationsTimeline } from "./GenerationsTimeline";
import { SessionsList } from "./SessionsList";

/** The right panel's resting overview — composed from the former dashboard
 *  pieces: generation/pending summary, digest peek, generations, latest
 *  sessions. (Renders only when a zuzuu home exists.) */
export function PulseTab() {
  const health = useQuery({ queryKey: ["zuzuu", "health"], queryFn: zuzuuApi.health, refetchInterval: 8000 });
  return (
    <div className="flex flex-col gap-4 p-3">
      {health.data?.zuzuuBin === false && (
        <div className="rounded-[var(--radius-sm)] border border-warn/40 bg-[color-mix(in_oklab,var(--color-warn)_10%,transparent)] px-3 py-2 text-ui text-warn">
          zuzuu CLI required — <code>npm i -g @zuzuucodes/cli</code>
        </div>
      )}
      <StatusHeader />
      <DigestPanel compact />
      <GenerationsTimeline />
      <SessionsList limit={3} />
    </div>
  );
}
