// Pure logic tests for the review ceremony's queue reducer (no DOM needed).
import { describe, expect, it } from "vitest";
import {
  buildQueue, currentItem, initReview, isDone, pendingReviewCount, reduceReview, type ReviewState,
} from "./review-queue";

const ranked = [
  { id: "p1", faculty: "knowledge", title: "fact one", score: 0.9, confidence: "high", rationale: "seen 4x" },
  { id: "p2", faculty: "memory", title: "fact two", score: null, confidence: null, rationale: null },
];
const actions = [
  { id: "deploy-check", faculty: "actions", title: "deploy preflight" },
  { id: "p2", faculty: "actions", title: "duplicate of a ranked id" },
];

describe("buildQueue", () => {
  it("puts ranked proposals first, then action-inbox items", () => {
    const q = buildQueue(ranked, actions);
    expect(q.map((i) => i.id)).toEqual(["p1", "p2", "deploy-check"]);
    expect(q[0]!.kind).toBe("proposal");
    expect(q[2]!.kind).toBe("action");
    expect(q[2]!.faculty).toBe("actions");
  });

  it("dedupes action items whose id already appears in the ranked list", () => {
    const q = buildQueue(ranked, actions);
    expect(q.filter((i) => i.id === "p2")).toHaveLength(1);
    expect(q.find((i) => i.id === "p2")!.kind).toBe("proposal");
  });

  it("carries eval score/confidence/rationale through", () => {
    const q = buildQueue(ranked, []);
    expect(q[0]).toMatchObject({ score: 0.9, confidence: "high", rationale: "seen 4x" });
    expect(q[1]).toMatchObject({ score: null, confidence: null, rationale: null });
  });
});

describe("pendingReviewCount", () => {
  it("matches the combined deduped queue length (ranked + action inbox)", () => {
    expect(pendingReviewCount(ranked, actions)).toBe(buildQueue(ranked, actions).length);
    expect(pendingReviewCount(ranked, actions)).toBe(3); // p2 deduped
  });

  it("counts action-inbox-only items even with an empty eval ranking", () => {
    expect(pendingReviewCount([], actions)).toBe(2);
    expect(pendingReviewCount([], [])).toBe(0);
  });
});

describe("reduceReview", () => {
  const start = () => initReview(buildQueue(ranked, actions));

  it("approve records the id and advances", () => {
    let s = start();
    s = reduceReview(s, { type: "approved", id: "p1" });
    expect(s.approvedIds).toEqual(["p1"]);
    expect(s.index).toBe(1);
    expect(currentItem(s)!.id).toBe("p2");
  });

  it("reject and skip advance without recording", () => {
    let s = start();
    s = reduceReview(s, { type: "rejected" });
    s = reduceReview(s, { type: "skipped" });
    expect(s.approvedIds).toEqual([]);
    expect(s.index).toBe(2);
  });

  it("a failure stays on the item and surfaces the message; advancing clears it", () => {
    let s = start();
    s = reduceReview(s, { type: "failed", message: "zuzuu: boom" });
    expect(s.index).toBe(0);
    expect(s.error).toBe("zuzuu: boom");
    s = reduceReview(s, { type: "approved", id: "p1" });
    expect(s.error).toBeNull();
  });

  it("cli-absent is sticky and does not advance", () => {
    let s = start();
    s = reduceReview(s, { type: "cli-absent" });
    expect(s.cliAbsent).toBe(true);
    expect(s.index).toBe(0);
  });

  it("walking the whole queue reaches done with the approved ids collected", () => {
    let s: ReviewState = start();
    s = reduceReview(s, { type: "approved", id: "p1" });
    s = reduceReview(s, { type: "rejected" });
    s = reduceReview(s, { type: "approved", id: "deploy-check" });
    expect(isDone(s)).toBe(true);
    expect(currentItem(s)).toBeNull();
    expect(s.approvedIds).toEqual(["p1", "deploy-check"]);
  });

  it("an empty queue is done immediately (all caught up)", () => {
    expect(isDone(initReview([]))).toBe(true);
  });
});
