import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ModuleKey, ProposalSummary } from "@zuzuu-web/protocol";
import { describeZuzuuError, zuzuuApi } from "../lib/zuzuu-api";
import { useExplorer } from "../state/explorer";
import { useRightPanel } from "../state/right-panel";
import { confirm } from "../components/ui";
import { ProposalRow } from "./ProposalRow";
import { ItemRow, Section, TeachingEmpty, moduleDisplay, moduleHue } from "./kit";
import { moduleItemPath } from "./module-paths";
import { SchemaView, ReadmeView } from "./ModuleDocs";
import { ModuleGenerations } from "./ModuleGenerations";

const openInEditor = (path: string) => useExplorer.getState().openPreviewPath(path);

const HINT_KEY = "zuzuu.hint.graduation";
const readHintDismissed = (): boolean => {
  try { return localStorage.getItem(HINT_KEY) === "1"; } catch { return true; }
};

/** One module's drill-in (slides over the dashboard): pending proposals
 *  first (inline ✓/✗ — the same mutations as the review ceremony), then the
 *  envelope items (click → the item's .md in the editor), then schema/README
 *  links. TeachingEmpty when bare. */
export function ModuleView({ moduleKey }: { moduleKey: ModuleKey }) {
  const queryClient = useQueryClient();
  const closeDrill = useRightPanel((s) => s.closeDrill);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [hintDismissed, setHintDismissed] = useState(readHintDismissed);
  // display = the manifest ui descriptor when the overview has it (the
  // shared cache), built-in MODULE_META as the fallback
  const overview = useQuery({ queryKey: ["zuzuu", "overview"], queryFn: zuzuuApi.overview, refetchInterval: 8000 });
  const display = moduleDisplay(moduleKey, overview.data?.modules.find((f) => f.id === moduleKey));
  const detail = useQuery({
    queryKey: ["zuzuu", "module", moduleKey],
    queryFn: () => zuzuuApi.module(moduleKey),
    refetchInterval: 4000,
  });

  const run = async (id: string, fn: () => Promise<unknown>) => {
    setErr(null);
    setBusyId(id);
    try {
      await fn();
      void queryClient.invalidateQueries({ queryKey: ["zuzuu"] });
    } catch (e) {
      setErr(describeZuzuuError(e));
    } finally {
      setBusyId(null);
    }
  };

  // The actions module's pending list is its inbox — those go through act
  // approve/reject by slug; every other module through the proposal routes.
  const approve = (p: ProposalSummary) => {
    // play the dissolve before the refetch drops the row (kept brief so the
    // list never feels laggy); reduced-motion collapses it to ~0ms via CSS
    setApprovingId(p.id);
    void run(p.id, () => (moduleKey === "actions" ? zuzuuApi.approveAction(p.id) : zuzuuApi.approveProposal(p.id, p.module)))
      .finally(() => setApprovingId(null));
  };
  const reject = async (p: ProposalSummary) => {
    const ok = await confirm({ title: "Reject proposal?", message: p.title, okLabel: "Reject", danger: true });
    if (!ok) return;
    void run(p.id, () => (moduleKey === "actions" ? zuzuuApi.rejectAction(p.id) : zuzuuApi.rejectProposal(p.id, p.module)));
  };

  const dismissHint = () => {
    setHintDismissed(true);
    try { localStorage.setItem(HINT_KEY, "1"); } catch { /* private mode */ }
  };

  const proposals = detail.data?.proposals ?? [];
  const items = detail.data?.items ?? [];
  const errors = detail.data?.errors ?? [];
  const bare = proposals.length === 0 && items.length === 0 && errors.length === 0;

  const hue = moduleHue(moduleKey);
  return (
    <div className="wc-slide-in flex flex-col gap-4 p-3.5" style={{ ["--hue" as string]: hue }}>
      {/* back to the dashboard root */}
      <button
        onClick={closeDrill}
        className="wc-sans -mb-1 w-fit text-meta text-ink-500 transition-colors hover:text-ink-200"
        title="Back to all modules"
      >
        ‹ All modules
      </button>
      {/* module hero: the hue-carrying icon chip + the display name */}
      <div className="flex items-center gap-3">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px]"
          style={{
            background: "color-mix(in oklab, var(--hue) 14%, transparent)",
            boxShadow: "inset 0 0 0 1px color-mix(in oklab, var(--hue) 24%, transparent)",
          }}
        >
          <svg viewBox="0 0 16 16" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.35" style={{ color: "var(--hue)" }}>
            <path d={display.icon} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="wc-sans text-display font-semibold text-ink-100">{display.label}</span>
      </div>

      {/* educative one-time hint */}
      {!hintDismissed && (
        <div className="flex items-start gap-2 rounded-ui border border-border bg-surface p-card-sm text-meta text-ink-400">
          <span className="min-w-0">items graduate through review — nothing changes without your approval</span>
          <button onClick={dismissHint} className="ml-auto shrink-0 text-ink-600 hover:text-ink-300" title="Dismiss">
            ✕
          </button>
        </div>
      )}

      {bare ? (
        <TeachingEmpty display={display} moduleId={moduleKey} />
      ) : (
        <>
          {/* pending first — the human gate is the panel's headline */}
          {proposals.length > 0 && (
            <Section label={`pending proposals (${proposals.length})`}>
              <div className="flex flex-col">
                {proposals.map((p) => (
                  <ProposalRow
                    key={p.id}
                    data={p}
                    isAction={moduleKey === "actions"}
                    busy={busyId === p.id}
                    approving={approvingId === p.id}
                    onApprove={() => approve(p)}
                    onReject={() => void reject(p)}
                  />
                ))}
              </div>
            </Section>
          )}

          <Section label={`items (${items.length})`}>
            {items.length === 0 ? (
              <div className="text-meta text-ink-600">none yet — approved proposals land here</div>
            ) : (
              <div className="flex flex-col">
                {items.map((it) => (
                  <ItemPeek
                    key={it.id}
                    kind={it.kind}
                    title={it.title}
                    status={it.status === "archived" ? "archived" : undefined}
                    timestamp={it.updated_at ?? it.created_at}
                    body={typeof it.body === "string" ? it.body : (typeof it.payload?.body === "string" ? it.payload.body : undefined)}
                    path={moduleItemPath(moduleKey, it.id)}
                    onOpen={() => openInEditor(moduleItemPath(moduleKey, it.id))}
                  />
                ))}
              </div>
            )}
          </Section>

          {errors.length > 0 && (
            <Section label={`unparseable (${errors.length})`}>
              {errors.map((e) => (
                <div key={e.file} className="truncate text-meta text-danger" title={e.error}>
                  ✗ {e.file}: {e.error}
                </div>
              ))}
            </Section>
          )}
        </>
      )}

      {err && <div className="break-all font-mono text-meta text-danger">{err}</div>}

      {/* generation lineage for THIS module (per-module atoms, W2.5 Phase 2) */}
      {!bare && (
        <Section label="generations">
          <ModuleGenerations moduleKey={moduleKey} />
        </Section>
      )}

      {/* rendered schema + README (raw-file escape hatch lives inside each) */}
      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <SchemaView moduleKey={moduleKey} />
        <ReadmeView moduleKey={moduleKey} />
      </div>
    </div>
  );
}

/** An envelope-item row with an inline expand affordance: click the chevron to
 *  peek the first lines of the body before opening the full file in Monaco. */
function ItemPeek({
  kind, title, status, timestamp, body, path, onOpen,
}: {
  kind: string | undefined;
  title: string;
  status?: string;
  timestamp?: string | null;
  body?: string;
  path: string;
  onOpen: () => void;
}) {
  const [open, setOpen] = useState(false);
  const peek = body ? body.split("\n").slice(0, 6).join("\n").slice(0, 600) : null;
  return (
    <div className="border-b border-border last:border-0">
      <div className="flex items-center gap-1">
        {peek && (
          <button
            onClick={() => setOpen((v) => !v)}
            className="shrink-0 text-meta text-ink-600 hover:text-accent"
            title={open ? "Collapse" : "Peek"}
          >
            {open ? "▾" : "▸"}
          </button>
        )}
        {!peek && <span className="w-[1ch] shrink-0" />}
        <div className="min-w-0 flex-1">
          <ItemRow
            kind={kind}
            title={title}
            status={status}
            timestamp={timestamp}
            onClick={onOpen}
            titleAttr={path}
            compact
          />
        </div>
      </div>
      {open && peek && (
        <pre className="mb-1.5 ml-5 whitespace-pre-wrap break-words rounded-[var(--radius-sm)] bg-surface px-2 py-1.5 font-mono text-meta text-ink-400">
          {peek}
        </pre>
      )}
    </div>
  );
}
