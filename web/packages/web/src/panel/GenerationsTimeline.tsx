import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { CheckpointSummary } from "@zuzuu-web/protocol";
import { InfoDot, StatusPill } from "../components/ui";
import { zuzuuApi } from "../lib/zuzuu-api";
import { GenerationDiff } from "./GenerationDiff";
import { relativeTime, snapshotLabel, GLOSSARY } from "./kit";

// ── date grouping ─────────────────────────────────────────────────────────

function dateBucket(iso: string | null | undefined): string {
  if (!iso) return "Earlier";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "Earlier";
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (diffDays < 1) return "Today";
  if (diffDays < 2) return "Yesterday";
  if (diffDays < 7) return "This week";
  if (diffDays < 30) return "This month";
  return "Earlier";
}

// ── CheckpointRow: one checkpoint entry ──────────────────────────────────

function CheckpointRow({
  cp,
  isLatest,
  isSelected,
  onClick,
}: {
  cp: CheckpointSummary;
  isLatest: boolean;
  isSelected: boolean;
  onClick: () => void;
}) {
  const timeLabel = relativeTime(cp.createdAt);
  const pinCount = Object.keys(cp.pins).length;

  return (
    <button
      onClick={onClick}
      className={`wc-focus group flex w-full flex-col gap-0.5 rounded-[var(--radius-ui)] px-2.5 py-2 text-left transition-colors ${
        isSelected
          ? "bg-elevated border border-border"
          : "hover:bg-hover border border-transparent"
      }`}
    >
      {/* primary row: label / id + latest pill + time */}
      <div className="flex items-center gap-2">
        {/* diamond checkpoint marker */}
        <span className="shrink-0 text-ink-500" aria-hidden>◆</span>
        <span className="min-w-0 flex-1 truncate text-ui text-ink-100 font-medium">
          {cp.label ?? snapshotLabel(cp.id)}
        </span>
        {isLatest && <StatusPill tone="info">Latest</StatusPill>}
        <span className="wc-mono shrink-0 text-meta text-ink-500">
          {timeLabel ?? "—"}
        </span>
      </div>
      {/* secondary row: id + pin count */}
      <div className="flex items-center gap-2 pl-5">
        <span className="wc-mono truncate text-meta text-ink-500 max-w-[140px]" title={cp.id}>
          {snapshotLabel(cp.id)}
        </span>
        <span className="text-meta text-ink-500">·</span>
        <span className="text-meta text-ink-500">
          captures {pinCount} module{pinCount !== 1 ? "s" : ""}
        </span>
      </div>
    </button>
  );
}

// ── GenerationsTimeline ───────────────────────────────────────────────────

/** Whole-brain checkpoint timeline (W2.5 Phase 2).
 *
 *  Design: checkpoints as plentiful "save-states", date-grouped, calm default
 *  (no diff), diff behind a per-checkpoint "Highlight changes" panel.
 *  Each row shows: ◆ label · Latest pill · relative-time / id · pin count.
 *  Selecting a checkpoint reveals the GenerationDiff panel inline.
 */
export function GenerationsTimeline() {
  const [selected, setSelected] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["zuzuu", "checkpoints"],
    queryFn: zuzuuApi.checkpoints,
    refetchInterval: 4000,
  });
  const cps = q.data?.checkpoints ?? [];

  if (q.isLoading) {
    return (
      <div className="text-meta text-ink-500 px-1 py-2">
        Loading snapshots…
      </div>
    );
  }

  if (cps.length === 0) {
    return (
      <div className="px-1 py-3">
        <p className="text-ui text-ink-300">No snapshots yet.</p>
        <p className="mt-1 text-meta text-ink-500">
          Approving proposals saves per-module versions — compose them into a
          snapshot to create a save-point for the whole agent.
        </p>
      </div>
    );
  }

  // newest first → date-grouped
  type Group = { bucket: string; items: { cp: CheckpointSummary; isLatest: boolean }[] };
  const groups: Group[] = [];
  const sorted = [...cps].reverse(); // assume chronological order from API → reverse = newest first
  const latestId = sorted[0]?.id;

  for (const cp of sorted) {
    const bucket = dateBucket(cp.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.bucket === bucket) {
      last.items.push({ cp, isLatest: cp.id === latestId });
    } else {
      groups.push({ bucket, items: [{ cp, isLatest: cp.id === latestId }] });
    }
  }

  return (
    <div className="flex flex-col gap-0 wc-panel-enter">
      <div className="mb-1.5 flex items-center gap-1">
        <span className="wc-eyebrow">Snapshots</span>
        <InfoDot title={GLOSSARY.snapshot!.term}>{GLOSSARY.snapshot!.what}</InfoDot>
      </div>
      {groups.map(({ bucket, items }) => (
        <div key={bucket} className="mb-2">
          <div className="wc-eyebrow mb-1.5 px-1">{bucket}</div>
          <div className="flex flex-col gap-1">
            {items.map(({ cp, isLatest }) => (
              <div key={cp.id}>
                <CheckpointRow
                  cp={cp}
                  isLatest={isLatest}
                  isSelected={cp.id === selected}
                  onClick={() => setSelected(cp.id === selected ? null : cp.id)}
                />
                {cp.id === selected && (
                  <div className="mt-1 ml-2 wc-panel-enter">
                    <GenerationDiff id={cp.id} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
