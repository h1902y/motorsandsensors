import { useQuery } from "@tanstack/react-query";
import { zuzuuApi } from "../lib/zuzuu-api";
import { ProposalRow } from "./ProposalRow";

/** Drill-in for one faculty: its items + its pending proposals. */
export function FacultyDetail({ facultyKey }: { facultyKey: string }) {
  const detail = useQuery({
    queryKey: ["zuzuu", "faculty", facultyKey],
    queryFn: () => zuzuuApi.faculty(facultyKey),
    refetchInterval: 4000,
  });
  if (detail.isLoading) return <div className="text-meta text-ink-500">loading…</div>;
  const d = detail.data;
  if (!d) return <div className="text-meta text-ink-500">no data</div>;

  return (
    <div className="rounded-ui border border-border bg-surface p-3">
      <div className="mb-2 text-meta uppercase tracking-wide text-ink-500">{facultyKey}</div>

      <div className="mb-1 text-meta text-ink-500">items ({d.items.length})</div>
      {d.items.length === 0 ? (
        <div className="mb-3 text-meta text-ink-600">none yet</div>
      ) : (
        <div className="mb-3 flex flex-col">
          {d.items.map((it) => (
            <div key={it.id} className="truncate border-b border-border py-1 text-ui text-ink-300 last:border-0">{it.title}</div>
          ))}
        </div>
      )}

      <div className="mb-1 text-meta text-ink-500">pending proposals ({d.proposals.length})</div>
      {d.proposals.length === 0 ? (
        <div className="text-meta text-ink-600">nothing pending</div>
      ) : (
        <div className="flex flex-col">
          {d.proposals.map((p) => <ProposalRow key={p.id} data={p} />)}
        </div>
      )}
    </div>
  );
}
