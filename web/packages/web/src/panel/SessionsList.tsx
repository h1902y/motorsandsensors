import { useQuery } from "@tanstack/react-query";
import { zuzuuApi } from "../lib/zuzuu-api";

interface SessionRow { id?: string; host?: string; status?: string; }

/** Recent captured sessions (the git-native index), top `limit` rows. */
export function SessionsList({ limit = 12 }: { limit?: number }) {
  const q = useQuery({ queryKey: ["zuzuu", "sessions"], queryFn: zuzuuApi.sessions, refetchInterval: 6000 });
  const sessions = (q.data?.sessions ?? []) as SessionRow[];

  return (
    <div className="flex flex-col gap-2">
      <div className="text-meta uppercase tracking-wide text-ink-500">sessions ({sessions.length})</div>
      {sessions.length === 0 ? (
        <div className="text-meta text-ink-600">none captured yet</div>
      ) : (
        <div className="flex flex-col">
          {sessions.slice(0, limit).map((s, i) => (
            <div key={s.id ?? i} className="flex items-baseline gap-2 border-b border-border py-1 text-ui last:border-0">
              <span className="w-16 shrink-0 text-meta text-ink-500">{s.status ?? "—"}</span>
              <span className="w-24 shrink-0 truncate text-ink-300">{s.host ?? "—"}</span>
              <span className="truncate text-meta text-ink-500">{(s.id ?? "").slice(0, 8)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
