import { useState } from "react";
import type { RankedProposalSignals, RankedProposalEvidence } from "@zuzuu-web/protocol";
import {
  confidencePill, signalPhrases, type ConfidencePill,
} from "../modules/proposal-evidence";
import { moduleDisplay } from "./kit";

/** The shape ProposalDetail renders — a superset of what both a review-queue
 *  ReviewItem and a module-detail ProposalSummary carry. */
export interface ProposalDetailData {
  id: string;
  module: string;
  title: string;
  kind?: string;
  /** the actual content being approved (body/pattern→action/exec) */
  preview?: string;
  score?: number | null;
  confidence?: string | null;
  rationale?: string | null;
  signals?: RankedProposalSignals;
  evidence?: RankedProposalEvidence;
  /** action-inbox items have no score lineage — render a simpler "why" */
  isAction?: boolean;
}

// Semantic status hues (Phase 4) — distinct from the per-module identity
// hues: high confidence = success green, medium = pending amber, low = a quiet
// neutral. These read as "how sure", not as a module's brand color.
const TONE_CLASS: Record<ConfidencePill["tone"], string> = {
  success:
    "border-[color-mix(in_oklab,var(--color-success)_45%,transparent)] bg-[color-mix(in_oklab,var(--color-success)_13%,transparent)] text-[color-mix(in_oklab,var(--color-success)_82%,white)]",
  warning:
    "border-[color-mix(in_oklab,var(--color-pending)_42%,transparent)] bg-[color-mix(in_oklab,var(--color-pending)_13%,transparent)] text-[color-mix(in_oklab,var(--color-pending)_82%,white)]",
  neutral: "border-border bg-hover text-ink-400",
};

/** The shared review/detail body: three legible blocks — WHAT (the content),
 *  WHY (confidence pill + rationale + an expandable plain-language signal
 *  breakdown), WHAT HAPPENS (the consequence of approving/rejecting). Used by
 *  both the review ceremony and the module-detail expandable card. */
export function ProposalDetail({ data }: { data: ProposalDetailData }) {
  const moduleLabel = moduleDisplay(data.module).label;
  const pill = confidencePill(data.confidence, data.score);
  const phrases = data.isAction ? [] : signalPhrases(data.signals, data.evidence);
  const [showSignals, setShowSignals] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      {/* WHAT — the content being approved */}
      <Block label="what">
        <div className="wc-sans break-words text-body font-medium text-ink-100">{data.title}</div>
        {data.preview && data.preview !== data.title && (
          <pre className="mt-1.5 whitespace-pre-wrap break-words rounded-[var(--radius-sm)] bg-surface px-2 py-1.5 font-mono text-meta text-ink-300">
            {data.preview}
          </pre>
        )}
        <div className="mt-1 break-all font-mono text-meta text-ink-600">{data.id}</div>
      </Block>

      {/* WHY — confidence + rationale + the plain-language signal breakdown */}
      <Block label="why">
        <div className="flex flex-wrap items-center gap-2">
          {!data.isAction && (
            <span className={`rounded-full border px-2 py-0.5 text-meta ${TONE_CLASS[pill.tone]}`}>
              {pill.label}
            </span>
          )}
          {data.isAction && (
            <span className="rounded-full border border-border bg-hover px-2 py-0.5 text-meta text-ink-400">
              from your action inbox
            </span>
          )}
          {data.rationale && <span className="text-ui text-ink-200">{data.rationale}</span>}
        </div>

        {phrases.length > 0 && (
          <div className="mt-2">
            <button
              onClick={() => setShowSignals((v) => !v)}
              className="text-meta text-ink-500 transition-colors hover:text-accent"
            >
              {showSignals ? "▾" : "▸"} signals ({phrases.length})
            </button>
            {showSignals && (
              <ul className="mt-1.5 flex flex-col gap-1">
                {phrases.map((p) => (
                  <li key={p.key} className="flex items-center gap-2 text-meta text-ink-300">
                    <span className="h-1 w-12 shrink-0 overflow-hidden rounded-full bg-hover">
                      <span
                        className="block h-full rounded-full"
                        style={{ width: `${Math.round(p.strength * 100)}%`, background: "color-mix(in oklab, var(--color-success) 70%, transparent)" }}
                      />
                    </span>
                    <span>{p.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {!data.isAction && data.score !== null && data.score !== undefined && (
          <div className="mt-1.5 font-mono text-meta text-ink-600">score {data.score}</div>
        )}
      </Block>

      {/* WHAT HAPPENS — the consequence */}
      <Block label="what happens">
        <div className="text-meta text-ink-400">
          {data.isAction ? (
            <>Approve → activates this runbook in <Mod>{moduleLabel}</Mod>.</>
          ) : (
            <>
              Approve → adds this {data.kind ?? "item"} to <Mod>{moduleLabel}</Mod> · saves a new
              version of <Mod>{moduleLabel}</Mod>.
            </>
          )}
          <br />
          Reject → discards it (won't be suggested again).
        </div>
      </Block>
    </div>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="wc-eyebrow mb-1.5">{label}</div>
      {children}
    </div>
  );
}

const Mod = ({ children }: { children: React.ReactNode }) => (
  <span className="wc-sans font-medium text-ink-200">{children}</span>
);
