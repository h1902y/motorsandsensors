import type { FacultySummary } from "@zuzuu-web/protocol";

const LABEL: Record<string, string> = {
  knowledge: "Knowledge", memory: "Memory", actions: "Actions",
  instructions: "Instructions", guardrails: "Guardrails",
};

export function FacultyCard({ data, active, onSelect }: { data: FacultySummary; active: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      className={`flex flex-col items-start gap-1 rounded-ui border p-3 text-left transition-colors ${
        active ? "border-accent bg-elevated" : "border-border bg-surface hover:bg-hover"
      }`}
    >
      <span className="text-ui font-medium text-ink-100">{LABEL[data.key] ?? data.key}</span>
      <span className="text-meta text-ink-500">{data.count} item{data.count === 1 ? "" : "s"}</span>
      {data.pending > 0 && <span className="text-meta text-accent">{data.pending} pending</span>}
    </button>
  );
}
