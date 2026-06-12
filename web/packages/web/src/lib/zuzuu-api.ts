// REST client for the /api/zuzuu/* observe + act routes (mirrors lib/api.ts).
import type {
  ZuzuuHealth, ZuzuuStatus, FacultySummary, FacultyDetail, InboxResponse,
  GenerationList, GenerationDiff, SessionsResponse, DigestResponse,
  EvalResponse, HostsResponse, ApproveResult, RejectResult, MintResult, RollbackResult,
} from "@zuzuu-web/protocol";

/** Mutations fail in two daemon-defined shapes: 503 {error:"zuzuu CLI required"}
 *  (binary absent) and 502 {error, stderr} (command failed) — keep both. */
export class ZuzuuApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly stderr?: string,
  ) {
    super(message);
  }
}

export const isCliAbsent = (err: unknown): boolean =>
  err instanceof ZuzuuApiError && err.status === 503;

/** Best one-line description of a failed call (prefers the CLI's stderr tail). */
export function describeZuzuuError(err: unknown): string {
  if (isCliAbsent(err)) return "zuzuu CLI required — npm i -g @zuzuucodes/cli";
  if (err instanceof ZuzuuApiError && err.stderr) return err.stderr;
  return err instanceof Error ? err.message : String(err);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/zuzuu${path}`, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string; stderr?: string } | null;
    throw new ZuzuuApiError(res.status, body?.error ?? `request failed (${res.status})`, body?.stderr);
  }
  return res.json() as Promise<T>;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const zuzuuApi = {
  health: () => request<ZuzuuHealth>("/health"),
  status: () => request<ZuzuuStatus>("/status"),
  faculties: () => request<{ faculties: FacultySummary[] }>("/faculties"),
  faculty: (key: string) => request<FacultyDetail>(`/faculty/${encodeURIComponent(key)}`),
  inbox: () => request<InboxResponse>("/inbox"),
  generations: () => request<GenerationList>("/generations"),
  generation: (id: string) => request<GenerationDiff>(`/generation/${encodeURIComponent(id)}`),
  sessions: () => request<SessionsResponse>("/sessions"),
  digest: () => request<DigestResponse>("/digest"),
  evalRanked: () => request<EvalResponse>("/eval"),
  hosts: () => request<HostsResponse>("/hosts"),

  // ── Write side (CLI-only on the daemon: 503 when absent, 502 on failure) ──
  approveProposal: (id: string, faculty: string) =>
    request<ApproveResult>(`/proposals/${encodeURIComponent(id)}/approve`, json({ faculty })),
  rejectProposal: (id: string, faculty: string, reason?: string) =>
    request<RejectResult>(`/proposals/${encodeURIComponent(id)}/reject`, json(reason ? { faculty, reason } : { faculty })),
  approveAction: (slug: string) =>
    request<ApproveResult>(`/actions/${encodeURIComponent(slug)}/approve`, json({})),
  rejectAction: (slug: string) =>
    request<RejectResult>(`/actions/${encodeURIComponent(slug)}/reject`, json({})),
  mintGeneration: (from: string[]) =>
    request<MintResult>("/generation/mint", json({ from })),
  rollback: (id: string) =>
    request<RollbackResult>(`/generation/${encodeURIComponent(id)}/rollback`, json({})),
};
