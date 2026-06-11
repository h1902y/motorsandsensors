// REST client for the /api/zuzuu/* observe routes (mirrors lib/api.ts).
import type {
  ZuzuuHealth, ZuzuuStatus, FacultySummary, FacultyDetail, InboxResponse,
  GenerationList, GenerationDiff, SessionsResponse, DigestResponse,
} from "@zuzuu-web/protocol";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`/api/zuzuu${path}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export const zuzuuApi = {
  health: () => get<ZuzuuHealth>("/health"),
  status: () => get<ZuzuuStatus>("/status"),
  faculties: () => get<{ faculties: FacultySummary[] }>("/faculties"),
  faculty: (key: string) => get<FacultyDetail>(`/faculty/${encodeURIComponent(key)}`),
  inbox: () => get<InboxResponse>("/inbox"),
  generations: () => get<GenerationList>("/generations"),
  generation: (id: string) => get<GenerationDiff>(`/generation/${encodeURIComponent(id)}`),
  sessions: () => get<SessionsResponse>("/sessions"),
  digest: () => get<DigestResponse>("/digest"),
};
