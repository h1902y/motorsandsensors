import { useQuery } from "@tanstack/react-query";
import { zuzuuApi } from "../lib/zuzuu-api";

function facultyLine(name: string, d: { added?: string[]; changed?: string[] | boolean; removed?: string[] }): string {
  const parts: string[] = [];
  if (Array.isArray(d.added) && d.added.length) parts.push(`+${d.added.length} added`);
  if (Array.isArray(d.changed) && d.changed.length) parts.push(`~${d.changed.length} changed`);
  else if (d.changed === true) parts.push("changed");
  if (Array.isArray(d.removed) && d.removed.length) parts.push(`-${d.removed.length} removed`);
  return `${name}: ${parts.length ? parts.join(" · ") : "no change"}`;
}

/** The per-faculty diff for one generation (needs the zuzuu CLI). */
export function GenerationDiff({ id }: { id: string }) {
  const q = useQuery({ queryKey: ["zuzuu", "generation", id], queryFn: () => zuzuuApi.generation(id) });
  if (q.isLoading) return <div className="text-meta text-ink-500">loading diff…</div>;
  if (q.error) return <div className="text-meta text-ink-500">diff needs the zuzuu CLI on PATH</div>;
  const d = q.data;
  if (!d) return null;
  return (
    <div className="rounded-ui border border-border bg-surface p-3 text-ui">
      <div className="mb-1 font-medium text-ink-100">{d.id}</div>
      <div className="mb-2 text-meta text-ink-500">
        forkedFrom {d.forkedFrom ?? "(none)"} · from {d.mintedFrom.length} proposal(s)
      </div>
      <div className="flex flex-col gap-0.5 text-meta text-ink-300">
        {Object.entries(d.faculties).map(([name, fd]) => <div key={name}>{facultyLine(name, fd)}</div>)}
      </div>
    </div>
  );
}
