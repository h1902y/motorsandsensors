import { useQuery } from "@tanstack/react-query";
import type { ModuleKey } from "@zuzuu-web/protocol";
import { zuzuuApi } from "../lib/zuzuu-api";
import { relativeTime, snapshotLabel } from "./kit";

// ── shared helpers ────────────────────────────────────────────────────────

function DiffPill({
  label,
  tone,
}: {
  label: string;
  tone: "add" | "change" | "remove";
}) {
  const cls =
    tone === "add"
      ? "text-success bg-[color-mix(in_oklab,var(--color-success)_12%,transparent)]"
      : tone === "remove"
        ? "text-error bg-[color-mix(in_oklab,var(--color-error)_12%,transparent)]"
        : "text-warn bg-[color-mix(in_oklab,var(--color-warn)_12%,transparent)]";
  return (
    <span
      className={`wc-mono inline-flex items-center rounded-full px-2 py-0.5 text-meta font-medium ${cls}`}
    >
      {label}
    </span>
  );
}

function DiffList({
  items,
  tone,
  emptyLabel,
}: {
  items: string[];
  tone: "add" | "change" | "remove";
  emptyLabel?: string;
}) {
  if (items.length === 0) {
    return emptyLabel ? (
      <span className="text-meta text-ink-500">{emptyLabel}</span>
    ) : null;
  }
  return (
    <div className="flex flex-col gap-0.5">
      {items.map((item) => (
        <div key={item} className="flex items-baseline gap-2">
          <span
            className={`shrink-0 text-meta ${tone === "add" ? "text-success" : tone === "remove" ? "text-error" : "text-warn"}`}
          >
            {tone === "add" ? "+" : tone === "remove" ? "−" : "~"}
          </span>
          <span className="wc-mono min-w-0 truncate text-meta text-ink-300">
            {item}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── ModuleGenerationDiffPanel ─────────────────────────────────────────────

/** Diff detail for a single module generation (used from ModuleGenerations when
 *  the "Highlight changes" toggle is ON). Fetches the per-module diff endpoint.
 */
function ModuleGenerationDiffPanel({
  id,
  moduleKey,
}: {
  id: string;
  moduleKey: ModuleKey;
}) {
  const q = useQuery({
    queryKey: ["zuzuu", "module", moduleKey, "generation", id],
    queryFn: () => zuzuuApi.moduleGeneration(moduleKey, id),
  });

  if (q.isLoading) {
    return <div className="text-meta text-ink-500">Loading diff…</div>;
  }
  if (q.error) {
    return (
      <div className="text-meta text-ink-500">
        Diff unavailable — zuzuu CLI may be offline.
      </div>
    );
  }
  const diff = q.data;
  if (!diff) return null;

  const hasChanges =
    diff.added.length + diff.changed.length + diff.removed.length > 0;

  return (
    <div className="rounded-[var(--radius-ui)] border border-border bg-surface p-2.5">
      {/* summary pills */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {diff.added.length > 0 && (
          <DiffPill label={`+${diff.added.length} added`} tone="add" />
        )}
        {diff.changed.length > 0 && (
          <DiffPill label={`~${diff.changed.length} changed`} tone="change" />
        )}
        {diff.removed.length > 0 && (
          <DiffPill label={`−${diff.removed.length} removed`} tone="remove" />
        )}
        {!hasChanges && (
          <span className="text-meta text-ink-500">No changes from prior version.</span>
        )}
        {diff.against && (
          <span className="ml-auto wc-mono text-meta text-ink-500 truncate max-w-[120px]" title={diff.against}>
            vs {diff.against}
          </span>
        )}
      </div>

      {/* item lists */}
      {hasChanges && (
        <div className="flex flex-col gap-2">
          <DiffList items={diff.added} tone="add" />
          <DiffList items={diff.changed} tone="change" />
          <DiffList items={diff.removed} tone="remove" />
        </div>
      )}
    </div>
  );
}

// ── CheckpointDiffPanel ───────────────────────────────────────────────────

/** One checkpoint's module pins (used from GenerationsTimeline on selection).
 *  The diff toggle lives in GenerationsTimeline; this panel renders the
 *  selected checkpoint's pins, always visible when a checkpoint is selected.
 */
function CheckpointDiffPanel({ id }: { id: string }) {
  const q = useQuery({
    queryKey: ["zuzuu", "checkpoints"],
    queryFn: zuzuuApi.checkpoints,
  });

  if (q.isLoading) {
    return <div className="text-meta text-ink-500">Loading snapshot…</div>;
  }
  if (q.error) {
    return (
      <div className="text-meta text-ink-500">
        Snapshots unavailable — zuzuu CLI may be offline.
      </div>
    );
  }
  const cp = q.data?.checkpoints.find((c) => c.id === id);
  if (!cp) return null;

  const pins = Object.entries(cp.pins);
  const timeLabel = relativeTime(cp.createdAt);

  return (
    <div className="rounded-[var(--radius-ui)] border border-border bg-surface p-2.5">
      {/* header */}
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-ui font-medium text-ink-100">
          {cp.label ?? snapshotLabel(cp.id)}
        </span>
        {timeLabel && (
          <>
            <span className="text-meta text-ink-500">·</span>
            <span className="wc-mono text-meta text-ink-500">{timeLabel}</span>
          </>
        )}
      </div>

      {/* module pins */}
      {pins.length > 0 ? (
        <div className="flex flex-col gap-1">
          {pins.map(([module, gen]) => (
            <div key={module} className="flex items-baseline gap-2">
              <span className="text-meta text-ink-300 capitalize w-24 shrink-0">
                {module}
              </span>
              <span className="wc-mono text-meta text-ink-500 truncate" title={gen}>
                {gen}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-meta text-ink-500">No modules captured.</div>
      )}
    </div>
  );
}

// ── GenerationDiff (public export) ────────────────────────────────────────

/** Unified diff/detail panel.
 *
 *  - With `moduleKey`: shows the per-module generation diff (added/changed/removed).
 *    Used by ModuleGenerations behind the "Highlight changes" toggle.
 *  - Without `moduleKey`: shows a checkpoint's module pins.
 *    Used by GenerationsTimeline when a checkpoint is selected.
 *
 *  Diff is NEVER shown by default — the parent controls the toggle.
 */
export function GenerationDiff({
  id,
  moduleKey,
}: {
  id: string;
  moduleKey?: ModuleKey;
}) {
  if (moduleKey) {
    return <ModuleGenerationDiffPanel id={id} moduleKey={moduleKey} />;
  }
  return <CheckpointDiffPanel id={id} />;
}
