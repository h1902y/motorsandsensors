import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ModuleItem, ModuleKey, ProposalSummary } from "@zuzuu-web/protocol";
import { describeZuzuuError, zuzuuApi } from "../lib/zuzuu-api";
import { useExplorer } from "../state/explorer";
import { useRightPanel } from "../state/right-panel";
import { confirm, InfoDot, PropertyRow, StatusPill } from "../components/ui";
import { ProposalRow } from "./ProposalRow";
import { ItemRow, Section, TeachingEmpty, moduleDisplay, moduleHue, kindIcon, relativeTime, versionLabel, GLOSSARY, KIND_ICONS, type ExplainerEntry } from "./kit";
import { moduleItemPath } from "./module-paths";
import { SchemaView, ReadmeView } from "./ModuleDocs";
import { ModuleGenerations } from "./ModuleGenerations";

// ── Guardrails: severity helpers ──────────────────────────────────────────

type Severity = "deny" | "ask" | "allow";
type PillToneVal = "ok" | "warn" | "bad" | "neutral";

/** Normalise whatever string the rule payload carries into one of the 3 known
 *  severities, or undefined if absent/unknown. */
function parseSeverity(raw: unknown): Severity | undefined {
  if (raw === "deny" || raw === "ask" || raw === "allow") return raw;
  return undefined;
}

function severityTone(s: Severity): PillToneVal {
  if (s === "allow") return "ok";
  if (s === "ask") return "warn";
  return "bad"; // deny
}

/** Lock icon path (16×16 stroke) for the "enforced" note. */
const LOCK_PATH = "M5 7V5a3 3 0 016 0v2M3.5 7h9a.5.5 0 01.5.5v6a.5.5 0 01-.5.5h-9a.5.5 0 01-.5-.5v-6A.5.5 0 013.5 7z";

/** Plain-English summary sentence: "Blocks N actions, asks before M, allows K." */
function guardrailsSummary(items: ModuleItem[]): { deny: number; ask: number; allow: number } {
  const counts = { deny: 0, ask: 0, allow: 0 };
  for (const it of items) {
    if (it.kind !== "rule") continue;
    const sev = parseSeverity(it.payload?.severity);
    if (sev) counts[sev]++;
  }
  return counts;
}

/** One guardrail rule row — severity color + bold label + muted description
 *  + literal pattern chip + "enforced by guardrails gate" note. */
function GuardrailRuleRow({ item }: { item: ModuleItem }) {
  const sev = parseSeverity(item.payload?.severity);
  const tone = sev ? severityTone(sev) : "neutral";
  const pattern = typeof item.payload?.pattern === "string" ? item.payload.pattern : undefined;
  const description = typeof item.payload?.description === "string"
    ? item.payload.description
    : (typeof item.body === "string" ? item.body.replace(/^#[^\n]*\n/, "").trim() : undefined);

  return (
    <div className="flex items-start gap-3 border-b border-border py-3 last:border-0">
      {/* severity pill — the one color per row */}
      <div className="mt-0.5 shrink-0">
        <StatusPill tone={tone}>{sev ?? "rule"}</StatusPill>
      </div>

      {/* label + description + pattern chip */}
      <div className="min-w-0 flex-1">
        <div className="wc-sans text-ui font-semibold text-ink-100">{item.title}</div>
        {description && (
          <div className="wc-sans mt-0.5 text-meta text-ink-500 leading-relaxed">{description}</div>
        )}
        {pattern && (
          <div className="mt-1.5 flex items-center gap-1.5">
            <span className="wc-sans text-meta text-ink-500">pattern</span>
            <code className="wc-mono rounded-[var(--radius-sm)] border border-border bg-surface px-1.5 py-0.5 text-meta text-ink-300">
              {pattern}
            </code>
          </div>
        )}
      </div>

      {/* enforced note */}
      <div className="shrink-0 flex items-center gap-1 text-meta text-ink-600 mt-0.5">
        <svg viewBox="0 0 16 16" className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
          <path d={LOCK_PATH} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="wc-sans">enforced by the guardrails gate</span>
      </div>
    </div>
  );
}

/** The full guardrails items section: plain-English summary + sorted rule rows.
 *  Replaces the generic ItemPeek list for moduleKey === "guardrails". */
function GuardrailsSection({ items }: { items: ModuleItem[] }) {
  const rules = items.filter((it) => it.kind === "rule");
  const others = items.filter((it) => it.kind !== "rule");
  const counts = guardrailsSummary(items);

  // Build the summary sentence from real counts
  const parts: string[] = [];
  if (counts.deny > 0) parts.push(`blocks ${counts.deny} action${counts.deny !== 1 ? "s" : ""}`);
  if (counts.ask > 0) parts.push(`asks before ${counts.ask}`);
  if (counts.allow > 0) parts.push(`allows ${counts.allow}`);
  const summary = parts.length > 0
    ? parts.join(", ") + "."
    : "no rules active yet.";

  // Sort: deny first, then ask, then allow (precedence order)
  const ORDER: Severity[] = ["deny", "ask", "allow"];
  const sorted = [...rules].sort((a, b) => {
    const ai = ORDER.indexOf(parseSeverity(a.payload?.severity) ?? "allow" as Severity);
    const bi = ORDER.indexOf(parseSeverity(b.payload?.severity) ?? "allow" as Severity);
    return ai - bi;
  });

  return (
    <>
      {/* plain-English summary */}
      {rules.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-ui border border-border bg-surface p-card-sm text-meta text-ink-400">
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 text-ink-500" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
            <path d="M8 2l4.5 1.8v3.5c0 3-1.9 5.1-4.5 6.2-2.6-1.1-4.5-3.2-4.5-6.2V3.8L8 2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="wc-sans">
            {counts.deny > 0 && (
              <><StatusPill tone="bad">{counts.deny} blocked</StatusPill>{" "}</>
            )}
            {counts.ask > 0 && (
              <><StatusPill tone="warn">{counts.ask} ask</StatusPill>{" "}</>
            )}
            {counts.allow > 0 && (
              <><StatusPill tone="ok">{counts.allow} allow</StatusPill>{" "}</>
            )}
            <span className="text-ink-500">{summary}</span>
          </span>
        </div>
      )}

      {/* rule rows */}
      <Section label={`rules (${rules.length})`}>
        {rules.length === 0 ? (
          <div className="text-meta text-ink-600">no rules yet — approved proposals land here</div>
        ) : (
          <div className="flex flex-col">
            {sorted.map((rule) => (
              <GuardrailRuleRow key={rule.id} item={rule} />
            ))}
          </div>
        )}
      </Section>

      {/* non-rule items (if any) fall through to the generic list */}
      {others.length > 0 && (
        <Section label={`other items (${others.length})`}>
          <div className="flex flex-col">
            {others.map((it) => (
              <ItemPeek
                key={it.id}
                item={it}
                allItems={items}
                path={moduleItemPath("guardrails", it.id)}
                onOpen={() => useExplorer.getState().openPreviewPath(moduleItemPath("guardrails", it.id))}
                moduleKey="guardrails"
              />
            ))}
          </div>
        </Section>
      )}
    </>
  );
}

// ── Instructions: calm document detail ───────────────────────────────────

/** Full instructions item detail — calm document reading view (no code chrome).
 *  Used when item.kind === "steering" | "amendment". */
function InstructionsDetail({ item }: { item: ModuleItem }) {
  const rel = relativeTime(item.updated_at ?? item.created_at);
  const rawBody = typeof item.body === "string" ? item.body : "";
  const bodyLines = rawBody.split("\n");
  const body = (bodyLines[0]?.startsWith("# ") ? bodyLines.slice(1) : bodyLines)
    .join("\n")
    .trim();
  const source = typeof item.payload?.source === "string" ? item.payload.source : undefined;

  return (
    <div className="wc-panel-enter mt-1 mb-2 ml-4 flex flex-col gap-4">
      {/* document title */}
      <h2 className="wc-serif text-display font-semibold leading-snug text-ink-100" style={{ maxWidth: "44ch" }}>
        {item.title}
      </h2>

      {/* calm document body — sans, reading measure, generous line-height */}
      {body ? (
        <p className="wc-sans text-body leading-relaxed text-ink-300 whitespace-pre-wrap" style={{ maxWidth: "56ch" }}>
          {body}
        </p>
      ) : (
        <p className="wc-sans text-body italic text-ink-600" style={{ maxWidth: "56ch" }}>
          no body — the instruction is its title
        </p>
      )}

      {/* quiet metadata row */}
      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3 text-meta text-ink-500">
        <span className="wc-sans flex items-center gap-1">
          <svg viewBox="0 0 16 16" className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
            <path d={kindIcon(item.kind)} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {item.kind}
        </span>
        {item.status && (
          <StatusPill tone={item.status === "active" ? "ok" : "neutral"}>{item.status}</StatusPill>
        )}
        {source && (
          <span className="wc-mono text-ink-600 truncate" title={source}>
            {source.length > 18 ? source.slice(0, 16) + "…" : source}
          </span>
        )}
        {rel && <span className="wc-sans">{rel}</span>}
      </div>
    </div>
  );
}

const openInEditor = (path: string) => useExplorer.getState().openPreviewPath(path);

// ── per-module faint preview mocks ───────────────────────────────────────────

/** Faint mock knowledge items — previews what the filled knowledge list looks
 *  like (pointer-events-none is set by TeachingEmpty's preview wrapper). */
function KnowledgePreviewMock() {
  const rows = [
    { kind: "fact",     title: "Prefer pnpm for dependency installs in this repo" },
    { kind: "command",  title: "npm run typecheck — no errors before committing" },
    { kind: "decision", title: "Zero runtime dependencies in the CLI core" },
  ];
  return (
    <div className="flex flex-col divide-y divide-border text-left">
      {rows.map((r) => (
        <div key={r.title} className="flex items-start gap-2 px-2.5 py-2">
          <svg viewBox="0 0 16 16" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-500" fill="none" stroke="currentColor" strokeWidth="1.3">
            <path d={KIND_ICONS[r.kind] ?? ""} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="wc-sans min-w-0 truncate text-meta text-ink-300">{r.title}</span>
          <span className="wc-sans ml-auto shrink-0 text-meta text-ink-600">{r.kind}</span>
        </div>
      ))}
    </div>
  );
}

// ── per-module explainer triplets ─────────────────────────────────────────────

/** Icon-row-triplet explainers for each built-in module — teach what the
 *  module IS in three concrete beats before any items exist. */
const MODULE_EXPLAINERS: Partial<Record<ModuleKey, ExplainerEntry[]>> = {
  knowledge: [
    { icon: KIND_ICONS.fact ?? "",     label: "Facts",     caption: "things zuzuu learned from your sessions" },
    { icon: KIND_ICONS.command ?? "",  label: "Commands",  caption: "tools and invocations worth remembering" },
    { icon: KIND_ICONS.decision ?? "", label: "Decisions", caption: "choices approved by you that shape future runs" },
  ],
  memory: [
    { icon: KIND_ICONS.episode ?? "", label: "Episodes",  caption: "distilled records of past sessions" },
    { icon: "M8 2.5a5.5 5.5 0 110 11 5.5 5.5 0 010-11M8 5v3", label: "Timeline", caption: "ordered so recency is visible at a glance" },
    { icon: "M4 8h8M8 4v8",           label: "Recall",    caption: "surfaced in your digest at session start" },
  ],
  actions: [
    { icon: KIND_ICONS.runbook ?? "", label: "Runbooks", caption: "step-by-step procedures your agent can run" },
    { icon: KIND_ICONS.script ?? "",  label: "Scripts",  caption: "shell scripts promoted from repeated commands" },
    { icon: "M4 13.5l1-3 7-7 2 2-7 7-3 1z", label: "Approved", caption: "only actions you've approved can execute" },
  ],
  instructions: [
    { icon: KIND_ICONS.steering ?? "",   label: "Steering",   caption: "pinned guidance read at every session start" },
    { icon: KIND_ICONS.amendment ?? "",  label: "Amendments", caption: "incremental refinements to the base steering" },
    { icon: "M4 8h8",                    label: "Digest",     caption: "woven into the session-start digest automatically" },
  ],
  guardrails: [
    { icon: KIND_ICONS.rule ?? "",  label: "Rules",    caption: "patterns that trigger deny / ask / allow decisions" },
    { icon: LOCK_PATH,              label: "Enforced", caption: "gates run before every tool call — fail-open on errors" },
    { icon: "M8 2l4.5 1.8v3.5c0 3-1.9 5.1-4.5 6.2-2.6-1.1-4.5-3.2-4.5-6.2V3.8L8 2", label: "Protective", caption: "a refusal here is policy, not preference" },
  ],
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
      {/* module hero: hue-carrying icon chip + permanent title (+ InfoDot) and
          an always-shown teaching subtitle */}
      <div className="flex items-start gap-3">
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
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="wc-sans text-display font-semibold text-ink-100">{display.label}</span>
            <InfoDot title={display.label}>
              {display.teach} — How it grows: each session, zuzuu proposes things to learn;
              approving a proposal saves a new version of {display.label}. Roll back to any
              earlier version anytime.
            </InfoDot>
          </div>
          <p className="wc-sans mt-0.5 text-meta text-ink-500 leading-relaxed">{display.teach}</p>
        </div>
      </div>

      {bare ? (
        <TeachingEmpty
          display={display}
          moduleId={moduleKey}
          preview={moduleKey === "knowledge" ? <KnowledgePreviewMock /> : undefined}
          explainer={MODULE_EXPLAINERS[moduleKey]}
        />
      ) : (
        <>
          {/* pending first — the human gate is the panel's headline */}
          {proposals.length > 0 && (
            <Section
              label={
                <span className="inline-flex items-center gap-1">
                  pending proposals ({proposals.length})
                  <InfoDot title={GLOSSARY.proposal!.term}>{GLOSSARY.proposal!.what}</InfoDot>
                </span>
              }
            >
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

          {/* guardrails: specialized three-state rule rows + summary */}
          {moduleKey === "guardrails" ? (
            <GuardrailsSection items={items} />
          ) : (
            <Section label={`items (${items.length})`}>
              {items.length === 0 ? (
                <div className="text-meta text-ink-600">none yet — approved proposals land here</div>
              ) : (
                <div className="flex flex-col">
                  {items.map((it) => (
                    <ItemPeek
                      key={it.id}
                      item={it}
                      allItems={items}
                      path={moduleItemPath(moduleKey, it.id)}
                      onOpen={() => openInEditor(moduleItemPath(moduleKey, it.id))}
                      moduleKey={moduleKey}
                    />
                  ))}
                </div>
              )}
            </Section>
          )}

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

      {err && <div className="wc-mono break-all text-meta text-danger">{err}</div>}

      {/* version lineage for THIS module (per-module atoms, W2.5 Phase 2) */}
      {!bare && (
        <Section
          label={
            <span className="inline-flex items-center gap-1">
              Versions
              <InfoDot title={GLOSSARY.version!.term}>{GLOSSARY.version!.what}</InfoDot>
            </span>
          }
        >
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

// ── Confidence → pill tone ────────────────────────────────────────────────
type PillTone = "ok" | "warn" | "bad" | "neutral";
function confidenceTone(confidence: string | undefined): PillTone {
  if (confidence === "high") return "ok";
  if (confidence === "med") return "warn";
  if (confidence === "low") return "bad";
  return "neutral";
}

// ── ItemDetail: the reading body + properties rail + backlinks ────────────

/** Extract relations from item payload — returns an array of relation objects
 *  with at least an id or title. Best-effort; falls back to []. */
function extractRelations(item: ModuleItem): { id?: string; title?: string; snippet?: string }[] {
  const rel = item.payload?.relations;
  if (!Array.isArray(rel)) return [];
  return rel
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => ({
      id: typeof r.id === "string" ? r.id : undefined,
      title: typeof r.title === "string" ? r.title : (typeof r.id === "string" ? r.id : undefined),
      snippet: typeof r.snippet === "string" ? r.snippet : (typeof r.context === "string" ? r.context : undefined),
    }))
    .filter((r) => r.id ?? r.title);
}

/** The full item reading body + right rail of PropertyRows + backlinks.
 *  Shown when ItemPeek is expanded. */
function ItemDetail({ item, allItems }: { item: ModuleItem; allItems: ModuleItem[] }) {
  const rel = relativeTime(item.updated_at ?? item.created_at);
  const provenanceSessions = (item.provenance ?? [])
    .map((p) => p.session)
    .filter((s): s is string => typeof s === "string");
  const confidence = typeof item.payload?.confidence === "string"
    ? item.payload.confidence
    : undefined;
  const source = typeof item.payload?.source === "string"
    ? item.payload.source
    : (provenanceSessions[0] ?? undefined);
  const generation = typeof item.payload?.generation === "string"
    ? item.payload.generation
    : undefined;
  const score = typeof item.payload?.score === "number"
    ? item.payload.score
    : undefined;

  // Body prose: item.body is the primary source; strip leading "# Title" if present
  const rawBody = typeof item.body === "string" ? item.body : "";
  const bodyLines = rawBody.split("\n");
  // Drop a leading `# …` heading that duplicates the title
  const body = (bodyLines[0]?.startsWith("# ") ? bodyLines.slice(1) : bodyLines)
    .join("\n")
    .trim();

  // Relations: from payload.relations (schema field), or from other items in
  // the module that share a provenance session — honest fallback as ItemRows.
  const payloadRelations = extractRelations(item);
  const sharedSessionRelations = payloadRelations.length === 0
    ? allItems.filter(
        (other) =>
          other.id !== item.id &&
          provenanceSessions.length > 0 &&
          (other.provenance ?? []).some((p) => provenanceSessions.includes(p.session ?? "")),
      )
    : [];

  return (
    <div className="wc-panel-enter flex flex-col gap-0 mt-1 mb-2 ml-4">
      {/* ── two-column: reading body (left) + properties rail (right) ── */}
      <div className="flex gap-5">
        {/* reading body — capped measure, generous line-height */}
        <div className="min-w-0 flex-1">
          {/* title at display size, serif accent */}
          <h2 className="wc-serif mb-2 text-display font-semibold leading-snug text-ink-100" style={{ maxWidth: "44ch" }}>
            {item.title}
          </h2>
          {body ? (
            <p className="wc-sans text-body leading-relaxed text-ink-300" style={{ maxWidth: "52ch" }}>
              {body}
            </p>
          ) : (
            <p className="wc-sans text-body italic text-ink-600" style={{ maxWidth: "52ch" }}>
              no body — the fact is its title
            </p>
          )}
        </div>

        {/* properties rail */}
        <div className="w-44 shrink-0 border-l border-border pl-4">
          <div className="flex flex-col divide-y divide-border">
            {/* kind */}
            <PropertyRow label="kind">
              <span className="wc-sans flex items-center gap-1 text-ink-200">
                <svg viewBox="0 0 16 16" className="h-3 w-3 shrink-0 text-ink-500" fill="none" stroke="currentColor" strokeWidth="1.4">
                  <path d={kindIcon(item.kind)} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {item.kind ?? "—"}
              </span>
            </PropertyRow>
            {/* status */}
            {item.status && (
              <PropertyRow label="status">
                <StatusPill tone={item.status === "active" ? "ok" : item.status === "archived" ? "neutral" : "neutral"}>
                  {item.status}
                </StatusPill>
              </PropertyRow>
            )}
            {/* confidence */}
            {confidence && (
              <PropertyRow label="confidence">
                <StatusPill tone={confidenceTone(confidence)}>{confidence}</StatusPill>
              </PropertyRow>
            )}
            {/* score */}
            {score !== undefined && (
              <PropertyRow label="score">
                <span className="wc-mono text-ink-300">{score.toFixed(2)}</span>
              </PropertyRow>
            )}
            {/* source / provenance session */}
            {source && (
              <PropertyRow label="source">
                <span className="wc-mono truncate text-ink-400" title={source}>
                  {source.length > 16 ? source.slice(0, 14) + "…" : source}
                </span>
              </PropertyRow>
            )}
            {/* version (generation lockfile) */}
            {generation && (
              <PropertyRow label="version">
                <span className="wc-mono text-ink-400">{versionLabel(generation)}</span>
              </PropertyRow>
            )}
            {/* updated timestamp */}
            {rel && (
              <PropertyRow label="updated">
                <span className="wc-mono text-ink-500">{rel}</span>
              </PropertyRow>
            )}
          </div>
        </div>
      </div>

      {/* ── quoted-context backlinks / related items ────────────────── */}
      {payloadRelations.length > 0 && (
        <div className="mt-4 flex flex-col gap-1.5 border-t border-border pt-3">
          <div className="wc-eyebrow mb-1">Related ({payloadRelations.length})</div>
          {payloadRelations.map((r, i) => (
            <div
              key={r.id ?? i}
              className="rounded-ui border border-border bg-surface p-2.5"
            >
              {r.snippet ? (
                <>
                  {/* quoted context sentence — the Reflect pattern */}
                  <p className="wc-sans mb-1 text-ui italic text-ink-300 leading-relaxed">
                    "{r.snippet}"
                  </p>
                  <span className="wc-sans text-meta text-ink-500">{r.title ?? r.id}</span>
                </>
              ) : (
                <span className="wc-sans text-ui text-ink-200">{r.title ?? r.id}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* honest fallback: ItemRows from same-session siblings */}
      {payloadRelations.length === 0 && sharedSessionRelations.length > 0 && (
        <div className="mt-4 flex flex-col gap-1 border-t border-border pt-3">
          <div className="wc-eyebrow mb-1">Related ({sharedSessionRelations.length})</div>
          {sharedSessionRelations.slice(0, 5).map((other) => (
            <ItemRow
              key={other.id}
              kind={other.kind}
              title={other.title}
              status={other.status === "archived" ? "archived" : undefined}
              timestamp={other.updated_at ?? other.created_at}
              compact
            />
          ))}
        </div>
      )}

      {/* empty-state: teach that links appear here */}
      {payloadRelations.length === 0 && sharedSessionRelations.length === 0 && (
        <div className="mt-3 border-t border-border pt-3">
          <div className="wc-eyebrow mb-1">Related</div>
          <p className="wc-sans text-meta text-ink-600">
            no related items yet — links appear here as zuzuu corroborates this fact
          </p>
        </div>
      )}
    </div>
  );
}

/** An envelope-item row with an inline expand affordance: click the chevron to
 *  show the full reading body + properties rail before opening the file. */
function ItemPeek({
  item,
  allItems,
  path,
  onOpen,
  moduleKey,
}: {
  item: ModuleItem;
  allItems: ModuleItem[];
  path: string;
  onOpen: () => void;
  moduleKey?: ModuleKey;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-border last:border-0">
      <div className="flex items-center gap-1">
        <button
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 text-meta text-ink-600 hover:text-accent"
          title={open ? "Collapse" : "Expand detail"}
        >
          {open ? "▾" : "▸"}
        </button>
        <div className="min-w-0 flex-1">
          <ItemRow
            kind={item.kind}
            title={item.title}
            status={item.status === "archived" ? "archived" : undefined}
            timestamp={item.updated_at ?? item.created_at}
            onClick={onOpen}
            titleAttr={path}
            compact
          />
        </div>
      </div>
      {open && (
        moduleKey === "instructions" && (item.kind === "steering" || item.kind === "amendment")
          ? <InstructionsDetail item={item} />
          : <ItemDetail item={item} allItems={allItems} />
      )}
    </div>
  );
}
