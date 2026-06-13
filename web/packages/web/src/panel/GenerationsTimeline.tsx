import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { zuzuuApi } from "../lib/zuzuu-api";
import { GenerationDiff } from "./GenerationDiff";

/** Whole-brain checkpoint timeline (W2.5 Phase 2: generations are per-module now;
 *  a checkpoint composes them). Dots = minted checkpoints; click → its pins.
 *  Phase 3 builds the rich per-module lineage drill-in. */
export function GenerationsTimeline() {
  const [selected, setSelected] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["zuzuu", "checkpoints"], queryFn: zuzuuApi.checkpoints, refetchInterval: 4000 });
  const cps = q.data?.checkpoints ?? [];

  return (
    <div className="flex flex-col gap-2">
      <div className="wc-eyebrow">checkpoints</div>
      {cps.length === 0 ? (
        <div className="text-meta text-ink-600">no checkpoints yet — approving proposals mints per-module generations; compose them into a checkpoint</div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {cps.map((cp) => {
            const isSel = cp.id === selected;
            return (
              <button
                key={cp.id}
                onClick={() => setSelected(isSel ? null : cp.id)}
                className={`flex items-center gap-1 rounded-ui border px-2 py-1 text-meta transition-colors ${
                  isSel ? "border-accent bg-elevated" : "border-border bg-surface hover:bg-hover"
                }`}
                title={cp.label ?? cp.createdAt ?? ""}
              >
                <span className="text-accent">◆</span>
                <span className="text-ink-300">{cp.id}</span>
              </button>
            );
          })}
        </div>
      )}
      {selected && <GenerationDiff id={selected} />}
    </div>
  );
}
