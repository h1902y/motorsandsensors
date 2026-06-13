import { describe, it, expect } from "vitest";
import { confidencePill, signalPhrases } from "./proposal-evidence";
import type { RankedProposalSignals } from "@zuzuu-web/protocol";

const zero: RankedProposalSignals = {
  occurrence: 0,
  corroboration: 0,
  recency: 0.5,
  failureReduction: 0,
  erNovelty: 0.5,
};

describe("confidencePill", () => {
  it("maps the three string buckets", () => {
    expect(confidencePill("high").level).toBe("high");
    expect(confidencePill("high").tone).toBe("success");
    expect(confidencePill("med").level).toBe("med");
    expect(confidencePill("med").tone).toBe("warning");
    expect(confidencePill("low").level).toBe("low");
    expect(confidencePill("low").tone).toBe("neutral");
  });

  it("derives from a raw score when confidence string is missing", () => {
    expect(confidencePill(null, 0.8).level).toBe("high");
    expect(confidencePill(null, 0.4).level).toBe("med");
    expect(confidencePill(null, 0.1).level).toBe("low");
  });

  it("defaults to low when neither confidence nor score is present", () => {
    expect(confidencePill(undefined).level).toBe("low");
    expect(confidencePill("garbage").level).toBe("low");
  });

  it("carries a human label", () => {
    expect(confidencePill("high").label).toMatch(/high/i);
    expect(confidencePill("low").label).toMatch(/low/i);
  });
});

describe("signalPhrases", () => {
  it("prefers raw evidence counts over the vector", () => {
    const phrases = signalPhrases(
      { occurrence: 1, corroboration: 1, recency: 0.9, failureReduction: 1, erNovelty: 1 },
      { occurrences: 12, sessions: 3, failures: 2, erVerdict: "new" },
    );
    const texts = phrases.map((p) => p.text);
    expect(texts).toContain("seen 12×");
    expect(texts).toContain("across 3 sessions");
    expect(texts).toContain("reduces 2 repeated failures");
    expect(texts).toContain("recently active");
    expect(texts).toContain("new — not seen before");
  });

  it("singularizes one session / one failure", () => {
    const phrases = signalPhrases(
      { occurrence: 1, corroboration: 0.3, recency: 0.5, failureReduction: 0.3, erNovelty: 0.5 },
      { occurrences: 1, sessions: 1, failures: 1 },
    );
    const texts = phrases.map((p) => p.text);
    expect(texts).toContain("across 1 session");
    expect(texts).toContain("reduces 1 repeated failure");
  });

  it("emits only meaningful signals — a weak proposal yields few phrases", () => {
    const phrases = signalPhrases(zero, { erVerdict: "new" });
    // occurrence/corroboration/failure all 0 → omitted; recency 0.5 (neutral) → omitted
    expect(phrases.map((p) => p.key)).toEqual(["erNovelty"]);
    expect(phrases[0]!.text).toMatch(/new/i);
  });

  it("falls back to the vector when evidence counts are absent", () => {
    const phrases = signalPhrases(
      { occurrence: 0.9, corroboration: 0.9, recency: 0.1, failureReduction: 0.9, erNovelty: 0.5 },
      undefined,
    );
    const texts = phrases.map((p) => p.text);
    expect(texts).toContain("recurring pattern");
    expect(texts).toContain("spans multiple sessions");
    expect(texts).toContain("addresses repeated failures");
    expect(texts).toContain("stale");
  });

  it("translates the er verdict variants", () => {
    expect(signalPhrases(undefined, { erVerdict: "enrich" }).map((p) => p.text)).toContain(
      "enriches an existing item",
    );
    expect(signalPhrases(undefined, { erVerdict: "duplicate" }).map((p) => p.text)).toContain(
      "already known",
    );
  });

  it("is empty when there is nothing to say", () => {
    expect(signalPhrases(undefined, undefined)).toEqual([]);
    expect(signalPhrases(undefined, {})).toEqual([]);
  });

  it("carries strength in [0,1] for inline bars", () => {
    const phrases = signalPhrases(
      { occurrence: 0.5, corroboration: 0.5, recency: 0.9, failureReduction: 0, erNovelty: 1 },
      { occurrences: 5, sessions: 2 },
    );
    for (const p of phrases) {
      expect(p.strength).toBeGreaterThanOrEqual(0);
      expect(p.strength).toBeLessThanOrEqual(1);
    }
  });
});
