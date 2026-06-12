// Pure queue logic for the review ceremony (ReviewFlow.tsx renders this state).
// Kept free of React/fetch so the flow's decision rules are unit-testable.
import type { ProposalSummary, RankedProposal } from "@zuzuu-web/protocol";

/** One reviewable thing: an eval-ranked proposal, or a pending action-inbox item. */
export interface ReviewItem {
  /** which mutation endpoint it goes through: /proposals/:id/* vs /actions/:slug/* */
  kind: "proposal" | "action";
  id: string;
  faculty: string;
  title: string;
  score: number | null;
  confidence: string | null;
  rationale: string | null;
}

export interface ReviewState {
  queue: ReviewItem[];
  index: number;
  approvedIds: string[];
  /** sticky — a 503 means the zuzuu CLI is absent; no mutation can succeed */
  cliAbsent: boolean;
  /** transient error (502 stderr etc.) for the current item; cleared on advance */
  error: string | null;
}

export type ReviewEvent =
  | { type: "approved"; id: string }
  | { type: "rejected" }
  | { type: "skipped" }
  | { type: "cli-absent" }
  | { type: "failed"; message: string };

/** Ranked proposals first (eval order), then pending actions, deduped by id. */
export function buildQueue(ranked: RankedProposal[], actionInbox: ProposalSummary[]): ReviewItem[] {
  const queue: ReviewItem[] = ranked.map((p) => ({
    kind: "proposal",
    id: p.id,
    faculty: p.faculty,
    title: p.title,
    score: p.score,
    confidence: p.confidence,
    rationale: p.rationale,
  }));
  const seen = new Set(queue.map((q) => q.id));
  for (const a of actionInbox) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    queue.push({
      kind: "action",
      id: a.id,
      faculty: "actions",
      title: a.title,
      score: null,
      confidence: null,
      rationale: null,
    });
  }
  return queue;
}

export function initReview(queue: ReviewItem[]): ReviewState {
  return { queue, index: 0, approvedIds: [], cliAbsent: false, error: null };
}

export function reduceReview(state: ReviewState, event: ReviewEvent): ReviewState {
  switch (event.type) {
    case "approved":
      return { ...state, approvedIds: [...state.approvedIds, event.id], index: state.index + 1, error: null };
    case "rejected":
    case "skipped":
      return { ...state, index: state.index + 1, error: null };
    case "cli-absent":
      return { ...state, cliAbsent: true };
    case "failed":
      return { ...state, error: event.message };
  }
}

export const currentItem = (s: ReviewState): ReviewItem | null => s.queue[s.index] ?? null;
export const isDone = (s: ReviewState): boolean => s.index >= s.queue.length;

/** The "Review N" badge count — same combined queue (ranked + action inbox,
 *  deduped) the ceremony walks, so the entry point never under-counts. */
export const pendingReviewCount = (ranked: RankedProposal[], actionInbox: ProposalSummary[]): number =>
  buildQueue(ranked, actionInbox).length;
