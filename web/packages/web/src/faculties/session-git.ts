// Pure logic for the footer session-git indicator (kept free of React/fetch).
import type { SessionGitStatus } from "@zuzuu-web/protocol";
import { ZuzuuApiError } from "../lib/zuzuu-api";

export type SessionIndicatorState =
  | { kind: "none" }
  | { kind: "active"; label: string }
  | { kind: "leftover"; label: string };

/**
 * What the footer shows for session-git:
 * - disabled / CLI absent / no session branch → nothing,
 * - on the session branch → `● session · N checkpoint(s)`,
 * - a session branch exists but isn't checked out → `◌ unfinished session`.
 */
export function sessionIndicator(status: SessionGitStatus | undefined): SessionIndicatorState {
  if (!status?.enabled || status.cliAbsent || !status.active) return { kind: "none" };
  if (status.onSessionBranch) {
    const n = status.active.checkpoints;
    return { kind: "active", label: `● session · ${n} checkpoint${n === 1 ? "" : "s"}` };
  }
  return { kind: "leftover", label: "◌ unfinished session" };
}

/** The structured reason carried by a 502 refusal (the CLI prints JSON even on
 *  non-zero exits, e.g. 'empty-squash-with-checkpoints'); null when absent. */
export function mergeRefusalReason(err: unknown): string | null {
  if (!(err instanceof ZuzuuApiError) || err.data === null || typeof err.data !== "object") return null;
  const reason = (err.data as { reason?: unknown }).reason;
  return typeof reason === "string" && reason.length > 0 ? reason : null;
}
