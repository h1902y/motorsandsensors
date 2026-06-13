import { useQuery } from "@tanstack/react-query";
import { zuzuuApi } from "../lib/zuzuu-api";

/** One checkpoint's pins: module → pinned generation (W2.5 Phase 2). Phase 3
 *  builds the rich per-module generation diff drill-in. */
export function GenerationDiff({ id }: { id: string }) {
  const q = useQuery({ queryKey: ["zuzuu", "checkpoints"], queryFn: zuzuuApi.checkpoints });
  if (q.isLoading) return <div className="text-meta text-ink-500">loading checkpoint…</div>;
  if (q.error) return <div className="text-meta text-ink-500">checkpoints need the zuzuu CLI on PATH</div>;
  const cp = q.data?.checkpoints.find((c) => c.id === id);
  if (!cp) return null;
  const pins = Object.entries(cp.pins);
  return (
    <div className="rounded-ui border border-border bg-surface p-3 text-ui">
      <div className="mb-1 font-medium text-ink-100">{cp.id}{cp.label ? ` — ${cp.label}` : ""}</div>
      <div className="mb-2 text-meta text-ink-500">{cp.createdAt ?? ""} · pins {pins.length} module(s)</div>
      <div className="flex flex-col gap-0.5 text-meta text-ink-300">
        {pins.map(([module, gen]) => <div key={module}>{module}: {gen}</div>)}
      </div>
    </div>
  );
}
