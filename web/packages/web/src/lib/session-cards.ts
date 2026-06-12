// Pure card-state logic for the session-surface terminal pane (Phase ④):
// which card the center of the pane shows (none / start / recovery) and which
// end-of-session card a dead agent terminal shows. Kept free of React/fetch
// so the state machine is unit-testable.
import type { SessionCloseResult, SessionGitStatus } from "@zuzuu-web/protocol";

export type CenterCard =
  | { kind: "none" }
  | { kind: "recovery"; branch: string; checkpoints: number };

/**
 * What the terminal pane's center shows. Starting sessions moved to the
 * bottom composer bar — the center keeps only the load-time recovery card:
 * - sessions exist → nothing (the terminals),
 * - no sessions + a leftover session branch (same condition as the footer
 *   indicator's "leftover": active && !onSessionBranch) → recovery card,
 * - otherwise → nothing (the calm resting state above the composer).
 */
export function centerCard(
  tabCount: number,
  git: SessionGitStatus | undefined,
): CenterCard {
  if (tabCount > 0) return { kind: "none" };
  if (git?.enabled && !git.cliAbsent && git.active && !git.onSessionBranch) {
    return { kind: "recovery", branch: git.active.branch, checkpoints: git.active.checkpoints };
  }
  return { kind: "none" };
}

/** Single-active-agent v1 rule: at most ONE alive agent session (shells unlimited). */
export const hasAliveAgent = (tabs: { type: string; alive: boolean }[]): boolean =>
  tabs.some((t) => t.type === "agent" && t.alive);

export type EndCard =
  | { kind: "banner" } // shell sessions (and unknown outcomes) keep the plain exit banner
  | { kind: "utility" } // zuzuu utility runs (init / enable) — "Session finished", no merge story
  | { kind: "merged"; commits: number }
  | { kind: "no-changes" } // session ended cleanly with nothing to merge
  | { kind: "cli-absent" }
  | { kind: "no-net-changes"; checkpoints: number | null }
  | { kind: "conflict" }
  | { kind: "failed"; message: string };

/**
 * Map an exited session's type + host + the daemon-recorded auto-merge outcome
 * (GET /api/sessions/:id → closeResult) onto the end-of-session card.
 * `host === "zuzuu"` marks a utility run (init / enable) — those always get
 * the plain "Session finished" card, regardless of any merge outcome.
 */
export function endCard(
  type: string | undefined,
  host: string | undefined,
  closeResult: SessionCloseResult | undefined,
): EndCard {
  if (host === "zuzuu") return { kind: "utility" };
  if (type !== "agent" || closeResult === undefined) return { kind: "banner" };
  if ("cliAbsent" in closeResult) return { kind: "cli-absent" };
  if (closeResult.ok) {
    const m = closeResult.merge;
    if (m.conflict) return { kind: "conflict" };
    if (m.reason === "empty-squash-with-checkpoints") {
      return { kind: "no-net-changes", checkpoints: m.commits ?? null };
    }
    if (m.ok === false || m.mergedAs == null) return { kind: "no-changes" };
    return { kind: "merged", commits: m.commits ?? 1 };
  }
  // CLI refused (non-zero exit) — it still prints structured JSON
  const refusal = closeResult.refusal ?? {};
  const reason = typeof refusal.reason === "string" ? refusal.reason : null;
  if (reason === "empty-squash-with-checkpoints") {
    const commits = refusal.commits;
    const checkpoints = refusal.checkpoints;
    const n =
      typeof commits === "number" ? commits : typeof checkpoints === "number" ? checkpoints : null;
    return { kind: "no-net-changes", checkpoints: n };
  }
  if (reason === "no-session-branch") return { kind: "no-changes" };
  if (refusal.conflict === true || reason === "conflict") return { kind: "conflict" };
  return {
    kind: "failed",
    message: closeResult.stderr?.trim() || reason || "session merge failed",
  };
}
