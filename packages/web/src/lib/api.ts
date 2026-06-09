import type {
  CreateSessionRequest,
  ListResponse,
  SearchResponse,
  SessionInfo,
  WorkspaceInfo,
} from "@webcode/protocol";

class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    if (res.status === 401) {
      // cookie missing/expired — the daemon prints a tokened URL; tell the user
      throw new ApiError(401, "not authorized — open the URL printed by the webcode daemon");
    }
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, body?.error ?? `request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  workspace: () => request<WorkspaceInfo>("/api/workspace"),

  listSessions: () => request<SessionInfo[]>("/api/sessions"),
  createSession: (body: CreateSessionRequest = {}) =>
    request<SessionInfo>("/api/sessions", json(body)),
  closeSession: (id: string) =>
    request<{ ok: true }>(`/api/sessions/${id}`, { method: "DELETE" }),

  listDir: (path: string) =>
    request<ListResponse>(`/api/fs/list?path=${encodeURIComponent(path)}`),
  mkdir: (path: string) => request<{ ok: true }>("/api/fs/mkdir", json({ path })),
  rename: (from: string, to: string) =>
    request<{ ok: true }>("/api/fs/rename", json({ from, to })),
  remove: (paths: string[]) => request<{ ok: true }>("/api/fs/delete", json({ paths })),

  downloadUrl: (path: string) => `/api/fs/download?path=${encodeURIComponent(path)}`,

  /** Open with the OS default app (or reveal in Finder/file manager). */
  openLocal: (path: string, reveal = false) =>
    request<{ ok: true }>("/api/fs/open", json({ path, reveal })),

  saveRecording: (sessionId: string, path: string) =>
    request<{ ok: true; path: string; truncated: boolean }>(
      `/api/sessions/${sessionId}/recording`,
      json({ path }),
    ),

  search: (q: string, opts: { path?: string; regex?: boolean; caseSensitive?: boolean } = {}) => {
    const qs = new URLSearchParams({ q });
    if (opts.path) qs.set("path", opts.path);
    if (opts.regex) qs.set("regex", "1");
    if (opts.caseSensitive) qs.set("case", "1");
    return request<SearchResponse>(`/api/search?${qs}`);
  },
};

export function wsUrl(path: string): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}${path}`;
}
