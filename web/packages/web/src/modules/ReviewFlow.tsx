import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { describeZuzuuError, isCliAbsent, zuzuuApi } from "../lib/zuzuu-api";
import { useReviewOpen } from "../state/review";
import { Overlay, Dialog, DialogHeader, Button, Field, Spinner } from "../components/ui";
import {
  buildQueue, currentItem, initReview, isDone, reduceReview,
  type ReviewEvent, type ReviewItem, type ReviewState,
} from "./review-queue";

/** The review ceremony: eval-ranked proposals then pending actions, one card at
 *  a time — approve / reject / skip — ending in a generation mint. */
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

  return (
    <Overlay onClose={requestClose}>
      <Dialog width="lg">
        <DialogHeader
          title={
            state && !finished
              ? <>Review <span className="font-normal text-ink-500">· {state.index + 1} of {state.queue.length}</span></>
              : "Review"
          }
          onClose={requestClose}
        />
        <div className="flex flex-col gap-3 p-4">
          {state?.cliAbsent && (
            <div className="rounded-[var(--radius-sm)] border border-warn/40 bg-[color-mix(in_oklab,var(--color-warn)_10%,transparent)] px-3 py-2 text-ui text-warn">
              zuzuu CLI required — <code>npm i -g @zuzuucodes/cli</code>
            </div>
          )}

          {state === null && (
            <div className="flex items-center gap-2 py-6 text-ui text-ink-500"><Spinner /> loading queue…</div>
          )}

          {state !== null && finished && (
            <EndState approvedCount={approvedIds.length} mint={mint} onRetry={() => void runMint(approvedIds)} onDone={onClose} />
          )}

          {state !== null && !finished && item && (
            <>
              <ItemCard item={item} />
              {state.error && (
                <div className="break-all font-mono text-meta text-danger">{state.error}</div>
              )}
              {rejecting ? (
                <div className="flex items-center gap-2">
                  <Field
                    autoFocus
                    value={reason}
                    placeholder="reason (optional)"
                    onChange={(e) => setReason(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !busy) void reject(item); }}
                  />
                  <Button variant="danger" disabled={busy || state.cliAbsent} onClick={() => void reject(item)}>
                    Confirm reject
                  </Button>
                  <Button variant="ghost" disabled={busy} onClick={() => { setRejecting(false); setReason(""); }}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Button variant="primary" disabled={busy || state.cliAbsent} onClick={() => void approve(item)}>
                    Approve
                  </Button>
                  <Button variant="danger" disabled={busy || state.cliAbsent} onClick={() => setRejecting(true)}>
                    Reject
                  </Button>
                  <Button variant="ghost" disabled={busy} onClick={() => dispatch({ type: "skipped" })}>
                    Skip
                  </Button>
                  {busy && <Spinner />}
                  <span className="ml-auto text-meta text-ink-500">{approvedIds.length} approved</span>
                </div>
              )}
            </>
          )}
        </div>
      </Dialog>
    </Overlay>
  );
}

function ItemCard({ item }: { item: ReviewItem }) {
  return (
    <div className="rounded-ui border border-border bg-surface p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded-[var(--radius-sm)] bg-hover px-1.5 py-0.5 text-meta text-accent-dim">{item.module}</span>
        {item.kind === "action" && (
          <span className="rounded-[var(--radius-sm)] border border-border px-1.5 py-0.5 text-meta text-ink-400">action inbox</span>
        )}
        {item.score !== null && (
          <span className="ml-auto text-meta text-ink-400">
            score {item.score}{item.confidence ? ` · ${item.confidence}` : ""}
          </span>
        )}
      </div>
      <div className="text-ui text-ink-100">{item.title}</div>
      <div className="mt-1 font-mono text-meta text-ink-600">{item.id}</div>
      {item.rationale && <div className="mt-2 text-meta text-ink-400">{item.rationale}</div>}
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
    <div className="flex flex-col items-start gap-3 py-2">
      {approvedCount === 0 && <div className="text-ui text-ink-300">All caught up — nothing pending review.</div>}
      {mint.phase === "minting" && (
        <div className="flex items-center gap-2 text-ui text-ink-300"><Spinner /> minting generations…</div>
      )}
      {mint.phase === "done" && (
        <div className="text-ui text-ink-100">
          {mint.minted.length === 0
            ? `${approvedCount} approval${approvedCount === 1 ? "" : "s"} applied`
            : (
              <>
                minted{" "}
                {mint.minted.map((m, i) => (
                  <span key={m.module}>
                    {i > 0 ? " · " : ""}
                    <span className="capitalize">{m.module}</span> <span className="text-accent">{m.id}</span>
                  </span>
                ))}
              </>
            )}
        </div>
      )}
      {mint.phase === "error" && (
        <>
          <div className="break-all font-mono text-meta text-danger">mint failed: {mint.message}</div>
          <Button variant="primary" onClick={onRetry}>Retry mint</Button>
        </>
      )}
      {mint.phase !== "minting" && mint.phase !== "error" && (
        <Button variant="subtle" onClick={onDone}>Done</Button>
      )}
    </div>
  );
}
