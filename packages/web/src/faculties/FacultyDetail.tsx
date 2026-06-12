import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProposalSummary } from "@zuzuu-web/protocol";
import { describeZuzuuError, zuzuuApi } from "../lib/zuzuu-api";
import { confirm } from "../components/ui";
import { ProposalRow } from "./ProposalRow";

/** Drill-in for one faculty: its items + its pending proposals (inline approve/reject). */
export function FacultyDetail({ facultyKey }: { facultyKey: string }) {
  const queryClient = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const detail = useQuery({
    queryKey: ["zuzuu", "faculty", facultyKey],
    queryFn: () => zuzuuApi.faculty(facultyKey),
    refetchInterval: 4000,
  });

  const run = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try {
      await fn();
      void queryClient.invalidateQueries({ queryKey: ["zuzuu"] });
    } catch (e) {
      setErr(describeZuzuuError(e));
    }
  };

  // The actions faculty's pending list is its inbox — those go through act
  // approve/reject by slug; every other faculty through the proposal routes.
  const approve = (p: ProposalSummary) =>
    void run(() => (facultyKey === "actions" ? zuzuuApi.approveAction(p.id) : zuzuuApi.approveProposal(p.id, p.faculty)));
  const reject = async (p: ProposalSummary) => {
    const ok = await confirm({ title: "Reject proposal?", message: p.title, okLabel: "Reject", danger: true });
    if (!ok) return;
    void run(() => (facultyKey === "actions" ? zuzuuApi.rejectAction(p.id) : zuzuuApi.rejectProposal(p.id, p.faculty)));
  };

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
          {d.proposals.map((p) => (
            <ProposalRow key={p.id} data={p} onApprove={() => approve(p)} onReject={() => void reject(p)} />
          ))}
        </div>
      )}
      {err && <div className="mt-2 break-all font-mono text-meta text-danger">{err}</div>}
    </div>
  );
}
