import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { describeZuzuuError, isCliAbsent, zuzuuApi } from "../lib/zuzuu-api";
import { useReviewOpen } from "../state/review";
import { Overlay, Dialog, DialogHeader, Button, ProgressBar, Spinner, Toast } from "../components/ui";
import {
  buildQueue, currentItem, initReview, isDone, reduceReview,
  type ReviewEvent, type ReviewItem, type ReviewState,
} from "./review-queue";
import { ProposalDetail } from "../panel/ProposalDetail";
import { moduleHue } from "../panel/kit";

/** The review ceremony: eval-ranked proposals then pending actions, one card at
 *  a time — approve / not-yet / reject — ending in a generation mint. */
export function ReviewFlow() {
  const open = useReviewOpen((s) => s.open);
  const setOpen = useReviewOpen((s) => s.setOpen);
  if (!open) return null;
  // remount per open so the ceremony always starts from a fresh snapshot
  return <ReviewCeremony onClose={() => setOpen(false)} />;
}

type MintState =
  | { phase: "idle" }
  | { phase: "minting" }
  | { phase: "done"; minted: { module: string; id: string }[] }
  | { phase: "error"; message: string };

function ReviewCeremony({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const evalQ = useQuery({ queryKey: ["zuzuu", "eval"], queryFn: zuzuuApi.evalRanked });
  const actionsQ = useQuery({ queryKey: ["zuzuu", "module", "actions"], queryFn: () => zuzuuApi.module("actions") });

  // Snapshot the queue once both sources arrive; later invalidations must not
  // reshuffle the ceremony mid-flight.
  const [state, setState] = useState<ReviewState | null>(null);
  useEffect(() => {
    if (state === null && evalQ.data && actionsQ.data)
      setState(initReview(buildQueue(evalQ.data.ranked, actionsQ.data.proposals)));
  }, [state, evalQ.data, actionsQ.data]);

  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [mint, setMint] = useState<MintState>({ phase: "idle" });
  // Toast shown briefly after each approve
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  };

  const dispatch = (e: ReviewEvent) => {
    setState((s) => (s ? reduceReview(s, e) : s));
    setRejecting(false);
    setReason("");
  };
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["zuzuu"] });
  const fail = (err: unknown) =>
    dispatch(isCliAbsent(err) ? { type: "cli-absent" } : { type: "failed", message: describeZuzuuError(err) });

  const approve = async (item: ReviewItem) => {
    setBusy(true);
    try {
      if (item.kind === "action") await zuzuuApi.approveAction(item.id);
      else await zuzuuApi.approveProposal(item.id, item.module);
      dispatch({ type: "approved", id: item.id });
      showToast(item.kind === "action" ? "Action approved" : "Approved — a new version will be saved");
      invalidate();
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const reject = async (item: ReviewItem) => {
    setBusy(true);
    try {
      if (item.kind === "action") await zuzuuApi.rejectAction(item.id);
      else await zuzuuApi.rejectProposal(item.id, item.module, reason.trim() || undefined);
      dispatch({ type: "rejected" });
      invalidate();
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const approvedIds = state?.approvedIds ?? [];
  // Per-module mint (W2.5 Phase 2): group approved ids by their module (from the
  // queue), then mint each affected module's generation. Actions don't carry a
  // generation lineage the same way; mint generations for non-action modules.
  const runMint = useCallback(async (ids: string[]) => {
    setMint({ phase: "minting" });
    try {
      const byModule = new Map<string, string[]>();
      const queue = state?.queue ?? [];
      for (const id of ids) {
        const item = queue.find((q) => q.id === id);
        const module = item?.module ?? "knowledge";
        if (item?.kind === "action") continue; // actions activate, not mint
        if (!byModule.has(module)) byModule.set(module, []);
        byModule.get(module)!.push(id);
      }
      const minted: { module: string; id: string }[] = [];
      for (const [module, mids] of byModule) {
        const r = await zuzuuApi.mintModuleGeneration(module, mids);
        minted.push({ module, id: r.id });
      }
      setMint({ phase: "done", minted });
      void queryClient.invalidateQueries({ queryKey: ["zuzuu"] });
    } catch (err) {
      setMint({ phase: "error", message: describeZuzuuError(err) });
    }
  }, [queryClient, state]);

  // Reaching the end with approvals → mint once, automatically. The ref is a
  // belt-and-braces guard against any future re-fire (e.g. a phase reset);
  // explicit retry bypasses it by calling runMint directly.
  const done = state !== null && isDone(state);
  // CLI parity: quitting mid-ceremony still mints what was already approved
  // (the CLI's review does the same — applied approvals without a pinned
  // generation would be untracked). Closing with approvals routes through the
  // end state instead of discarding.
  const [closing, setClosing] = useState(false);
  const finished = done || closing;
  const requestClose = () => {
    if (state && !done && approvedIds.length > 0 && mint.phase === "idle") setClosing(true);
    else onClose();
  };
  const mintStarted = useRef(false);
  useEffect(() => {
    if (finished && approvedIds.length > 0 && mint.phase === "idle" && !mintStarted.current) {
      mintStarted.current = true;
      void runMint(approvedIds);
    }
  }, [finished, approvedIds, mint.phase, runMint]);

  const item = state ? currentItem(state) : null;

  // Progress fraction for the ProgressBar
  const progressFraction = state && state.queue.length > 0
    ? state.index / state.queue.length
    : 0;

  return (
    <Overlay onClose={requestClose} className="p-4">
      {/* width: min(640px, 92vw) — readable line length, never clipped on small screens */}
      <Dialog className="!max-w-none" style={{ width: "min(640px, 92vw)", maxHeight: "88vh" }}>
        <DialogHeader
          title={
            state && !finished
              ? (
                <span className="flex items-center gap-3">
                  <span>Review</span>
                  <span className="wc-sans text-meta font-normal text-ink-500 tabular-nums">
                    {state.index + 1} of {state.queue.length}
                  </span>
                </span>
              )
              : "Review"
          }
          onClose={requestClose}
        />

        {/* Slim progress bar — sits flush under the header */}
        {state && !finished && state.queue.length > 0 && (
          <div className="px-4 pt-3">
            <ProgressBar value={progressFraction} tone="ok" />
          </div>
        )}

        <div className="flex max-h-[calc(88vh-3rem)] flex-col gap-4 overflow-y-auto p-4">
          {state?.cliAbsent && (
            <div className="rounded-[var(--radius-sm)] border border-warn/40 bg-[color-mix(in_oklab,var(--color-warn)_10%,transparent)] px-3 py-2 text-ui text-warn">
              zuzuu CLI required — <code>npm i -g @zuzuucodes/cli</code>
            </div>
          )}

          {state === null && (
            <div className="flex items-center gap-2 py-6 text-ui text-ink-500"><Spinner /> loading queue…</div>
          )}

          {state !== null && finished && (
            <EndState
              approvedCount={approvedIds.length}
              mint={mint}
              onRetry={() => void runMint(approvedIds)}
              onDone={onClose}
            />
          )}

          {state !== null && !finished && item && (
            <>
              {/* The proposal card: wc-pop-in entrance, left accent bar in module hue */}
              <div
                key={item.id}
                className="wc-pop-in rounded-ui border border-border bg-surface p-4"
                style={{
                  ["--hue" as string]: moduleHue(item.module),
                  borderLeft: "3px solid color-mix(in oklab, var(--hue) 55%, var(--color-border))",
                }}
              >
                {/* Module chip + action badge */}
                <div className="mb-3 flex items-center gap-2">
                  <span
                    className="wc-sans rounded-[var(--radius-sm)] px-1.5 py-0.5 text-meta font-medium capitalize"
                    style={{
                      background: "color-mix(in oklab, var(--hue) 14%, transparent)",
                      color: "color-mix(in oklab, var(--hue) 82%, white)",
                    }}
                  >
                    {item.module}
                  </span>
                  {item.kind === "action" && (
                    <span className="rounded-[var(--radius-sm)] border border-border px-1.5 py-0.5 text-meta text-ink-400">
                      action inbox
                    </span>
                  )}
                </div>

                {/* WHAT / WHY / WHAT HAPPENS */}
                <ProposalDetail
                  data={{
                    id: item.id,
                    module: item.module,
                    title: item.title,
                    score: item.score,
                    confidence: item.confidence,
                    rationale: item.rationale,
                    signals: item.signals,
                    evidence: item.evidence,
                    isAction: item.kind === "action",
                  }}
                />
              </div>

              {state.error && (
                <div className="wc-mono break-all text-meta text-danger">{state.error}</div>
              )}

              {/* Action row */}
              {rejecting ? (
                <RejectionRow
                  busy={busy}
                  cliAbsent={state.cliAbsent}
                  reason={reason}
                  onReasonChange={setReason}
                  onConfirm={() => void reject(item)}
                  onCancel={() => { setRejecting(false); setReason(""); }}
                />
              ) : (
                <ActionRow
                  busy={busy}
                  cliAbsent={state.cliAbsent}
                  isAction={item.kind === "action"}
                  onApprove={() => void approve(item)}
                  onNotYet={() => dispatch({ type: "skipped" })}
                  onReject={() => setRejecting(true)}
                />
              )}
            </>
          )}
        </div>
      </Dialog>

      {/* Quiet toast — appears at the bottom of the viewport on approve */}
      {toast && <Toast>{toast}</Toast>}
    </Overlay>
  );
}

/** The three-action row: Approve (primary) · Not yet (secondary) · Reject (text-only danger). */
function ActionRow({
  busy,
  cliAbsent,
  isAction,
  onApprove,
  onNotYet,
  onReject,
}: {
  busy: boolean;
  cliAbsent: boolean;
  isAction: boolean;
  onApprove: () => void;
  onNotYet: () => void;
  onReject: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button variant="primary" disabled={busy || cliAbsent} onClick={onApprove}>
          Approve
        </Button>
        <Button variant="secondary" disabled={busy} onClick={onNotYet}>
          Not yet
        </Button>
        {busy && <Spinner />}
        {/* Reject sits far right, text-only, de-emphasized — never a red slab */}
        <Button
          variant="danger"
          disabled={busy || cliAbsent}
          onClick={onReject}
          className="ml-auto !border-0 !bg-transparent px-1"
        >
          Reject
        </Button>
      </div>
      {/* WHAT HAPPENS — consequence micro-copy under the primary action */}
      <p className="text-meta text-ink-600">
        {isAction
          ? "Approve — activates this runbook in the agent's next session."
          : "Approve — saves a new version with this learning included."}
      </p>
    </div>
  );
}

/** Inline rejection row: optional reason field + confirm / cancel. */
function RejectionRow({
  busy,
  cliAbsent,
  reason,
  onReasonChange,
  onConfirm,
  onCancel,
}: {
  busy: boolean;
  cliAbsent: boolean;
  reason: string;
  onReasonChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <input
        autoFocus
        value={reason}
        placeholder="reason for rejection (optional)"
        onChange={(e) => onReasonChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !busy) onConfirm(); }}
        className="wc-input w-full px-2 py-1.5"
      />
      <div className="flex items-center gap-2">
        <Button variant="danger" disabled={busy || cliAbsent} onClick={onConfirm}>
          Confirm reject
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function EndState({
  approvedCount, mint, onRetry, onDone,
}: {
  approvedCount: number;
  mint: MintState;
  onRetry: () => void;
  onDone: () => void;
}) {
  return (
    <div className="wc-rise-in flex flex-col items-center gap-4 px-4 py-8 text-center">
      {approvedCount === 0 ? (
        <>
          {/* Warm zero-state when nothing was approved */}
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-hover">
            <svg viewBox="0 0 16 16" className="h-8 w-8 text-ink-400" fill="none" stroke="currentColor" strokeWidth="1.1">
              <path d="M8 2.5a5.5 5.5 0 110 11 5.5 5.5 0 010-11M5.5 8.5l1.5 1.5 3-3.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div>
            <div className="wc-sans text-title font-semibold text-ink-200">All caught up</div>
            <p className="wc-sans mt-1 text-meta text-ink-500">Nothing needs you right now.</p>
          </div>
        </>
      ) : (
        <>
          {/* Warm finish when the user taught the agent something */}
          <span
            className="wc-graduate flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{ background: "color-mix(in oklab, var(--color-success) 12%, transparent)", boxShadow: "inset 0 0 0 1px color-mix(in oklab, var(--color-success) 22%, transparent)" }}
          >
            <svg viewBox="0 0 16 16" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.1" style={{ color: "color-mix(in oklab, var(--color-success) 78%, white)" }}>
              <path d="M2.5 8.5l3.5 3.5 7.5-8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div>
            <div className="wc-sans text-title font-semibold text-ink-200">All caught up</div>
            <p className="wc-sans mt-1 text-meta text-ink-500">
              You taught the agent {approvedCount} thing{approvedCount === 1 ? "" : "s"} today.
            </p>
          </div>

          {mint.phase === "minting" && (
            <div className="flex items-center gap-2 text-ui text-ink-500"><Spinner /> saving new versions…</div>
          )}

          {mint.phase === "done" && mint.minted.length > 0 && (
            <div className="w-full rounded-[var(--radius-sm)] border border-border bg-surface px-3 py-2.5">
              <div className="wc-eyebrow mb-2">new versions saved</div>
              <div className="flex flex-col gap-1.5">
                {mint.minted.map((m) => (
                  <div key={m.module} className="flex items-center gap-2 text-ui">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: moduleHue(m.module) }}
                    />
                    <span className="wc-sans font-medium capitalize text-ink-100">{m.module}</span>
                    <span className="text-ink-600">→</span>
                    <span className="wc-mono text-meta text-ink-400">{m.id}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {mint.phase === "done" && mint.minted.length === 0 && (
            <p className="text-meta text-ink-500">{approvedCount} approval{approvedCount === 1 ? "" : "s"} applied.</p>
          )}

          {mint.phase === "error" && (
            <>
              <div className="wc-mono break-all text-meta text-danger">save failed: {mint.message}</div>
              <Button variant="primary" onClick={onRetry}>Retry save</Button>
            </>
          )}
        </>
      )}

      {mint.phase !== "minting" && mint.phase !== "error" && (
        <Button variant="subtle" onClick={onDone}>Done</Button>
      )}
    </div>
  );
}
