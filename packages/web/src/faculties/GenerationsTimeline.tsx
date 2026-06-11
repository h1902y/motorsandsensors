import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { zuzuuApi } from "../lib/zuzuu-api";
import { GenerationDiff } from "./GenerationDiff";

/** The generations timeline (dots, active marked); click → the diff. */
export function GenerationsTimeline() {
  const [selected, setSelected] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["zuzuu", "generations"], queryFn: zuzuuApi.generations, refetchInterval: 4000 });
  const gens = q.data?.generations ?? [];

  return (
    <div className="flex flex-col gap-2">
      <div className="text-meta uppercase tracking-wide text-ink-500">generations</div>
      {gens.length === 0 ? (
        <div className="text-meta text-ink-600">no generations yet — approving proposals mints one</div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {gens.map((g) => {
            const isActive = g.id === q.data?.active;
            const isSel = g.id === selected;
            return (
              <button
                key={g.id}
                onClick={() => setSelected(isSel ? null : g.id)}
                className={`flex items-center gap-1 rounded-ui border px-2 py-1 text-meta transition-colors ${
                  isSel ? "border-accent bg-elevated" : "border-border bg-surface hover:bg-hover"
                }`}
                title={g.mintedAt ?? ""}
              >
                <span className={isActive ? "text-accent" : "text-ink-500"}>●</span>
                <span className="text-ink-300">{g.id}</span>
              </button>
            );
          })}
        </div>
      )}
      {selected && <GenerationDiff id={selected} />}
    </div>
  );
}
