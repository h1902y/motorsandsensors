import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ModuleKey } from "@zuzuu-web/protocol";
import { Button, Segmented, StatusPill, Toast } from "../components/ui";
import { describeZuzuuError, zuzuuApi } from "../lib/zuzuu-api";
import { GenerationDiff } from "./GenerationDiff";
import { moduleHue, relativeTime, versionLabel } from "./kit";

// ── date grouping helpers ─────────────────────────────────────────────────

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

// ── LadderNode: one generation entry ─────────────────────────────────────

interface GenerationSummary {
  id: string;
  mintedAt: string | null;
  mintedFrom: string[];
}

function LadderNode({
  gen,
  index,
  total,
  isActive,
  isLast,
  onActivate,
  disabled,
  busy,
  moduleKey,
  showDiff,
}: {
  gen: GenerationSummary;
  index: number;
  total: number;
  isActive: boolean;
  isLast: boolean;
  onActivate: (id: string) => void;
  disabled: boolean;
  busy: boolean;
  moduleKey: ModuleKey;
  showDiff: boolean;
}) {
  // Gen number is 1-based, ascending from oldest = Gen 1
  const genNum = index + 1;
  const hue = moduleHue(moduleKey);
  const timeLabel = relativeTime(gen.mintedAt);

  return (
    <div className="group relative flex gap-3">
      {/* connector + node column */}
      <div className="flex flex-col items-center" style={{ width: 20, flexShrink: 0 }}>
        {/* upward connector (not shown for the very first item) */}
        {index > 0 && (
          <div className="w-px flex-none bg-border" style={{ height: 10 }} />
        )}
        {/* node */}
        <div
          className="relative flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition-all"
          style={
            isActive
              ? {
                  boxShadow: `0 0 0 2px ${hue}`,
                  background: `color-mix(in oklab, ${hue} 18%, transparent)`,
                }
              : {
                  background: "var(--color-hover)",
                  border: "1px solid var(--color-border)",
                }
          }
        >
          {isActive && (
            <div
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: hue }}
            />
          )}
        </div>
        {/* downward connector (not shown after the last item) */}
        {!isLast && (
          <div className="w-px flex-1 bg-border" style={{ minHeight: 10 }} />
        )}
      </div>

      {/* content column */}
      <div
        className={`mb-3 min-w-0 flex-1 rounded-[var(--radius-ui)] px-2.5 py-2 transition-colors ${
          isActive ? "bg-elevated" : "bg-transparent hover:bg-hover"
        }`}
      >
        {/* top row: gen label + active pill + time */}
        <div className="flex items-center gap-2">
          <span className="wc-mono text-ui font-medium text-ink-100">
            {versionLabel(gen.id)}
          </span>
          {isActive && (
            <StatusPill tone="ok">Active</StatusPill>
          )}
          <span className="ml-auto shrink-0 wc-mono text-meta text-ink-500">
            {timeLabel ?? "—"}
          </span>
        </div>

        {/* provenance row */}
        <div className="mt-0.5 flex items-center gap-1 text-meta text-ink-500">
          {gen.mintedFrom.length > 0 ? (
            <>
              <span>
                saved from {gen.mintedFrom.length} proposal
                {gen.mintedFrom.length !== 1 ? "s" : ""}
              </span>
              <span>·</span>
              <span className="wc-mono text-ink-500 truncate max-w-[120px]" title={gen.id}>
                {gen.id}
              </span>
            </>
          ) : (
            <span className="wc-mono text-ink-500 truncate max-w-[160px]" title={gen.id}>
              {gen.id}
            </span>
          )}
        </div>

        {/* diff section (behind toggle) */}
        {showDiff && (
          <div className="mt-2">
            <GenerationDiff id={gen.id} moduleKey={moduleKey} />
          </div>
        )}

        {/* rollback action — only for non-active generations */}
        {!isActive && (
          <div className="mt-2 flex items-center gap-2">
            <Button
              size="sm"
              variant="subtle"
              disabled={disabled}
              onClick={() => onActivate(gen.id)}
            >
              {busy ? "…" : `Make version ${genNum} active`}
            </Button>
            <span className="text-meta text-ink-500">
              This won't delete version {total}.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── ModuleGenerations ─────────────────────────────────────────────────────

/** ONE module's generation lineage rendered as an ordinal level ladder.
 *
 *  Design: versioning as LEVELS (Gen 1 → Gen 2 → Gen 3), not a git log.
 *  - Active generation gets an accent-ringed node + StatusPill("Active").
 *  - Provenance row: "minted from N proposals · <lockfile-id>" (relativeTime).
 *  - ProgressBar toward next generation (honest: only shown when threshold known).
 *  - Rollback = "Make Gen N active" (append-safe; never the word "revert").
 *  - Diff behind a "Highlight changes" Segmented toggle, OFF by default.
 */
export function ModuleGenerations({ moduleKey }: { moduleKey: ModuleKey }) {
  const queryClient = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showToast, setShowToast] = useState(false);
  const [toastMsg, setToastMsg] = useState("");
  // diff toggle: "off" | "on"
  const [diffMode, setDiffMode] = useState<"off" | "on">("off");
  // date-group open state — all open by default
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const q = useQuery({
    queryKey: ["zuzuu", "module", moduleKey, "generations"],
    queryFn: () => zuzuuApi.moduleGenerations(moduleKey),
    refetchInterval: 8000,
  });

  const gens = q.data?.generations ?? [];
  const active = q.data?.active ?? null;

  // Dismiss toast after 3s
  useEffect(() => {
    if (!showToast) return;
    const t = setTimeout(() => setShowToast(false), 3000);
    return () => clearTimeout(t);
  }, [showToast]);

  const activate = async (id: string) => {
    const targetIdx = gens.findIndex((g) => g.id === id);
    const targetNum = targetIdx + 1;
    const totalNum = gens.length;
    setErr(null);
    setBusy(id);
    try {
      await zuzuuApi.rollbackModule(moduleKey, id);
      void queryClient.invalidateQueries({ queryKey: ["zuzuu"] });
      setToastMsg(
        `Version ${targetNum} is now active — version ${totalNum} is still here.`,
      );
      setShowToast(true);
    } catch (e) {
      setErr(describeZuzuuError(e));
    } finally {
      setBusy(null);
    }
  };

  if (q.isLoading) {
    return (
      <div className="text-meta text-ink-500 px-1 py-2">
        Loading version history…
      </div>
    );
  }

  if (gens.length === 0) {
    return (
      <div className="px-1 py-3">
        <p className="text-ui text-ink-300">No versions yet.</p>
        <p className="mt-1 text-meta text-ink-500">
          Approving a {moduleKey} proposal saves version 1.
        </p>
      </div>
    );
  }

  // ── active generation level ───────────────────────────────────────────
  // The API supplies no approved-proposal threshold, so we show only
  // what is genuinely known: the current level and generation count.
  const activeIdx = gens.findIndex((g) => g.id === active);
  const currentGenNum = activeIdx >= 0 ? activeIdx + 1 : gens.length;

  // ── date-grouped sections ─────────────────────────────────────────────
  type Group = { bucket: string; items: Array<{ gen: GenerationSummary; origIdx: number }> };
  const groups: Group[] = [];
  const bucketOrder: string[] = [];
  // Render newest → oldest (descending index) so "Today" appears first
  const descGens = [...gens].map((g, i) => ({ gen: g, origIdx: i })).reverse();
  for (const entry of descGens) {
    const bucket = dateBucket(entry.gen.mintedAt);
    const last = groups[groups.length - 1];
    if (last && last.bucket === bucket) {
      last.items.push(entry);
    } else {
      groups.push({ bucket, items: [entry] });
      bucketOrder.push(bucket);
    }
  }

  const toggleGroup = (bucket: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(bucket)) next.delete(bucket);
      else next.add(bucket);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-0 wc-panel-enter">
      {/* ── header: level label + diff toggle ── */}
      <div className="mb-3 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <span className="wc-sans text-ui font-medium text-ink-100">
            Version {currentGenNum}
          </span>
          <span className="ml-2 text-meta text-ink-500">
            Version {currentGenNum} is active · {gens.length} version{gens.length !== 1 ? "s" : ""}
          </span>
        </div>
        <Segmented
          options={[
            { value: "off", label: "History" },
            { value: "on", label: "Changes" },
          ]}
          value={diffMode}
          onChange={(v) => setDiffMode(v as "off" | "on")}
        />
      </div>

      {/* ── date-grouped ladder ── */}
      {groups.map(({ bucket, items }) => {
        const isCollapsed = collapsedGroups.has(bucket);
        return (
          <div key={bucket} className="mb-1">
            {/* group header */}
            <button
              onClick={() => toggleGroup(bucket)}
              className="wc-focus mb-1.5 flex w-full items-center gap-1.5 rounded-[var(--radius-sm)] px-1 py-0.5 text-left hover:bg-hover"
            >
              <span className="wc-eyebrow flex-1">{bucket}</span>
              <svg
                viewBox="0 0 16 16"
                className={`h-3 w-3 text-ink-500 transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
              >
                <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {!isCollapsed && (
              <div className="pl-1">
                {items.map(({ gen, origIdx }, itemIdx) => (
                  <LadderNode
                    key={gen.id}
                    gen={gen}
                    index={origIdx}
                    total={gens.length}
                    isActive={gen.id === active}
                    isLast={itemIdx === items.length - 1 && bucket === bucketOrder[bucketOrder.length - 1]}
                    onActivate={activate}
                    disabled={busy !== null}
                    busy={busy === gen.id}
                    moduleKey={moduleKey}
                    showDiff={diffMode === "on"}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}

      {err && (
        <div className="mt-2 break-all rounded-[var(--radius-sm)] border border-border bg-elevated px-2 py-1.5 wc-mono text-meta text-danger">
          {err}
        </div>
      )}

      {showToast && (
        <Toast>{toastMsg}</Toast>
      )}
    </div>
  );
}
